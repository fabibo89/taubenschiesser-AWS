#!/usr/bin/env python3
"""
Erstellt ein Panorama mit Hugin unter Verwendung der Kameraparameter
aus camera_params.json.

Das Script:
1. Lädt Bilder aus input/
2. Liest Kameraparameter aus camera_params.json
3. Erstellt eine .pto Datei mit Startwerten
4. Führt Hugin-Tools aus (cpfind, autooptimiser, nona, enblend)
5. Speichert das Panorama in panorama/
"""

import os
import sys
import json
import subprocess
import math
import re
from pathlib import Path
from typing import Dict, List, Optional
import cv2

# Script-Verzeichnis
SCRIPT_DIR = Path(__file__).parent.absolute()
if SCRIPT_DIR.name == 'hugin':
    HUGIN_DIR = SCRIPT_DIR
else:
    HUGIN_DIR = SCRIPT_DIR / 'hugin'
    if not HUGIN_DIR.exists():
        cwd = Path.cwd()
        if (cwd / 'hugin').exists():
            HUGIN_DIR = cwd / 'hugin'
        elif cwd.name == 'hugin':
            HUGIN_DIR = cwd

INPUT_DIR = HUGIN_DIR / "input"
PARAMS_FILE = INPUT_DIR / "camera_params.json"
PANORAMA_DIR = HUGIN_DIR / "panorama"


def find_hugin_tool(tool_name: str) -> Optional[str]:
    """Finde Hugin-Tool in verschiedenen möglichen Pfaden"""
    possible_paths = [
        f"/Applications/Hugin/Hugin.app/Contents/MacOS/{tool_name}",
        f"/Applications/Hugin/tools_mac/{tool_name}",
        f"/Applications/Hugin/PTBatcherGUI.app/Contents/MacOS/{tool_name}",
        tool_name  # Fallback: im PATH
    ]
    
    for path in possible_paths:
        if Path(path).exists():
            return path
    
    return None


def load_camera_params() -> Dict:
    """Lädt Kameraparameter aus JSON-Datei"""
    if not PARAMS_FILE.exists():
        print(f"❌ camera_params.json nicht gefunden: {PARAMS_FILE}")
        return {}
    
    try:
        with open(PARAMS_FILE, 'r', encoding='utf-8') as f:
            params = json.load(f)
        print(f"✅ Kameraparameter geladen: {len(params)} Bilder")
        return params
    except Exception as e:
        print(f"❌ Fehler beim Laden der Parameter: {e}")
        return {}


def get_image_size(image_path: Path) -> tuple:
    """Ermittelt Bildgröße"""
    try:
        img = cv2.imread(str(image_path))
        if img is not None:
            return (img.shape[1], img.shape[0])  # (width, height)
    except:
        pass
    return (3280, 2464)  # Fallback


def rotation_to_yaw(rotation: float) -> float:
    """
    Konvertiert Rotation (0-360°) zu Hugin Yaw.
    
    PROBLEM: Die direkte Konvertierung funktioniert nicht gut, weil:
    - Hugin verwendet ein sphärisches Koordinatensystem
    - Die mechanischen Winkel (rotation/tilt) entsprechen nicht direkt Hugin's yaw/pitch
    - pto_gen findet die Parameter automatisch besser
    
    Diese Funktion wird nicht mehr verwendet - wir lassen pto_gen die Arbeit machen.
    """
    # Diese Konvertierung ist problematisch - nicht verwenden
    return rotation


def tilt_to_pitch(tilt: float) -> float:
    """
    Konvertiert Tilt zu Hugin Pitch.
    
    PROBLEM: Siehe rotation_to_yaw
    """
    # Diese Konvertierung ist problematisch - nicht verwenden
    return tilt


def zoom_to_fov(base_fov: float, zoom: float) -> float:
    """
    Berechnet effektives FOV basierend auf Zoom.
    Zoom 1x = base_fov, Zoom 2x = base_fov/2, etc.
    """
    if zoom <= 0:
        zoom = 1.0
    return base_fov / zoom


def create_pto_with_camera_angles(image_files: List[Path], camera_params: Dict, output_pto: Path) -> bool:
    """
    Erstellt .pto Datei mit rotation/tilt als Startwerte.
    Hugin optimiert diese dann automatisch mit cpfind/autooptimiser.
    """
    try:
        with open(output_pto, 'w') as f:
            # Header
            f.write("# hugin project file\n")
            f.write("#hugin_ptoversion 2\n")
            f.write("p f0 w6000 h3000 v140  n\"JPEG q90\"\n")
            f.write("m g1 i0 f0 m2 p0.00784314\n")
            
            # Sortiere Bilder nach order
            image_params = []
            for img_file in image_files:
                img_name = img_file.name
                if img_name in camera_params:
                    params = camera_params[img_name].copy()
                    params['filename'] = img_name
                    params['filepath'] = img_file
                    image_params.append(params)
            
            image_params.sort(key=lambda x: x.get('order', 999))
            
            if not image_params:
                print("⚠️  Keine Parameter für Bilder gefunden, verwende Standardwerte")
                image_params = [{'filename': img.name, 'filepath': img, 'rotation': 0, 'tilt': 0, 'zoom': 1, 'fov': 75} 
                               for img in image_files]
            
            # Erstelle i-Zeile für jedes Bild
            for params in image_params:
                img_file = params['filepath']
                img_name = params['filename']
                
                # Bildgröße
                width, height = get_image_size(img_file)
                
                # Parameter
                rotation = params.get('rotation', 0)
                tilt = params.get('tilt', 0)
                zoom = params.get('zoom', 1.0)
                base_fov = params.get('fov', 75)
                fov = zoom_to_fov(base_fov, zoom)
                
                # Verwende rotation/tilt direkt als Startwerte
                # r = pitch (tilt), p = yaw (rotation)
                # Hugin wird diese Werte optimieren
                yaw = rotation  # Direkt verwenden
                pitch = tilt    # Direkt verwenden
                
                # i-Zeile Format
                f.write(f"i w{width} h{height} f{fov} v{90} Ra0 Rb0 Rc0 Rd0 Re0 Eev0 Er1 Eb1 ")
                f.write(f"r{pitch} p{yaw} y0 TrX0 TrY0 TrZ0 Tpy0 Tpp0 j0 a0 b0 c0 d0 e0 g0 t0 ")
                f.write(f"Va1 Vb0 Vc0 Vd0 Vx0 Vy0 Vm5 n\"{img_file.absolute()}\"\n")
                
                print(f"  ✓ {img_name}: rotation={rotation}° → yaw={yaw}°, tilt={tilt}° → pitch={pitch}°, fov={fov:.1f}°")
            
            print(f"\n✅ .pto Datei erstellt mit rotation/tilt als Startwerte: {output_pto}")
            print("   → Hugin wird diese Werte optimieren")
            return True
            
    except Exception as e:
        print(f"❌ Fehler beim Erstellen der .pto Datei: {e}")
        import traceback
        traceback.print_exc()
        return False


def set_pto_fov(pto_file: Path, camera_params: Dict, fov_value: float = 75.0) -> bool:
    """
    Setzt den FOV (v Parameter) für alle Bilder in der .pto Datei fest.
    Verwendet fov aus camera_params, oder den angegebenen fov_value.
    """
    if not camera_params:
        return True
    
    try:
        with open(pto_file, 'r') as f:
            lines = f.readlines()
        
        new_lines = []
        adjusted_count = 0
        
        for line in lines:
            if line.startswith('i '):
                # Extrahiere Dateinamen
                filename_match = re.search(r'n"([^"]+)"', line)
                if filename_match:
                    full_path = filename_match.group(1)
                    img_name = Path(full_path).name
                    
                    if img_name in camera_params:
                        params = camera_params[img_name]
                        # Verwende FOV aus camera_params, oder fallback auf fov_value
                        target_fov = params.get('fov', fov_value)
                        
                        # Ersetze v Parameter
                        # Format: v50 oder v=0
                        line = re.sub(r'\bv[=]?([+-]?\d+\.?\d*)', f'v{target_fov}', line)
                        
                        adjusted_count += 1
                        print(f"  ✓ {img_name}: FOV auf {target_fov}° gesetzt")
            
            new_lines.append(line)
        
        if adjusted_count > 0:
            with open(pto_file, 'w') as f:
                f.writelines(new_lines)
            print(f"✅ {adjusted_count} Bilder mit FOV={fov_value}° angepasst")
            return True
        else:
            print("⚠️  Keine Bilder zum Anpassen gefunden")
            return True
            
    except Exception as e:
        print(f"⚠️  Fehler beim Setzen des FOV: {e}")
        return True  # Nicht kritisch, weiter machen


def adjust_pto_angles(pto_file: Path, camera_params: Dict) -> bool:
    """
    Passt die yaw/pitch Werte in einer bestehenden .pto Datei an.
    Verwendet rotation/tilt aus camera_params.
    """
    if not camera_params:
        return True  # Keine Anpassung nötig
    
    try:
        with open(pto_file, 'r') as f:
            lines = f.readlines()
        
        new_lines = []
        adjusted_count = 0
        
        for line in lines:
            if line.startswith('i '):
                # Extrahiere Dateinamen
                filename_match = re.search(r'n"([^"]+)"', line)
                if filename_match:
                    full_path = filename_match.group(1)
                    img_name = Path(full_path).name
                    
                    if img_name in camera_params:
                        params = camera_params[img_name]
                        rotation = params.get('rotation', 0)
                        tilt = params.get('tilt', 0)
                        
                        # Ersetze r (pitch) und p (yaw) Werte
                        # Format: r-1.107 p44.253 ...
                        line = re.sub(r'\br([+-]?\d+\.?\d*)', f'r{tilt}', line)
                        line = re.sub(r'\bp([+-]?\d+\.?\d*)', f'p{rotation}', line)
                        
                        adjusted_count += 1
                        print(f"  ✓ {img_name}: rotation={rotation}° → yaw, tilt={tilt}° → pitch")
            
            new_lines.append(line)
        
        if adjusted_count > 0:
            with open(pto_file, 'w') as f:
                f.writelines(new_lines)
            print(f"✅ {adjusted_count} Bilder mit rotation/tilt angepasst")
            return True
        else:
            print("⚠️  Keine Bilder zum Anpassen gefunden")
            return True
            
    except Exception as e:
        print(f"⚠️  Fehler beim Anpassen der Winkel: {e}")
        return True  # Nicht kritisch, weiter machen


def create_pto_file_with_params(image_files: List[Path], camera_params: Dict, output_pto: Path, use_camera_angles: bool = True) -> bool:
    """
    Erstellt eine .pto Datei mit pto_gen und passt dann die Winkel an.
    
    Wenn use_camera_angles=True: Passt yaw/pitch basierend auf rotation/tilt an
    Wenn use_camera_angles=False: Verwendet nur pto_gen (automatisch)
    """
    # Verwende pto_gen für korrekte .pto Struktur
    pto_gen_path = find_hugin_tool("pto_gen")
    
    if not pto_gen_path:
        print("❌ pto_gen nicht gefunden!")
        return False
    
    print("📝 Erstelle .pto Datei mit pto_gen...")
    try:
        cmd = [pto_gen_path, "-o", str(output_pto)] + [str(img) for img in image_files]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0 or not output_pto.exists():
            print(f"❌ pto_gen Fehler (exit code {result.returncode})")
            if result.stderr:
                print(f"   {result.stderr[:200]}")
            return False
        
        print(f"✅ .pto Datei erstellt: {output_pto}")
    except Exception as e:
        print(f"❌ pto_gen Fehler: {e}")
        return False
    
    # Setze FOV auf 75° (vor cpfind, damit Hugin diese Werte als Startwerte verwendet)
    if use_camera_angles and camera_params:
        print("🔧 Setze FOV auf 75° für alle Bilder...")
        set_pto_fov(output_pto, camera_params, fov_value=75.0)
    
    # Passe Winkel an, wenn gewünscht
    if use_camera_angles and camera_params:
        print("🔧 Passe yaw/pitch Werte basierend auf rotation/tilt an...")
        adjust_pto_angles(output_pto, camera_params)
    
    return True


def run_hugin_stitching(pto_file: Path, output_dir: Path) -> Optional[Path]:
    """
    Führt Hugin-Stitching-Pipeline aus.
    """
    output_dir.mkdir(exist_ok=True)
    
    # Finde Hugin-Tools
    cpfind_path = find_hugin_tool("cpfind")
    autooptimiser_path = find_hugin_tool("autooptimiser")
    nona_path = find_hugin_tool("nona")
    enblend_path = find_hugin_tool("enblend")
    
    if not nona_path:
        print("❌ Hugin-Tools nicht gefunden!")
        print("   Installiere Hugin: https://hugin.sourceforge.io/")
        return None
    
    print(f"\n🔧 Verwende Hugin-Tools:")
    if cpfind_path:
        print(f"   cpfind: {cpfind_path}")
    if autooptimiser_path:
        print(f"   autooptimiser: {autooptimiser_path}")
    if nona_path:
        print(f"   nona: {nona_path}")
    if enblend_path:
        print(f"   enblend: {enblend_path}")
    
    # 1. Kontrollpunkte finden
    if cpfind_path:
        print("\n1️⃣  Suche Kontrollpunkte mit cpfind...")
        # Versuche zuerst mit --prealigned (nutzt Startwerte)
        try:
            cmd = [cpfind_path, "--prealigned", "-o", str(pto_file), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode == 0:
                print("   ✅ Kontrollpunkte gefunden (mit --prealigned)")
            else:
                # Fallback: Versuche ohne --prealigned
                print(f"   ⚠️  cpfind mit --prealigned fehlgeschlagen, versuche ohne...")
                cmd = [cpfind_path, "-o", str(pto_file), str(pto_file)]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
                if result.returncode == 0:
                    print("   ✅ Kontrollpunkte gefunden (ohne --prealigned)")
                else:
                    print(f"   ⚠️  cpfind Fehler (exit code {result.returncode})")
                    if result.stderr:
                        print(f"      {result.stderr[:200]}")
        except Exception as e:
            print(f"   ⚠️  cpfind Fehler: {e}")
    else:
        print("\n1️⃣  cpfind nicht verfügbar, überspringe Kontrollpunkt-Suche")
    
    # 2. Parameter optimieren
    if autooptimiser_path:
        print("\n2️⃣  Optimiere Parameter mit autooptimiser...")
        try:
            cmd = [autooptimiser_path, "-a", "-m", "-s", "-o", str(pto_file), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode == 0:
                print("   ✅ Parameter optimiert")
            else:
                print(f"   ⚠️  autooptimiser Fehler (exit code {result.returncode})")
                if result.stderr:
                    print(f"      {result.stderr[:200]}")
        except Exception as e:
            print(f"   ⚠️  autooptimiser Fehler: {e}")
    else:
        print("\n2️⃣  autooptimiser nicht verfügbar, überspringe Optimierung")
    
    # 3. Panorama rendern
    print("\n3️⃣  Rendere Panorama mit nona...")
    panorama_tif_path = output_dir / "panorama.tif"
    panorama_jpg_path = output_dir / "panorama.jpg"
    
    try:
        # nona erstellt mehrere TIF-Dateien
        cmd = [nona_path, "-o", str(output_dir / "panorama"), str(pto_file)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            # Finde erstellte TIF-Dateien
            tif_files = sorted(output_dir.glob("panorama*.tif"))
            if tif_files:
                print(f"   ✅ {len(tif_files)} TIF-Dateien gerendert")
                
                # 4. Bilder zusammenfügen
                if enblend_path and len(tif_files) > 1:
                    print("\n4️⃣  Füge Bilder mit enblend zusammen...")
                    try:
                        cmd = [
                            enblend_path,
                            "--output", str(panorama_tif_path),
                            "--compression=LZW"
                        ] + [str(tif) for tif in tif_files]
                        
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                        
                        if result.returncode == 0 and panorama_tif_path.exists():
                            print(f"   ✅ Panorama zusammengefügt: {panorama_tif_path}")
                            
                            # Konvertiere TIF zu JPG
                            img = cv2.imread(str(panorama_tif_path))
                            if img is not None:
                                cv2.imwrite(str(panorama_jpg_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                                print(f"   ✅ Panorama als JPG gespeichert: {panorama_jpg_path}")
                                print(f"      Größe: {img.shape[1]}x{img.shape[0]}")
                                return panorama_jpg_path
                    except Exception as e:
                        print(f"   ⚠️  enblend Fehler: {e}")
                
                # Fallback: Verwende erste TIF-Datei
                if len(tif_files) == 1:
                    img = cv2.imread(str(tif_files[0]))
                    if img is not None:
                        cv2.imwrite(str(panorama_jpg_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                        print(f"   ✅ Panorama gespeichert: {panorama_jpg_path}")
                        return panorama_jpg_path
        else:
            print(f"   ❌ nona Fehler (exit code {result.returncode})")
            if result.stderr:
                print(f"      {result.stderr[:200]}")
    except Exception as e:
        print(f"   ❌ Rendering fehlgeschlagen: {e}")
        import traceback
        traceback.print_exc()
    
    return None


def draw_coordinates_on_panorama(panorama_path: Path, pto_file: Path, camera_params: Dict):
    """
    Zeichnet rote Punkte für jede Koordinate (rotation, tilt) im Panorama.
    Berechnet Offset zwischen Kamera- und Hugin-Koordinatensystem.
    """
    if not panorama_path.exists() or not pto_file.exists():
        print("⚠️  Panorama oder .pto Datei nicht gefunden, überspringe Koordinaten-Zeichnung")
        return
    
    try:
        # Lade Panorama
        panorama = cv2.imread(str(panorama_path))
        if panorama is None:
            print("⚠️  Konnte Panorama nicht laden")
            return
        
        pano_height, pano_width = panorama.shape[:2]
        print(f"\n📍 Zeichne Koordinaten ins Panorama ({pano_width}x{pano_height})...")
        
        # Lese Panorama-Parameter aus .pto
        pano_hfov = 139.0
        with open(pto_file, 'r') as f:
            for line in f:
                if line.startswith('p '):
                    v_match = re.search(r'\bv(\d+\.?\d*)', line)
                    if v_match:
                        pano_hfov = float(v_match.group(1))
                        break
        
        print(f"  📐 Panorama HFOV: {pano_hfov}°")
        
        # Extrahiere Hugin-Winkel und berechne Offset
        pto_angles = {}
        with open(pto_file, 'r') as f:
            for line in f:
                if line.startswith('i '):
                    filename_match = re.search(r'n"([^"]+)"', line)
                    if filename_match:
                        full_path = filename_match.group(1)
                        img_name = Path(full_path).name
                        
                        pitch_match = re.search(r'\br([+-]?\d+\.?\d*)', line)
                        yaw_match = re.search(r'\bp([+-]?\d+\.?\d*)', line)
                        
                        if pitch_match and yaw_match:
                            pto_angles[img_name] = {
                                'pitch': float(pitch_match.group(1)),
                                'yaw': float(yaw_match.group(1))
                            }
        
        # Berechne Offset zwischen Koordinatensystemen
        # Verwende erstes Bild als Referenz
        offset_yaw = 0
        offset_pitch = 0
        first_found = False
        
        for img_name, params in camera_params.items():
            if img_name in pto_angles and not first_found:
                rotation = params.get('rotation', 0)
                tilt = params.get('tilt', 0)
                hugin_yaw = pto_angles[img_name]['yaw']
                hugin_pitch = pto_angles[img_name]['pitch']
                
                # Offset = Kamera-Wert - Hugin-Wert
                offset_yaw = rotation - hugin_yaw
                offset_pitch = tilt - hugin_pitch
                first_found = True
                print(f"  📐 Offset berechnet (basierend auf {img_name}):")
                print(f"     yaw offset: {offset_yaw:.1f}° (rotation={rotation}° - hugin_yaw={hugin_yaw:.1f}°)")
                print(f"     pitch offset: {offset_pitch:.1f}° (tilt={tilt}° - hugin_pitch={hugin_pitch:.1f}°)")
                break
        
        # In Hugin ist yaw=0 im Zentrum des Panoramas
        # yaw geht von -hfov/2 bis +hfov/2
        # Finde den yaw-Bereich für Debugging
        min_yaw = min([pto_angles[img]['yaw'] for img in pto_angles.keys() if img in camera_params])
        max_yaw = max([pto_angles[img]['yaw'] for img in pto_angles.keys() if img in camera_params])
        yaw_range = max_yaw - min_yaw
        print(f"  📊 Yaw-Bereich: {min_yaw:.1f}° bis {max_yaw:.1f}° (Spanne: {yaw_range:.1f}°)")
        print(f"  📐 Panorama HFOV: {pano_hfov}° → yaw von -{pano_hfov/2:.1f}° bis +{pano_hfov/2:.1f}°")
        
        # Zeichne Punkte basierend auf rotation/tilt (ROT) und Hugin yaw/pitch (BLAU)
        points_drawn_rot = 0
        points_drawn_hugin = 0
        
        for img_name, params in camera_params.items():
            rotation = params.get('rotation', 0)
            tilt = params.get('tilt', 0)
            
            # === ROT: Zeichne rotation/tilt (Kamera-Koordinaten) ===
            # Konvertiere rotation/tilt zu Hugin-Koordinaten (mit Offset)
            hugin_yaw = rotation - offset_yaw
            hugin_pitch = tilt - offset_pitch
            
            # Konvertiere zu Panorama-Pixel-Koordinaten
            # Verwende die gleiche Normalisierung wie für Hugin-Werte
            # yaw=0 ist Zentrum, yaw=±hfov/2 sind die Ränder
            yaw_normalized = (hugin_yaw / (pano_hfov / 2.0)) * 0.5 + 0.5
            x_rot = int(yaw_normalized * pano_width)
            
            pitch_normalized = -hugin_pitch / 180.0 + 0.5
            y_rot = int(pitch_normalized * pano_height)
            
            # Stelle sicher, dass Koordinaten im Bild liegen
            x_rot = max(0, min(pano_width - 1, x_rot))
            y_rot = max(0, min(pano_height - 1, y_rot))
            
            # Zeichne roten Punkt (rotation/tilt)
            cv2.circle(panorama, (x_rot, y_rot), 10, (0, 0, 255), -1)  # Rot, gefüllt
            cv2.circle(panorama, (x_rot, y_rot), 15, (0, 0, 255), 2)   # Rot, Umrandung
            
            # === BLAU: Zeichne Hugin yaw/pitch (optimierte Werte) ===
            if img_name in pto_angles:
                actual_yaw = pto_angles[img_name]['yaw']
                actual_pitch = pto_angles[img_name]['pitch']
                
                # Konvertiere zu Panorama-Pixel-Koordinaten
                # In Hugin: yaw=0 ist Zentrum, yaw=±hfov/2 sind die Ränder
                # Normalisiere: yaw / (hfov/2) gibt -1 bis +1, dann * 0.5 + 0.5 gibt 0 bis 1
                yaw_normalized_hugin = (actual_yaw / (pano_hfov / 2.0)) * 0.5 + 0.5
                x_hugin = int(yaw_normalized_hugin * pano_width)
                
                # pitch=0 ist Mitte, pitch>0 ist oben (in Hugin)
                pitch_normalized_hugin = -actual_pitch / 180.0 + 0.5
                y_hugin = int(pitch_normalized_hugin * pano_height)
                
                # Stelle sicher, dass Koordinaten im Bild liegen
                x_hugin = max(0, min(pano_width - 1, x_hugin))
                y_hugin = max(0, min(pano_height - 1, y_hugin))
                
                # Zeichne blauen Punkt (Hugin yaw/pitch)
                cv2.circle(panorama, (x_hugin, y_hugin), 10, (255, 0, 0), -1)  # Blau, gefüllt
                cv2.circle(panorama, (x_hugin, y_hugin), 15, (255, 0, 0), 2)   # Blau, Umrandung
                
                # Zeichne Nummer bei blauem Punkt
                img_num = img_name.replace('image_', '').replace('.jpg', '')
                text_hugin = f"{img_num}"
                # Text-Hintergrund für bessere Lesbarkeit
                (text_width, text_height), baseline = cv2.getTextSize(text_hugin, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                cv2.rectangle(panorama, (x_hugin + 20, y_hugin - text_height - 5), 
                            (x_hugin + 20 + text_width, y_hugin + baseline + 5), (255, 255, 255), -1)
                cv2.putText(panorama, text_hugin, (x_hugin + 20, y_hugin), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
                
                points_drawn_hugin += 1
            
            # Zeichne Nummer bei rotem Punkt
            img_num = img_name.replace('image_', '').replace('.jpg', '')
            text_rot = f"{img_num}"
            # Text-Hintergrund für bessere Lesbarkeit
            (text_width, text_height), baseline = cv2.getTextSize(text_rot, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
            cv2.rectangle(panorama, (x_rot + 20, y_rot - text_height - 5), 
                        (x_rot + 20 + text_width, y_rot + baseline + 5), (255, 255, 255), -1)
            cv2.putText(panorama, text_rot, (x_rot + 20, y_rot), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
            points_drawn_rot += 1
            if img_name in pto_angles:
                print(f"  ✓ {img_name}: ROT(rotation={rotation}°, tilt={tilt}°) → ({x_rot}, {y_rot}) | BLAU(yaw={pto_angles[img_name]['yaw']:.1f}°, pitch={pto_angles[img_name]['pitch']:.1f}°) → ({x_hugin}, {y_hugin})")
            else:
                print(f"  ✓ {img_name}: rotation={rotation}°, tilt={tilt}° → ({x_rot}, {y_rot})")
        
        if points_drawn_rot > 0 or points_drawn_hugin > 0:
            # Zeichne Legende
            legend_y = 30
            cv2.putText(panorama, "ROT: rotation/tilt (Kamera)", (10, legend_y), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.putText(panorama, "BLAU: yaw/pitch (Hugin optimiert)", (10, legend_y + 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
            
            # Speichere Panorama mit Punkten
            output_path = panorama_path.parent / f"{panorama_path.stem}_with_coordinates.jpg"
            cv2.imwrite(str(output_path), panorama, [cv2.IMWRITE_JPEG_QUALITY, 95])
            print(f"✅ {points_drawn_rot} ROT (rotation/tilt) und {points_drawn_hugin} BLAU (Hugin yaw/pitch) Punkte gezeichnet: {output_path}")
        else:
            print("⚠️  Keine Koordinaten gefunden zum Zeichnen")
            
    except Exception as e:
        print(f"⚠️  Fehler beim Zeichnen der Koordinaten: {e}")
        import traceback
        traceback.print_exc()


def main():
    print("🎬 Hugin Panorama-Erstellung mit Kameraparametern\n")
    
    # Prüfe Input-Verzeichnis
    if not INPUT_DIR.exists():
        print(f"❌ Input-Verzeichnis nicht gefunden: {INPUT_DIR}")
        sys.exit(1)
    
    # Lade Bilder
    image_files = sorted(INPUT_DIR.glob("image_*.jpg"))
    if not image_files:
        print(f"❌ Keine Bilder gefunden in {INPUT_DIR}")
        sys.exit(1)
    
    print(f"📸 {len(image_files)} Bilder gefunden")
    
    # Lade Kameraparameter
    camera_params = load_camera_params()
    
    # Erstelle .pto Datei
    pto_file = PANORAMA_DIR / "panorama.pto"
    PANORAMA_DIR.mkdir(exist_ok=True)
    
    print(f"\n📝 Erstelle .pto Datei...")
    # Verwende pto_gen ohne Winkel-Anpassung (wie _simple)
    # Die Winkel werden nur für die Visualisierung verwendet
    if not create_pto_file_with_params(image_files, camera_params, pto_file, use_camera_angles=False):
        sys.exit(1)
    
    # Führe Hugin-Stitching aus
    panorama_path = run_hugin_stitching(pto_file, PANORAMA_DIR)
    
    if panorama_path:
        print(f"\n✅ Panorama erfolgreich erstellt!")
        print(f"   📁 Dateien in: {PANORAMA_DIR}")
        print(f"   🖼️  Panorama: {panorama_path}")
        print(f"   📄 Projekt: {pto_file}")
        
        # Zeichne Koordinaten ins Panorama
        draw_coordinates_on_panorama(panorama_path, pto_file, camera_params)
    else:
        print(f"\n⚠️  Panorama-Erstellung abgeschlossen, aber möglicherweise mit Fehlern")
        print(f"   📁 Prüfe: {PANORAMA_DIR}")


if __name__ == "__main__":
    main()

