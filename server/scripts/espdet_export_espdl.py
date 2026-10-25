#!/usr/bin/env python3
"""
Export ESPDet .pt → ONNX → INT8 .espdl (ESP-DL / esp_ppq).

Logs → stderr; one JSON result line → stdout.

Progress lines (stderr):
  PHASE <name>
  PROGRESS <0-100> <phase> | <detail>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

DEFAULT_ESP_DETECTION_ROOT = "/Users/fabianbosch/Documents/GitHub/esp-detection"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ESPDet .pt → .espdl")
    p.add_argument("--weights", required=True, help="Path to ESPDet .pt")
    p.add_argument("--out", required=True, help="Output .espdl path")
    p.add_argument("--calib-dir", required=True, help="Folder of JPEG/PNG for INT8 calib")
    p.add_argument("--imgsz", type=int, default=224)
    p.add_argument("--target", default="esp32p4", choices=("esp32p4", "esp32s3"))
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--bits", type=int, default=8)
    p.add_argument("--device", default="cpu")
    p.add_argument(
        "--esp-detection-root",
        default=os.environ.get("ESP_DETECTION_ROOT", DEFAULT_ESP_DETECTION_ROOT),
    )
    return p.parse_args()


def ensure_espdet_path(root: str | None) -> str:
    if not root:
        raise RuntimeError("ESP_DETECTION_ROOT fehlt")
    root_path = Path(root).expanduser().resolve()
    if not (root_path / "nn").is_dir():
        raise RuntimeError(f"Kein esp-detection nn/ unter {root_path}")
    root_str = str(root_path)
    if root_str in sys.path:
        sys.path.remove(root_str)
    sys.path.insert(0, root_str)
    os.chdir(root_str)  # deploy.* imports expect repo cwd
    return root_str


def progress(pct: int, phase: str, detail: str = "") -> None:
    pct = max(0, min(100, int(pct)))
    detail = (detail or "").replace("\n", " ").strip()
    line = f"PROGRESS {pct} {phase}"
    if detail:
        line += f" | {detail}"
    print(line, file=sys.stderr, flush=True)
    print(f"PHASE {phase}", file=sys.stderr, flush=True)


def main() -> int:
    os.environ["YOLO_AUTOINSTALL"] = "False"
    args = parse_args()
    weights = Path(args.weights).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    calib = Path(args.calib_dir).expanduser().resolve()
    imgsz = int(args.imgsz)
    t0 = time.monotonic()

    def elapsed() -> str:
        return f"{time.monotonic() - t0:.0f}s"

    if not weights.is_file():
        print(f"Weights not found: {weights}", file=sys.stderr)
        return 2
    if not calib.is_dir():
        print(f"calib-dir not found: {calib}", file=sys.stderr)
        return 2
    calib_imgs = [
        p
        for p in calib.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp")
    ]
    if not calib_imgs:
        print(f"Keine Kalibrier-Bilder in {calib}", file=sys.stderr)
        return 2

    try:
        esp_root = ensure_espdet_path(args.esp_detection_root)
        print(f"esp-detection: {esp_root}", file=sys.stderr, flush=True)
        progress(
            5,
            "prepare",
            f"imgsz={imgsz} calib={len(calib_imgs)} target={args.target} (+{elapsed()})",
        )

        from deploy.export import Export

        onnx_path = weights.with_suffix(".onnx")
        progress(10, "onnx", f"starte ONNX-Export → {onnx_path.name} (+{elapsed()})")
        try:
            Export(str(weights), imgsz)
        except TypeError as exc:
            if not (
                "PathLike" in str(exc)
                or "tuple" in str(exc).lower()
                or "expected str" in str(exc)
            ):
                raise
            print(
                f"Warn: Ultralytics/esp-detection Path-tuple quirk (OK if ONNX exists): {exc}",
                file=sys.stderr,
                flush=True,
            )
        if not onnx_path.is_file():
            alt = Path(str(weights).replace(".pt", ".onnx"))
            if alt.is_file():
                onnx_path = alt
            else:
                raise FileNotFoundError(f"ONNX nach Export fehlt: {onnx_path}")

        onnx_mb = onnx_path.stat().st_size / (1024 * 1024)
        progress(
            25,
            "onnx",
            f"ONNX fertig ({onnx_mb:.1f} MB) (+{elapsed()})",
        )

        out.parent.mkdir(parents=True, exist_ok=True)
        progress(
            30,
            "quantize",
            f"INT8 startet (CPU, imgsz={imgsz}, ~32 Kalibrier-Schritte) (+{elapsed()})",
        )

        # Inline quantize (like deploy/quantize.py) so we can report calib batches.
        import onnx
        import torch
        from onnxsim import simplify
        from torch.utils.data import DataLoader
        from esp_ppq import QuantizationSettingFactory
        from esp_ppq.api import espdl_quantize_onnx
        from deploy.quantize import CaliDataset

        calib_steps = 32
        batchsz = max(1, int(args.batch))
        device = str(args.device)
        size_hw = [imgsz, imgsz]

        progress(32, "quantize", f"ONNX simplify… (+{elapsed()})")
        model_onnx = onnx.load(str(onnx_path))
        model_onnx, check = simplify(model_onnx)
        if not check:
            raise RuntimeError("onnxsim: Modell nicht valide")
        onnx.save(onnx.shape_inference.infer_shapes(model_onnx), str(onnx_path))
        progress(36, "quantize", f"simplify ok · lade Kalibrier-Set (+{elapsed()})")

        calibration_dataset = CaliDataset(str(calib), img_shape=size_hw)
        base_loader = DataLoader(
            dataset=calibration_dataset, batch_size=batchsz, shuffle=False
        )

        calib_seen = [0]

        class _CalibProgressLoader:
            """Wrap DataLoader so each PPQ calib fetch bumps PROGRESS."""

            def __init__(self, loader, steps: int):
                self._loader = loader
                self._steps = max(1, steps)
                self._it = None

            def __iter__(self):
                self._it = iter(self._loader)
                return self

            def __next__(self):
                try:
                    batch = next(self._it)
                except StopIteration:
                    self._it = iter(self._loader)
                    batch = next(self._it)
                calib_seen[0] += 1
                n = calib_seen[0]
                # Map calib fetches into 38% … 82%
                pct = 38 + int(min(n, self._steps) / self._steps * 44)
                progress(
                    pct,
                    "quantize",
                    f"Kalibrierung {min(n, self._steps)}/{self._steps} (+{elapsed()})",
                )
                return batch

            def __len__(self):
                return len(self._loader)

        dataloader = _CalibProgressLoader(base_loader, calib_steps)

        def collate_fn(batch: torch.Tensor) -> torch.Tensor:
            return batch.to(device)

        quant_setting = QuantizationSettingFactory.espdl_setting()
        quant_setting.equalization = True
        quant_setting.equalization_setting.iterations = 4
        quant_setting.equalization_setting.value_threshold = 0.4
        quant_setting.equalization_setting.opt_level = 2
        quant_setting.equalization_setting.interested_layers = None

        progress(
            38,
            "quantize",
            f"esp_ppq Quantize + Equalization (danach Export) (+{elapsed()})",
        )

        # Heartbeat while PPQ works between calib fetches / during export.
        stop_hb = {"v": False}

        def _heartbeat():
            while not stop_hb["v"]:
                time.sleep(8)
                if stop_hb["v"]:
                    break
                n = calib_seen[0]
                if n < calib_steps:
                    pct = 38 + int(n / calib_steps * 44)
                    progress(
                        pct,
                        "quantize",
                        f"noch aktiv… Kalibrierung {n}/{calib_steps} (+{elapsed()})",
                    )
                else:
                    progress(
                        84,
                        "quantize",
                        f"Equalization/Export läuft… (+{elapsed()})",
                    )

        import threading

        hb = threading.Thread(target=_heartbeat, daemon=True)
        hb.start()
        try:
            espdl_quantize_onnx(
                onnx_import_file=str(onnx_path),
                espdl_export_file=str(out),
                calib_dataloader=dataloader,
                calib_steps=calib_steps,
                input_shape=[1, 3, *size_hw],
                target=str(args.target),
                num_of_bits=int(args.bits),
                collate_fn=collate_fn,
                setting=quant_setting,
                device=device,
                error_report=True,
                skip_export=False,
                export_test_values=False,
                verbose=1,
                inputs=None,
            )
        finally:
            stop_hb["v"] = True

        if not out.is_file():
            raise FileNotFoundError(f".espdl wurde nicht geschrieben: {out}")

        bytes_out = out.stat().st_size
        progress(
            92,
            "quantize",
            f".espdl fertig ({bytes_out / 1024:.0f} KB) (+{elapsed()})",
        )
        progress(100, "done", f"gesamt {elapsed()}")
        payload = {
            "ok": True,
            "espdl": str(out),
            "onnx": str(onnx_path),
            "bytes": bytes_out,
            "imgsz": imgsz,
            "target": args.target,
            "calibImages": len(calib_imgs),
            "weights": str(weights),
            "elapsedSec": round(time.monotonic() - t0, 1),
        }
        print(json.dumps(payload, allow_nan=False), flush=True)
        return 0
    except Exception as exc:
        print(f"ESP export failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
