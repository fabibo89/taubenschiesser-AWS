#!/usr/bin/env python3
"""
Hugin/Panotools Stitching mit Matrix-Ausgabe
Verwendet Hugin's auto-pano-sift oder PTStitcher
"""

import subprocess
import json
from pathlib import Path
import cv2
import numpy as np
import re

def stitch_with_hugin(images_dir, output_dir):
    """Stitch Bilder mit Hugin und extrahiere Matrizen aus .pto Datei"""
    
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Lade alle Bilder
    image_files = sorted(images_dir.glob("image_*.jpg"))
    if not image_files:
        print(f"Keine Bilder gefunden in {images_dir}")
        return
    
    print(f"Verwende {len(image_files)} Bilder mit Hugin...")
    
    # 1. Erstelle .pto Datei
    pto_file = output_dir / "panorama.pto"
    
    print("\n1. Erstelle .pto Datei...")
    try:
        # Versuche auto-pano-sift
        cmd = [
            "auto-pano-sift",
            "--projection", "0",  # 0 = rectilinear
            "--fov", "66",
            "--output", str(pto_file)
        ] + [str(img) for img in image_files]
        
        print(f"  Versuche: auto-pano-sift")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0 or not pto_file.exists():
            print(f"  ⚠️  auto-pano-sift Fehler oder Datei nicht erstellt")
            print("  → Erstelle .pto manuell...")
            create_pto_manually(image_files, pto_file)
        else:
            print(f"  ✓ .pto Datei erstellt: {pto_file}")
    
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("  ⚠️  auto-pano-sift nicht gefunden oder Timeout")
        print("  → Erstelle .pto manuell...")
        create_pto_manually(image_files, pto_file)
    
    # 2. Optimiere .pto Datei (optional)
    print("\n2. Optimiere .pto Datei...")
    try:
        # pto_gen - erstellt Basis .pto
        if not pto_file.exists():
            cmd = ["pto_gen", "-o", str(pto_file)] + [str(img) for img in image_files]
            subprocess.run(cmd, check=True, capture_output=True, timeout=30)
        
        # cpfind - findet Kontrollpunkte
        try:
            cmd = ["cpfind", "-o", str(pto_file), str(pto_file)]
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            print("  ✓ Kontrollpunkte gefunden")
        except:
            print("  ⚠️  cpfind übersprungen")
        
        # autooptimiser - optimiert Parameter
        try:
            cmd = ["autooptimiser", "-a", "-m", "-s", "-o", str(pto_file), str(pto_file)]
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            print("  ✓ Parameter optimiert")
        except:
            print("  ⚠️  autooptimiser übersprungen")
    
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"  ⚠️  Optimierung übersprungen: {e}")
    
    # 3. Rendere Panorama
    print("\n3. Rendere Panorama...")
    panorama_path = output_dir / "panorama_hugin.jpg"
    
    try:
        # Versuche hugin_executor
        cmd = [
            "hugin_executor",
            "--stitching",
            "--prefix", str(output_dir / "panorama_hugin"),
            str(pto_file)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            # Suche nach erstelltem Panorama
            possible_paths = [
                output_dir / "panorama_hugin.jpg",
                output_dir / "panorama_hugin.tif",
                output_dir / "panorama_hugin0000.tif"
            ]
            
            for path in possible_paths:
                if path.exists():
                    if path.suffix == '.tif':
                        # Konvertiere TIF zu JPG
                        img = cv2.imread(str(path))
                        if img is not None:
                            cv2.imwrite(str(panorama_path), img)
                            print(f"  ✓ Panorama gerendert: {panorama_path}")
                            break
                    else:
                        panorama_path = path
                        print(f"  ✓ Panorama gerendert: {panorama_path}")
                        break
        else:
            raise subprocess.CalledProcessError(result.returncode, cmd)
    
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        print("  ⚠️  hugin_executor nicht verfügbar oder Fehler")
        print("  → Versuche nona + enblend...")
        
        try:
            # Alternative mit nona
            cmd = ["nona", "-o", str(output_dir / "panorama_hugin"), str(pto_file)]
            subprocess.run(cmd, check=True, timeout=300, capture_output=True)
            
            # Finde erstellte TIF-Dateien
            tif_files = sorted(output_dir.glob("panorama_hugin*.tif"))
            if tif_files:
                # Konvertiere erste TIF zu JPG
                img = cv2.imread(str(tif_files[0]))
                if img is not None:
                    cv2.imwrite(str(panorama_path), img)
                    print(f"  ✓ Panorama gerendert: {panorama_path}")
        except Exception as e:
            print(f"  ✗ Rendering fehlgeschlagen: {e}")
            print("  ⚠️  Rendering übersprungen, extrahiere trotzdem Matrizen aus .pto Datei...")
            panorama_path = None  # Kein Panorama gerendert
    
    # 4. Extrahiere Matrizen aus .pto Datei
    print("\n4. Extrahiere Matrizen aus .pto Datei...")
    
    if not pto_file.exists():
        print(f"  ✗ .pto Datei nicht gefunden: {pto_file}")
        return
    
    matrices = parse_pto_file(pto_file, image_files)
    
    if matrices:
        matrices_path = output_dir / "matrices_hugin.json"
        with open(matrices_path, 'w') as f:
            json.dump({
                'pto_file': str(pto_file),
                'panorama_file': str(panorama_path) if panorama_path and panorama_path.exists() else None,
                'num_images': len(image_files),
                'matrices': matrices
            }, f, indent=2)
        print(f"  ✓ Matrizen gespeichert: {matrices_path}")
        print(f"  ✓ {len(matrices)} Matrizen extrahiert")
    else:
        print("  ⚠️  Keine Matrizen extrahiert")

def create_pto_manually(image_files, pto_file):
    """Erstelle .pto Datei manuell"""
    with open(pto_file, 'w') as f:
        f.write("# hugin project file\n")
        f.write("#hugin_ptoversion 2\n")
        f.write(f"p f0 w3000 h2000 v360  n\"JPEG q90\"\n")
        f.write(f"m g1 i0 f0 m2 p0.00784314\n")
        
        for i, img_path in enumerate(image_files):
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            
            h, w = img.shape[:2]
            fov = 66  # FOV in Grad
            
            # i-Zeile: Bild-Definition
            # Format: i w<width> h<height> f<fov> v<view> Ra0 Rb0 Rc0 Rd0 Re0 Eev0 Er1 Eb1 r<pitch> p<yaw> y<roll> ...
            f.write(f"i w{w} h{h} f0 v{90} Ra0 Rb0 Rc0 Rd0 Re0 Eev0 Er1 Eb1 r0 p0 y0 TrX0 TrY0 TrZ0 Tpy0 Tpp0 j0 a0 b0 c0 d0 e0 g0 t0 Va1 Vb0 Vc0 Vd0 Vx0 Vy0  Vm5 n\"{img_path.name}\"\n")

def parse_pto_file(pto_file, image_files):
    """Parse .pto Datei und extrahiere Transformations-Matrizen"""
    matrices = []
    
    if not pto_file.exists():
        return matrices
    
    try:
        with open(pto_file, 'r') as f:
            lines = f.readlines()
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            # i-Zeile = Bild-Definition
            if line.startswith('i '):
                parts = line.split()
                
                # Extrahiere Parameter
                params = {}
                for part in parts:
                    if '=' in part:
                        key, value = part.split('=', 1)
                        params[key] = value
                    elif part.startswith('w'):
                        params['width'] = int(part[1:])
                    elif part.startswith('h'):
                        params['height'] = int(part[1:])
                    elif part.startswith('f'):
                        params['fov'] = float(part[1:])
                    elif part.startswith('v'):
                        params['view'] = float(part[1:])
                    elif part.startswith('r'):
                        params['pitch'] = float(part[1:])
                    elif part.startswith('p'):
                        params['yaw'] = float(part[1:])
                    elif part.startswith('y'):
                        params['roll'] = float(part[1:])
                    elif part.startswith('TrX'):
                        params['trans_x'] = float(part[3:])
                    elif part.startswith('TrY'):
                        params['trans_y'] = float(part[3:])
                    elif part.startswith('TrZ'):
                        params['trans_z'] = float(part[3:])
                    elif part.startswith('n"'):
                        # Bildname
                        params['name'] = part[2:-1] if part.endswith('"') else part[2:]
                
                # Berechne Transformations-Matrix aus Parametern
                # Hugin verwendet Euler-Winkel (pitch, yaw, roll) und Translation
                pitch = params.get('pitch', 0.0)
                yaw = params.get('yaw', 0.0)
                roll = params.get('roll', 0.0)
                trans_x = params.get('trans_x', 0.0)
                trans_y = params.get('trans_y', 0.0)
                trans_z = params.get('trans_z', 0.0)
                
                # Konvertiere zu Rotations-Matrix (vereinfacht)
                # Für Panorama: Normalerweise nur Translation in X-Richtung
                H = np.array([
                    [1.0, 0.0, trans_x],
                    [0.0, 1.0, trans_y],
                    [0.0, 0.0, 1.0]
                ], dtype=np.float32)
                
                # Finde Bild-Index
                img_name = params.get('name', f"image_{len(matrices)}.jpg")
                img_index = len(matrices)
                for idx, img_file in enumerate(image_files):
                    if img_file.name == img_name:
                        img_index = idx
                        break
                
                matrices.append({
                    'image_index': img_index,
                    'image_name': img_name,
                    'H_matrix': H.tolist(),
                    'parameters': {
                        'pitch': pitch,
                        'yaw': yaw,
                        'roll': roll,
                        'trans_x': trans_x,
                        'trans_y': trans_y,
                        'trans_z': trans_z,
                        'fov': params.get('fov', 66),
                        'width': params.get('width', 0),
                        'height': params.get('height', 0)
                    }
                })
        
        print(f"  ✓ {len(matrices)} Matrizen aus .pto extrahiert")
        
    except Exception as e:
        print(f"  ✗ Fehler beim Parsen der .pto Datei: {e}")
        import traceback
        traceback.print_exc()
    
    return matrices

if __name__ == "__main__":
    script_dir = Path(__file__).parent
    images_dir = script_dir / "images"
    output_dir = script_dir / "results_hugin"
    
    stitch_with_hugin(images_dir, output_dir)

