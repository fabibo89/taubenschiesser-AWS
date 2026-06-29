"""
Hugin CLI panorama stitching for grid scan images.

Requires Hugin command-line tools (pto_gen, pto_var, pano_modify, nona; enblend
optional). On macOS the Homebrew cask installs them spread across several .app
bundles; on Linux use `apt install hugin-tools enblend-enfuse`.

Image positions (yaw/pitch/FoV) are written via pto_var --set from the known
scan rotation/tilt, so no feature matching is required. Pixel mapping uses Hugin's pano_trafo on the final project file (source corners
→ panorama pixel coordinates, crop-adjusted to match the stitched output).
"""
import glob
import os
import re
import shutil
import subprocess
import tempfile
import time
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

# enblend is optional: if missing or failing we composite nona tiles ourselves.
REQUIRED_TOOLS = ('pto_gen', 'pto_var', 'pano_modify', 'nona')
OPTIONAL_TOOLS = ('enblend',)

HUGIN_STEP_LABELS = {
    'prepare': 'Bilder vorbereiten',
    'pto_gen': 'Projekt erzeugen',
    'pto_var': 'Positionen setzen',
    'pano_modify': 'Canvas berechnen',
    'nona': 'Bilder projizieren',
    'enblend': 'Überlappungen blenden',
    'composite': 'Tiles zusammenfügen',
    'mapping': 'Pixel-Mapping berechnen',
    'finalize': 'Panorama fertigstellen',
}

# Common install locations (macOS Homebrew cask, Linux packages)
HUGIN_SEARCH_DIRS = [
    '/Applications/Hugin/tools_mac',
    '/Applications/Hugin/Hugin.app/Contents/MacOS',
    '/Applications/Hugin/PTBatcherGUI.app/Contents/MacOS',
    '/Applications/Hugin/HuginStitchProject.app/Contents/MacOS',
    '/Applications/Hugin.app/Contents/MacOS',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
]

ProgressCallback = Callable[[Dict[str, object]], None]


class HuginNotAvailableError(Exception):
    """Raised when required Hugin CLI tools are not found on PATH."""


class HuginStitchError(Exception):
    def __init__(self, message: str, error_code: str = 'HUGIN_STITCH_FAILED'):
        super().__init__(message)
        self.error_code = error_code


def find_hugin_tool(name: str) -> Optional[str]:
    path = shutil.which(name)
    if path:
        return path
    for directory in HUGIN_SEARCH_DIRS:
        candidate = os.path.join(directory, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def check_hugin_available() -> Dict[str, str]:
    """Return {tool_name: path} for all required tools (+ optional if present), or raise."""
    found = {}
    missing = []
    for tool in REQUIRED_TOOLS:
        path = find_hugin_tool(tool)
        if path:
            found[tool] = path
        else:
            missing.append(tool)
    if missing:
        raise HuginNotAvailableError(
            f'Hugin-Tools nicht gefunden: {", ".join(missing)}. '
            'Installiere Hugin (macOS: brew install --cask hugin, Linux: apt install hugin-tools enblend-enfuse).'
        )
    for tool in OPTIONAL_TOOLS:
        path = find_hugin_tool(tool)
        if path:
            found[tool] = path
    return found


def _report(on_progress: Optional[ProgressCallback], step: str, progress: int, message: Optional[str] = None) -> None:
    if not on_progress:
        return
    payload: Dict[str, object] = {
        'step': step,
        'step_label': HUGIN_STEP_LABELS.get(step, step),
        'progress': progress,
    }
    if message:
        payload['message'] = message
    on_progress(payload)


def _run(cmd: List[str], timeout: int = 300, on_progress: Optional[ProgressCallback] = None, step: str = '') -> None:
    """Run a Hugin CLI command, streaming merged stdout/stderr line by line."""
    cmd_str = ' '.join(cmd)
    print(f'Hugin: {cmd_str}')
    if on_progress and step:
        _report(on_progress, step, _step_progress(step), f'$ {os.path.basename(cmd[0])}')

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    output_lines: List[str] = []
    start = time.time()
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            output_lines.append(line)
            print(f'Hugin [{os.path.basename(cmd[0])}]: {line}')
            if on_progress and step:
                _report(on_progress, step, _step_progress(step), line)
        if time.time() - start > timeout:
            proc.kill()
            proc.wait()
            raise subprocess.TimeoutExpired(cmd, timeout)

    rc = proc.wait()
    if rc != 0:
        detail = '\n'.join(output_lines[-20:]) or f'exit code {rc}'
        raise RuntimeError(f'Hugin-Befehl fehlgeschlagen ({os.path.basename(cmd[0])}): {detail}')


def _step_progress(step: str) -> int:
    return {
        'prepare': 5,
        'pto_gen': 15,
        'pto_var': 25,
        'pano_modify': 35,
        'nona': 60,
        'enblend': 85,
        'composite': 85,
        'mapping': 92,
        'finalize': 95,
    }.get(step, 0)


def _compute_yaw_offset(meta: List[dict]) -> float:
    """
    Center of the scanned rotation range. The equirectangular canvas is centered
    at Hugin yaw 0 and spans -180..+180. By shifting all image yaws by -offset the
    scan content is centered on the canvas, so it never crosses the +/-180 seam
    (otherwise the FoV beyond the nominal range wraps around and gets cropped).
    """
    rots = [float(m['rotation']) for m in meta if m.get('rotation') is not None]
    if not rots:
        return 0.0
    return (min(rots) + max(rots)) / 2.0


def _build_var_set(meta: List[dict], fov: float, horizon_tilt: float = 90.0, yaw_offset: float = 0.0) -> str:
    """
    Device tilt convention: horizon_tilt = straight ahead (horizon), lower = down.
    Hugin pitch convention: 0 = horizon, positive = up, negative = down.
    So pitch = tilt - horizon_tilt.
    Hugin yaw = device rotation - yaw_offset (keeps content centered on the canvas).
    """
    parts = [f'v={fov:g}']
    for i, m in enumerate(meta):
        parts.append(f'y{i}={float(m["rotation"]) - float(yaw_offset):g}')
        parts.append(f'p{i}={float(m["tilt"]) - float(horizon_tilt):g}')
        parts.append(f'r{i}=0')
    return ','.join(parts)


def _parse_pto_p_line(pto_path: str) -> Dict[str, object]:
    """Parse panorama canvas size, projection and optional crop from the p-line."""
    with open(pto_path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if not line.startswith('p '):
                continue
            # Hugin p-line tokens have no '=' (e.g. "p f2 w6000 h3000 v360 ...").
            width_m = re.search(r'\bw(\d+)', line)
            height_m = re.search(r'\bh(\d+)', line)
            proj_m = re.search(r'\bf(\d+)', line)
            crop_m = re.search(r'\bS(\d+),(\d+),(\d+),(\d+)', line)
            info: Dict[str, object] = {
                'width': int(width_m.group(1)) if width_m else None,
                'height': int(height_m.group(1)) if height_m else None,
                'projection': f'f{proj_m.group(1)}' if proj_m else None,
                'crop': None,
            }
            if crop_m:
                left, right, top, bottom = map(int, crop_m.groups())
                info['crop'] = {'left': left, 'right': right, 'top': top, 'bottom': bottom}
            return info
    raise RuntimeError('Keine p-Zeile in Hugin-Projekt gefunden')


def _pano_trafo_points(
    tools: Dict[str, str],
    pto_path: str,
    image_idx: int,
    points: List[Tuple[float, float]],
    timeout: int = 60,
) -> List[List[float]]:
    """Map source-image pixel coordinates to panorama pixel coordinates via pano_trafo."""
    pano_trafo = tools.get('pano_trafo') or find_hugin_tool('pano_trafo')
    if not pano_trafo:
        raise RuntimeError('pano_trafo nicht gefunden')

    stdin = '\n'.join(f'{x:g} {y:g}' for x, y in points) + '\n'
    proc = subprocess.run(
        [pano_trafo, pto_path, str(image_idx)],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip() or f'exit code {proc.returncode}'
        raise RuntimeError(f'pano_trafo fehlgeschlagen (Bild {image_idx}): {detail}')

    transformed: List[List[float]] = []
    for line in (proc.stdout or '').strip().splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        transformed.append([float(parts[0]), float(parts[1])])
    if len(transformed) != len(points):
        raise RuntimeError(
            f'pano_trafo lieferte {len(transformed)} Punkte, erwartet {len(points)} (Bild {image_idx})'
        )
    return transformed


def _source_outline_points(width: int, height: int, samples_per_edge: int = 16) -> List[Tuple[float, float]]:
    """Return a clockwise sampled outline for a source image."""
    samples = max(2, samples_per_edge)
    points: List[Tuple[float, float]] = []

    for i in range(samples):
        x = width * i / (samples - 1)
        points.append((x, 0.0))
    for i in range(1, samples):
        y = height * i / (samples - 1)
        points.append((float(width), y))
    for i in range(1, samples):
        x = width * (1.0 - i / (samples - 1))
        points.append((x, float(height)))
    for i in range(1, samples - 1):
        y = height * (1.0 - i / (samples - 1))
        points.append((0.0, y))

    return points


def build_hugin_mapping(
    pto_path: str,
    image_sizes: List[Dict[str, int]],
    tools: Dict[str, str],
    timeout: int = 60,
    on_progress: Optional[ProgressCallback] = None,
    horizon_tilt: float = 90.0,
    yaw_offset: float = 0.0,
) -> Tuple[Dict[str, object], List[List[List[float]]]]:
    """
    Build per-frame panorama outlines from Hugin's pano_trafo output.
    Coordinates are relative to the final cropped panorama image.
    """
    _report(on_progress, 'mapping', 92, 'Pixel-Mapping via pano_trafo')
    p_info = _parse_pto_p_line(pto_path)
    crop = p_info.get('crop')
    crop_left = crop['left'] if crop else 0
    crop_top = crop['top'] if crop else 0

    frame_corners: List[List[List[float]]] = []
    for i, size in enumerate(image_sizes):
        w, h = size['width'], size['height']
        # Hugin projection bends image edges; four corners are not enough for
        # a useful overlay. Sample the whole border and draw it as a curve.
        src_points = _source_outline_points(w, h, samples_per_edge=18)
        dst_points = _pano_trafo_points(tools, pto_path, i, src_points, timeout=timeout)
        if crop:
            dst_points = [[x - crop_left, y - crop_top] for x, y in dst_points]
        frame_corners.append(dst_points)
        _report(on_progress, 'mapping', 92, f'Mapping Bild {i + 1}/{len(image_sizes)}')

    if crop:
        pano_w = crop['right'] - crop['left']
        pano_h = crop['bottom'] - crop['top']
    else:
        pano_w = int(p_info['width'] or 0)
        pano_h = int(p_info['height'] or 0)

    grid_info = {
        'projection': 'hugin_equirectangular',
        'mapping_source': 'pano_trafo',
        'horizon_tilt': horizon_tilt,
        'yaw_offset': yaw_offset,
        'hugin_projection': p_info.get('projection'),
        'canvas_width': pano_w,
        'canvas_height': pano_h,
        'hugin_canvas_width': p_info.get('width'),
        'hugin_canvas_height': p_info.get('height'),
        'crop_left': crop_left,
        'crop_top': crop_top,
        'crop_right': crop.get('right') if crop else p_info.get('width'),
        'crop_bottom': crop.get('bottom') if crop else p_info.get('height'),
    }
    return grid_info, frame_corners


def _read_pto_content(pto_path: str, image_count: int) -> str:
    """Read Hugin project file and normalize image paths to stable names."""
    with open(pto_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    for i in range(image_count):
        content = re.sub(
            rf'n"[^"]*img_{i:04d}\.jpg"',
            f'n"img_{i:04d}.jpg"',
            content,
        )
    return content


def _strip_crop_flag(pto_path: str) -> None:
    """Remove ` r:CROP` from the p-line so nona writes canvas-aligned tiles."""
    with open(pto_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    content = re.sub(r'\s+r:CROP', '', content)
    with open(pto_path, 'w', encoding='utf-8') as f:
        f.write(content)


def _composite_tiles(tile_paths: List[str], on_progress: Optional[ProgressCallback] = None) -> Optional[np.ndarray]:
    """Alpha-weighted average of canvas-aligned RGBA nona tiles (fallback for enblend)."""
    acc = None
    wsum = None
    total = len(tile_paths)
    for idx, path in enumerate(tile_paths):
        tile = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if tile is None:
            continue
        if tile.ndim != 3 or tile.shape[2] < 4:
            continue
        if acc is None:
            acc = np.zeros((tile.shape[0], tile.shape[1], 3), dtype=np.float64)
            wsum = np.zeros((tile.shape[0], tile.shape[1]), dtype=np.float64)
        if tile.shape[:2] != acc.shape[:2]:
            continue
        alpha = tile[:, :, 3].astype(np.float64) / 255.0
        for c in range(3):
            acc[:, :, c] += tile[:, :, c].astype(np.float64) * alpha
        wsum += alpha
        if on_progress and total > 0:
            pct = 85 + int((idx + 1) / total * 8)
            _report(on_progress, 'composite', pct, f'Tile {idx + 1}/{total}')

    if acc is None:
        return None
    mask = wsum > 1e-6
    out = np.zeros_like(acc)
    for c in range(3):
        out[:, :, c][mask] = acc[:, :, c][mask] / wsum[mask]
    return np.clip(out, 0, 255).astype(np.uint8)


def stitch_with_hugin(
    images: List[np.ndarray],
    meta: List[dict],
    fov: float,
    max_dimension: Optional[int] = 1280,
    timeout: int = 300,
    on_progress: Optional[ProgressCallback] = None,
    horizon_tilt: float = 90.0,
) -> Tuple[np.ndarray, dict, Dict[str, object]]:
    """
    Stitch images via Hugin CLI using known scan positions.
    Returns (panorama_bgr, stats, mapping) where mapping has grid_info + frame_corners.
    """
    tools = check_hugin_available()
    _report(on_progress, 'prepare', 5, f'{len(images)} Bilder vorbereiten')

    with tempfile.TemporaryDirectory(prefix='hugin_stitch_') as tmpdir:
        image_paths = []
        for i, img in enumerate(images):
            path = os.path.join(tmpdir, f'img_{i:04d}.jpg')
            cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            image_paths.append(path)
            if on_progress and len(images) > 0:
                pct = 5 + int((i + 1) / len(images) * 5)
                _report(on_progress, 'prepare', pct, f'Bild {i + 1}/{len(images)} gespeichert')

        yaw_offset = _compute_yaw_offset(meta)

        pto_path = os.path.join(tmpdir, 'project.pto')
        _run([tools['pto_gen'], '-o', pto_path] + image_paths, timeout=timeout, on_progress=on_progress, step='pto_gen')
        _run(
            [tools['pto_var'], '--set', _build_var_set(meta, fov, horizon_tilt, yaw_offset), '-o', pto_path, pto_path],
            timeout=timeout,
            on_progress=on_progress,
            step='pto_var',
        )
        _run(
            [tools['pano_modify'], '--canvas=AUTO', '--crop=AUTO', '-o', pto_path, pto_path],
            timeout=timeout,
            on_progress=on_progress,
            step='pano_modify',
        )

        image_sizes = [{'width': img.shape[1], 'height': img.shape[0]} for img in images]
        hugin_pto = _read_pto_content(pto_path, len(images))
        grid_info, frame_corners = build_hugin_mapping(
            pto_path, image_sizes, tools, timeout=timeout, on_progress=on_progress,
            horizon_tilt=horizon_tilt, yaw_offset=yaw_offset
        )

        _strip_crop_flag(pto_path)
        prefix = os.path.join(tmpdir, 'tile')
        _run([tools['nona'], '-m', 'TIFF_m', '-o', prefix, pto_path], timeout=timeout, on_progress=on_progress, step='nona')

        tile_paths = sorted(glob.glob(prefix + '*.tif') + glob.glob(prefix + '*.tiff'))
        if not tile_paths:
            raise RuntimeError('nona hat keine Ausgabebilder erzeugt')

        panorama = None
        blend_mode = None

        if 'enblend' in tools:
            try:
                panorama_path = os.path.join(tmpdir, 'panorama.tif')
                _run(
                    [tools['enblend'], '-o', panorama_path] + tile_paths,
                    timeout=timeout,
                    on_progress=on_progress,
                    step='enblend',
                )
                panorama = cv2.imread(panorama_path, cv2.IMREAD_COLOR)
                if panorama is not None:
                    blend_mode = 'enblend'
            except (RuntimeError, subprocess.TimeoutExpired) as e:
                msg = f'enblend fehlgeschlagen, nutze Fallback-Komposit: {e}'
                print(f'Hugin: {msg}')
                if on_progress:
                    _report(on_progress, 'composite', 85, msg)

        if panorama is None:
            panorama = _composite_tiles(tile_paths, on_progress=on_progress)
            blend_mode = 'composite'

        if panorama is None:
            raise RuntimeError('Hugin-Panorama konnte nicht erzeugt werden')

        _report(on_progress, 'finalize', 95, 'Panorama fertig')

        stats = {
            'total_requested': len(images),
            'total_loaded': len(images),
            'total_failed': 0,
            'total_used': len(images),
            'blend_mode': blend_mode,
            'hugin_tools': tools,
        }
        mapping = {
            'grid_info': grid_info,
            'frame_corners': frame_corners,
            'hugin_pto': hugin_pto,
        }
        return panorama, stats, mapping
