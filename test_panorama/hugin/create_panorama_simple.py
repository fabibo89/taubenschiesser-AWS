#!/usr/bin/env python3
"""
Erstellt ein Panorama mit Hugin OHNE Kameraparameter.
Hugin findet automatisch die richtigen Parameter.

Das Script:
1. Lädt Bilder aus input/
2. Erstellt eine .pto Datei mit pto_gen (automatisch)
3. Führt Hugin-Tools aus (cpfind, autooptimiser, nona, enblend)
4. Speichert das Panorama in panorama/
"""

import os
import sys
import subprocess
from pathlib import Path
from typing import Optional
import cv2
import re

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


def print_pto_angles(pto_file: Path):
    """
    Liest und gibt die yaw/pitch Winkel aus der .pto Datei aus.
    """
    if not pto_file.exists():
        print("⚠️  .pto Datei nicht gefunden")
        return
    
    print("\n📐 Hugin-Winkel aus .pto Datei:")
    print("   " + "-" * 60)
    
    try:
        with open(pto_file, 'r') as f:
            for line in f:
                if line.startswith('i '):
                    filename_match = re.search(r'n"([^"]+)"', line)
                    if filename_match:
                        full_path = filename_match.group(1)
                        img_name = Path(full_path).name
                        
                        pitch_match = re.search(r'\br([+-]?\d+\.?\d*)', line)
                        yaw_match = re.search(r'\bp([+-]?\d+\.?\d*)', line)
                        roll_match = re.search(r'\by([+-]?\d+\.?\d*)', line)
                        
                        if pitch_match and yaw_match:
                            pitch = float(pitch_match.group(1))
                            yaw = float(yaw_match.group(1))
                            roll = float(roll_match.group(1)) if roll_match else 0.0
                            
                            print(f"   {img_name:15s} → yaw={yaw:7.2f}°  pitch={pitch:7.2f}°  roll={roll:7.2f}°")
        
        print("   " + "-" * 60)
        
        # Lese auch Panorama-Parameter
        with open(pto_file, 'r') as f:
            for line in f:
                if line.startswith('p '):
                    v_match = re.search(r'\bv(\d+\.?\d*)', line)
                    if v_match:
                        hfov = float(v_match.group(1))
                        print(f"   Panorama HFOV: {hfov}°")
                        break
    except Exception as e:
        print(f"⚠️  Fehler beim Lesen der Winkel: {e}")


def run_hugin_stitching(image_files: list, output_dir: Path) -> Optional[Path]:
    """
    Führt komplette Hugin-Stitching-Pipeline aus.
    """
    output_dir.mkdir(exist_ok=True)
    
    # Finde Hugin-Tools
    pto_gen_path = find_hugin_tool("pto_gen")
    cpfind_path = find_hugin_tool("cpfind")
    autooptimiser_path = find_hugin_tool("autooptimiser")
    nona_path = find_hugin_tool("nona")
    enblend_path = find_hugin_tool("enblend")
    
    if not pto_gen_path or not nona_path:
        print("❌ Hugin-Tools nicht gefunden!")
        print("   Installiere Hugin: https://hugin.sourceforge.io/")
        if not pto_gen_path:
            print("   Fehlt: pto_gen")
        if not nona_path:
            print("   Fehlt: nona")
        return None
    
    print(f"🔧 Verwende Hugin-Tools:")
    print(f"   pto_gen: {pto_gen_path}")
    if cpfind_path:
        print(f"   cpfind: {cpfind_path}")
    if autooptimiser_path:
        print(f"   autooptimiser: {autooptimiser_path}")
    print(f"   nona: {nona_path}")
    if enblend_path:
        print(f"   enblend: {enblend_path}")
    
    pto_file = output_dir / "panorama.pto"
    panorama_tif_path = output_dir / "panorama.tif"
    panorama_jpg_path = output_dir / "panorama.jpg"
    
    # 1. Erstelle .pto Datei mit pto_gen
    print(f"\n1️⃣  Erstelle .pto Datei mit pto_gen...")
    try:
        cmd = [pto_gen_path, "-o", str(pto_file)] + [str(img) for img in image_files]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0 and pto_file.exists():
            print(f"   ✅ .pto Datei erstellt: {pto_file}")
        else:
            print(f"   ❌ pto_gen Fehler (exit code {result.returncode})")
            if result.stderr:
                print(f"      {result.stderr[:200]}")
            return None
    except Exception as e:
        print(f"   ❌ pto_gen Fehler: {e}")
        return None
    
    # 2. Kontrollpunkte finden mit Pre-Alignment
    if cpfind_path:
        print("\n2️⃣  Suche Kontrollpunkte mit cpfind (--prealigned)...")
        try:
            cmd = [cpfind_path, "--prealigned", "-o", str(pto_file), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode == 0:
                print("   ✅ Kontrollpunkte gefunden")
            else:
                print(f"   ⚠️  cpfind Fehler (exit code {result.returncode})")
                if result.stderr:
                    print(f"      {result.stderr[:200]}")
        except Exception as e:
            print(f"   ⚠️  cpfind Fehler: {e}")
    else:
        print("\n2️⃣  cpfind nicht verfügbar, überspringe Kontrollpunkt-Suche")
    
    # 3. Parameter optimieren
    if autooptimiser_path:
        print("\n3️⃣  Optimiere Parameter mit autooptimiser...")
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
        print("\n3️⃣  autooptimiser nicht verfügbar, überspringe Optimierung")
    
    # Zeige finale Winkel
    print_pto_angles(pto_file)
    
    # 4. Panorama rendern
    print("\n4️⃣  Rendere Panorama mit nona...")
    try:
        cmd = [nona_path, "-o", str(output_dir / "panorama"), str(pto_file)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            # Finde erstellte TIF-Dateien
            tif_files = sorted(output_dir.glob("panorama*.tif"))
            if tif_files:
                print(f"   ✅ {len(tif_files)} TIF-Dateien gerendert")
                
                # 5. Bilder zusammenfügen
                if enblend_path and len(tif_files) > 1:
                    print("\n5️⃣  Füge Bilder mit enblend zusammen...")
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
                        print(f"      Größe: {img.shape[1]}x{img.shape[0]}")
                        return panorama_jpg_path
                elif len(tif_files) > 1:
                    # Mehrere TIF-Dateien, aber enblend nicht verfügbar
                    print(f"   ⚠️  {len(tif_files)} TIF-Dateien erstellt, aber enblend nicht verfügbar")
                    print(f"   → Verwende erste TIF-Datei (unvollständig)")
                    img = cv2.imread(str(tif_files[0]))
                    if img is not None:
                        cv2.imwrite(str(panorama_jpg_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                        print(f"   ✅ Panorama gespeichert (nur Teil): {panorama_jpg_path}")
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


def main():
    print("🎬 Hugin Panorama-Erstellung (ohne Kameraparameter)\n")
    
    # Prüfe Input-Verzeichnis
    if not INPUT_DIR.exists():
        print(f"❌ Input-Verzeichnis nicht gefunden: {INPUT_DIR}")
        sys.exit(1)
    
    # Lade Bilder
    image_files = sorted(INPUT_DIR.glob("image_*.jpg"))
    if not image_files:
        print(f"❌ Keine Bilder gefunden in {INPUT_DIR}")
        print(f"   Erwartete Dateien: image_1.jpg, image_2.jpg, ...")
        sys.exit(1)
    
    print(f"📸 {len(image_files)} Bilder gefunden:")
    for img in image_files:
        print(f"   - {img.name}")
    
    # Führe Hugin-Stitching aus
    panorama_path = run_hugin_stitching(image_files, PANORAMA_DIR)
    
    if panorama_path:
        print(f"\n✅ Panorama erfolgreich erstellt!")
        print(f"   📁 Dateien in: {PANORAMA_DIR}")
        print(f"   🖼️  Panorama: {panorama_path}")
    else:
        print(f"\n❌ Panorama-Erstellung fehlgeschlagen")
        print(f"   📁 Prüfe: {PANORAMA_DIR}")


if __name__ == "__main__":
    main()

