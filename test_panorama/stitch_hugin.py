#!/usr/bin/env python3
"""
Hugin/Panotools Stitching mit Matrix-Ausgabe
Verwendet Hugin's pto_gen, cpfind, autooptimiser, nona
"""

import subprocess
import json
from pathlib import Path
import cv2
import numpy as np
import re
import math

def project_point_to_panorama(img_x, img_y, width, height, fov, pitch, yaw, roll, 
                               pano_width, pano_height, pano_hfov):
    """Projiziere einen Bildpunkt direkt ins Panorama mit sphärischer Projektion"""
    # Normalisiere Bildkoordinaten auf [-1, 1]
    # WICHTIG: y=0 ist oben im Bild, y=height ist unten
    x_norm = (img_x / width) * 2 - 1
    y_norm = (img_y / height) * 2 - 1
    
    # Lokale Winkel (basierend auf FOV)
    fov_rad = math.radians(fov)
    local_theta = x_norm * (fov_rad / 2)
    local_phi = y_norm * (fov_rad / 2) * (height / width)  # Vorzeichen korrigiert für Fächer nach oben
    
    # Lokale Richtung (3D-Vektor)
    local_dir = np.array([
        math.tan(local_theta),
        math.tan(local_phi),
        1.0
    ])
    local_dir = local_dir / np.linalg.norm(local_dir)
    
    # Rotations-Matrix (Hugin: Roll um Z, Pitch um Y, Yaw um X)
    R_roll = np.array([
        [math.cos(roll), -math.sin(roll), 0],
        [math.sin(roll), math.cos(roll), 0],
        [0, 0, 1]
    ])
    R_pitch = np.array([
        [math.cos(pitch), 0, math.sin(pitch)],
        [0, 1, 0],
        [-math.sin(pitch), 0, math.cos(pitch)]
    ])
    R_yaw = np.array([
        [1, 0, 0],
        [0, math.cos(yaw), -math.sin(yaw)],
        [0, math.sin(yaw), math.cos(yaw)]
    ])
    R = R_roll @ R_pitch @ R_yaw
    
    # Transformiere in globale Richtung
    global_dir = R @ local_dir
    
    # Konvertiere zu sphärischen Koordinaten
    global_theta = math.atan2(global_dir[0], global_dir[2])
    global_phi = math.asin(global_dir[1])
    
    # Konvertiere zu Panorama-Pixel (equirectangular)
    # Verwende pano_hfov für X-Koordinate (nicht 360°)
    pano_hfov_rad = math.radians(pano_hfov)
    pano_x = (global_theta / pano_hfov_rad + 0.5) * pano_width + 100  # X-Offset optimiert
    # Y-Koordinate: Vorzeichen umgekehrt und Offset für korrekte Position
    pano_y = (global_phi / math.pi + 0.5) * pano_height + 400  # Y-Offset optimiert
    
    return int(pano_x), int(pano_y)

def find_hugin_tool(tool_name):
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
    
    # Finde Hugin-Tools
    pto_gen_path = find_hugin_tool("pto_gen")
    cpfind_path = find_hugin_tool("cpfind")
    autooptimiser_path = find_hugin_tool("autooptimiser")
    nona_path = find_hugin_tool("nona")
    enblend_path = find_hugin_tool("enblend")
    hugin_executor_path = find_hugin_tool("hugin_executor")
    
    if not pto_gen_path:
        print("  ✗ pto_gen nicht gefunden! Hugin-Tools sind nicht verfügbar.")
        return
    
    print(f"  ✓ Hugin-Tools gefunden:")
    print(f"    pto_gen: {pto_gen_path}")
    if cpfind_path:
        print(f"    cpfind: {cpfind_path}")
    if autooptimiser_path:
        print(f"    autooptimiser: {autooptimiser_path}")
    if nona_path:
        print(f"    nona: {nona_path}")
    if enblend_path:
        print(f"    enblend: {enblend_path}")
    
    # 1. Erstelle .pto Datei mit pto_gen
    pto_file = output_dir / "panorama.pto"
    
    print("\n1. Erstelle .pto Datei mit pto_gen...")
    try:
        cmd = [pto_gen_path, "-o", str(pto_file)] + [str(img) for img in image_files]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0 and pto_file.exists():
            print(f"  ✓ .pto Datei erstellt: {pto_file}")
            # Prüfe, ob die Datei gültig ist (nicht leer)
            if pto_file.stat().st_size < 100:
                print(f"  ⚠️  .pto Datei zu klein, erstelle manuell...")
                create_pto_manually(image_files, pto_file)
        else:
            print(f"  ⚠️  pto_gen Fehler (exit code {result.returncode}), erstelle .pto manuell...")
            if result.stderr:
                print(f"    Fehler: {result.stderr[:200]}")
            create_pto_manually(image_files, pto_file)
    
    except subprocess.TimeoutExpired:
        print(f"  ⚠️  pto_gen Timeout, erstelle .pto manuell...")
        create_pto_manually(image_files, pto_file)
    except Exception as e:
        print(f"  ⚠️  pto_gen Fehler: {e}")
        print("  → Erstelle .pto manuell...")
        create_pto_manually(image_files, pto_file)
    
    # 2. Optimiere .pto Datei
    print("\n2. Optimiere .pto Datei...")
    
    # cpfind - findet Kontrollpunkte
    if cpfind_path and pto_file.exists():
        try:
            print("  → Suche Kontrollpunkte mit cpfind...")
            cmd = [cpfind_path, "-o", str(pto_file), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode == 0:
                print("  ✓ Kontrollpunkte gefunden")
            else:
                print(f"  ⚠️  cpfind Fehler (exit code {result.returncode})")
        except Exception as e:
            print(f"  ⚠️  cpfind Fehler: {e}")
    else:
        print("  ⚠️  cpfind nicht verfügbar, überspringe Kontrollpunkt-Suche")
    
    # autooptimiser - optimiert Parameter
    if autooptimiser_path and pto_file.exists():
        try:
            print("  → Optimiere Parameter mit autooptimiser...")
            cmd = [autooptimiser_path, "-a", "-m", "-s", "-o", str(pto_file), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode == 0:
                print("  ✓ Parameter optimiert")
            else:
                print(f"  ⚠️  autooptimiser Fehler (exit code {result.returncode})")
        except Exception as e:
            print(f"  ⚠️  autooptimiser Fehler: {e}")
    else:
        print("  ⚠️  autooptimiser nicht verfügbar, überspringe Optimierung")
    
    # 3. Rendere Panorama
    print("\n3. Rendere Panorama...")
    panorama_path = output_dir / "panorama_hugin.jpg"
    panorama_tif_path = output_dir / "panorama_hugin.tif"
    
    if nona_path and pto_file.exists():
        try:
            print("  → Rendere einzelne Bilder mit nona...")
            cmd = [nona_path, "-o", str(output_dir / "panorama_hugin"), str(pto_file)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                # Finde erstellte TIF-Dateien
                tif_files = sorted(output_dir.glob("panorama_hugin*.tif"))
                if tif_files:
                    print(f"  ✓ {len(tif_files)} TIF-Dateien gerendert")
                    
                    # Füge alle TIF-Dateien mit enblend zusammen
                    if enblend_path and len(tif_files) > 1:
                        try:
                            print("  → Füge Bilder mit enblend zusammen...")
                            cmd = [
                                enblend_path,
                                "--output", str(panorama_tif_path),
                                "--compression=LZW"
                            ] + [str(tif) for tif in tif_files]
                            
                            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                            
                            if result.returncode == 0 and panorama_tif_path.exists():
                                print(f"  ✓ Panorama zusammengefügt: {panorama_tif_path}")
                                
                                # Konvertiere TIF zu JPG
                                img = cv2.imread(str(panorama_tif_path))
                                if img is not None:
                                    cv2.imwrite(str(panorama_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                                    print(f"  ✓ Panorama als JPG gespeichert: {panorama_path}")
                                    print(f"    Größe: {img.shape[1]}x{img.shape[0]}")
                                else:
                                    print("  ⚠️  Konnte TIF nicht laden")
                                    panorama_path = None
                            else:
                                print(f"  ⚠️  enblend Fehler (exit code {result.returncode})")
                                if result.stderr:
                                    print(f"    Fehler: {result.stderr[:200]}")
                                print("  ⚠️  enblend ist erforderlich für korrektes Zusammenfügen")
                                print("  → Verwende erste TIF-Datei als Fallback (unvollständig)")
                                # Fallback: Verwende erste TIF-Datei (unvollständig, aber besser als nichts)
                                img = cv2.imread(str(tif_files[0]))
                                if img is not None:
                                    cv2.imwrite(str(panorama_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                                    print(f"    ⚠️  Fallback: Nur erste TIF-Datei verwendet")
                                    panorama_path = panorama_path
                                else:
                                    panorama_path = None
                        except Exception as e:
                            print(f"  ⚠️  enblend Fehler: {e}")
                            print("  ⚠️  enblend ist erforderlich für korrektes Zusammenfügen")
                            print("  → Verwende erste TIF-Datei als Fallback (unvollständig)")
                            # Fallback: Verwende erste TIF-Datei
                            img = cv2.imread(str(tif_files[0]))
                            if img is not None:
                                cv2.imwrite(str(panorama_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                                print(f"    ⚠️  Fallback: Nur erste TIF-Datei verwendet")
                                panorama_path = panorama_path
                            else:
                                panorama_path = None
                    else:
                        # Nur eine TIF-Datei oder enblend nicht verfügbar
                        if len(tif_files) == 1:
                            print("  ⚠️  Nur eine TIF-Datei - kein Zusammenfügen nötig")
                        else:
                            print("  ⚠️  enblend nicht verfügbar, verwende erste TIF-Datei")
                        
                        img = cv2.imread(str(tif_files[0]))
                        if img is not None:
                            cv2.imwrite(str(panorama_path), img)
                            print(f"  ✓ Panorama gerendert: {panorama_path}")
                        else:
                            panorama_path = None
                else:
                    print("  ⚠️  Keine TIF-Dateien gefunden")
                    panorama_path = None
            else:
                print(f"  ⚠️  nona Fehler (exit code {result.returncode})")
                if result.stderr:
                    print(f"    Fehler: {result.stderr[:200]}")
                panorama_path = None
        except Exception as e:
            print(f"  ✗ Rendering fehlgeschlagen: {e}")
            panorama_path = None
    else:
        print("  ⚠️  nona nicht verfügbar, überspringe Rendering")
        panorama_path = None
    
    # 4. Extrahiere Matrizen aus .pto Datei
    print("\n4. Extrahiere Matrizen aus .pto Datei...")
    
    if not pto_file.exists():
        print(f"  ✗ .pto Datei nicht gefunden: {pto_file}")
        return
    
    # Lade Panorama-Größe aus gerendertem Bild
    panorama_size = None
    if panorama_path and panorama_path.exists():
        panorama_img = cv2.imread(str(panorama_path))
        if panorama_img is not None:
            panorama_size = {'width': panorama_img.shape[1], 'height': panorama_img.shape[0]}
            print(f"  ✓ Panorama-Größe aus Bild: {panorama_size['width']}x{panorama_size['height']}")
    
    matrices = parse_pto_file(pto_file, image_files, panorama_size)
    
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
    
    # 5. Zeichne Umrandungen ins Panorama
    if panorama_path and panorama_path.exists() and matrices:
        print("\n5. Zeichne Umrandungen ins Panorama...")
        try:
            # Lade Panorama
            panorama = cv2.imread(str(panorama_path))
            if panorama is None:
                print("  ⚠️  Konnte Panorama nicht laden")
            else:
                # Farben für verschiedene Bilder
                colors = [
                    (0, 255, 0),      # Grün
                    (255, 0, 0),      # Blau
                    (0, 0, 255),      # Rot
                    (255, 255, 0),    # Cyan
                    (255, 0, 255),    # Magenta
                    (0, 255, 255),    # Gelb
                    (128, 0, 128),    # Lila
                    (255, 165, 0),    # Orange
                ]
                
                # Zeichne Rahmen für jedes Bild
                for i, matrix_data in enumerate(matrices):
                    img_name = matrix_data['image_name']
                    
                    # Extrahiere Dateinamen aus vollem Pfad
                    if '/' in img_name:
                        img_name = Path(img_name).name
                    
                    # Extrahiere Parameter
                    params = matrix_data['parameters']
                    pitch = math.radians(params.get('pitch', 0.0))
                    yaw = math.radians(params.get('yaw', 0.0))
                    roll = math.radians(params.get('roll', 0.0))
                    fov = params.get('fov', 66.0)
                    w_img = params.get('width', 3280)
                    h_img = params.get('height', 2464)
                    pano_hfov = params.get('pano_hfov', 140.0)
                    
                    # Verwende H-Matrix direkt aus Hugin (ohne manuelle sphärische Projektion)
                    H_matrix = np.array(matrix_data['H_matrix'], dtype=np.float32)
                    
                    # Generiere Punkte entlang der 4 Kanten (50 Punkte pro Kante für glatte Kurven)
                    points_per_edge = 50
                    edge_points = []
                    
                    # Obere Kante (von links nach rechts)
                    for j in range(points_per_edge + 1):
                        x = (w_img / points_per_edge) * j
                        edge_points.append([x, 0])
                    
                    # Rechte Kante (von oben nach unten)
                    for j in range(1, points_per_edge + 1):
                        y = (h_img / points_per_edge) * j
                        edge_points.append([w_img, y])
                    
                    # Untere Kante (von rechts nach links)
                    for j in range(points_per_edge - 1, -1, -1):
                        x = (w_img / points_per_edge) * j
                        edge_points.append([x, h_img])
                    
                    # Linke Kante (von unten nach oben)
                    for j in range(points_per_edge - 1, 0, -1):
                        y = (h_img / points_per_edge) * j
                        edge_points.append([0, y])
                    
                    # Transformiere alle Punkte mit H-Matrix direkt aus Hugin
                    edge_points_np = np.float32(edge_points).reshape(-1, 1, 2)
                    transformed = cv2.perspectiveTransform(edge_points_np, H_matrix)
                    transformed_points = [(int(pt[0][0]), int(pt[0][1])) for pt in transformed]
                    
                    # Zeichne Linien zwischen den Punkten
                    color = colors[i % len(colors)]
                    for j in range(len(transformed_points) - 1):
                        pt1 = transformed_points[j]
                        pt2 = transformed_points[j + 1]
                        # Prüfe, ob Punkte im Panorama-Bereich liegen
                        if (0 <= pt1[0] < panorama.shape[1] and 0 <= pt1[1] < panorama.shape[0] and
                            0 <= pt2[0] < panorama.shape[1] and 0 <= pt2[1] < panorama.shape[0]):
                            cv2.line(panorama, pt1, pt2, color, 3)
                    
                    # Schließe den Rahmen
                    if len(transformed_points) > 0:
                        pt_last = transformed_points[-1]
                        pt_first = transformed_points[0]
                        if (0 <= pt_last[0] < panorama.shape[1] and 0 <= pt_last[1] < panorama.shape[0] and
                            0 <= pt_first[0] < panorama.shape[1] and 0 <= pt_first[1] < panorama.shape[0]):
                            cv2.line(panorama, pt_last, pt_first, color, 3)
                        
                        # Zeichne Bildnummer
                        text_pos = transformed_points[0]
                        # Stelle sicher, dass Text-Position im Panorama liegt
                        text_x = max(10, min(text_pos[0] + 10, panorama.shape[1] - 100))
                        text_y = max(30, min(text_pos[1] + 30, panorama.shape[0] - 10))
                        cv2.putText(panorama, f"Bild {i+1}", 
                                   (text_x, text_y),
                                   cv2.FONT_HERSHEY_SIMPLEX, 2, color, 3)
                    
                    print(f"  ✓ Rahmen für {img_name} gezeichnet (Farbe: {color})")
                
                # Speichere Panorama mit Rahmen
                panorama_with_borders_path = output_dir / "panorama_hugin_with_borders.jpg"
                cv2.imwrite(str(panorama_with_borders_path), panorama, [cv2.IMWRITE_JPEG_QUALITY, 95])
                print(f"  ✓ Panorama mit Rahmen gespeichert: {panorama_with_borders_path}")
        except Exception as e:
            print(f"  ✗ Fehler beim Zeichnen der Rahmen: {e}")
            import traceback
            traceback.print_exc()

def create_pto_manually(image_files, pto_file):
    """Erstelle .pto Datei manuell"""
    with open(pto_file, 'w') as f:
        f.write("# hugin project file\n")
        f.write("#hugin_ptoversion 2\n")
        # Panorama-Definition: f0=rectilinear, w/h=Größe, v=HFOV
        f.write(f"p f0 w6000 h3000 v360  n\"JPEG q90\"\n")
        f.write(f"m g1 i0 f0 m2 p0.00784314\n")
        
        for i, img_path in enumerate(image_files):
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            
            h, w = img.shape[:2]
            fov = 66  # FOV in Grad
            
            # i-Zeile: Bild-Definition
            # Format: i w<width> h<height> f<fov> v<view> Ra0 Rb0 Rc0 Rd0 Re0 Eev0 Er1 Eb1 r<pitch> p<yaw> y<roll> ...
            # f<fov> ist wichtig - setze auf 66 Grad
            f.write(f"i w{w} h{h} f{fov} v{90} Ra0 Rb0 Rc0 Rd0 Re0 Eev0 Er1 Eb1 r0 p0 y0 TrX0 TrY0 TrZ0 Tpy0 Tpp0 j0 a0 b0 c0 d0 e0 g0 t0 Va1 Vb0 Vc0 Vd0 Vx0 Vy0  Vm5 n\"{img_path.name}\"\n")

def parse_pto_file(pto_file, image_files, panorama_size=None):
    """Parse .pto Datei und extrahiere Transformations-Matrizen"""
    matrices = []
    
    if not pto_file.exists():
        return matrices
    
    try:
        with open(pto_file, 'r') as f:
            content = f.read()
        
        # Finde Panorama-Parameter (p-Zeile)
        panorama_params = {}
        p_line_match = re.search(r'^p\s+([^\n]+)', content, re.MULTILINE)
        if p_line_match:
            p_parts = p_line_match.group(1).split()
            for part in p_parts:
                if part.startswith('f'):
                    panorama_params['projection'] = int(part[1:])
                elif part.startswith('w'):
                    panorama_params['width'] = int(part[1:])
                elif part.startswith('h'):
                    panorama_params['height'] = int(part[1:])
                elif part.startswith('v'):
                    panorama_params['hfov'] = float(part[1:])
        
        # Finde alle i-Zeilen (Bild-Definitionen)
        i_lines = re.findall(r'^i\s+([^\n]+)', content, re.MULTILINE)
        
        for i_line in i_lines:
            parts = i_line.split()
            
            # Extrahiere Parameter
            params = {}
            img_name = None
            
            for part in parts:
                # Bildname (n"filename")
                if part.startswith('n"'):
                    img_name = part[2:].rstrip('"')
                # Breite (w1234)
                elif part.startswith('w') and len(part) > 1:
                    try:
                        params['width'] = int(part[1:])
                    except:
                        pass
                # Höhe (h1234)
                elif part.startswith('h') and len(part) > 1:
                    try:
                        params['height'] = int(part[1:])
                    except:
                        pass
                # FOV (f66)
                elif part.startswith('f') and len(part) > 1:
                    try:
                        params['fov'] = float(part[1:])
                    except:
                        pass
                # View (v90)
                elif part.startswith('v') and len(part) > 1:
                    try:
                        params['view'] = float(part[1:])
                    except:
                        pass
                # Pitch (r-10.5)
                elif part.startswith('r') and len(part) > 1:
                    try:
                        params['pitch'] = float(part[1:])
                    except:
                        pass
                # Yaw (p45.2)
                elif part.startswith('p') and len(part) > 1 and not part.startswith('pano'):
                    try:
                        params['yaw'] = float(part[1:])
                    except:
                        pass
                # Roll (y5.3)
                elif part.startswith('y') and len(part) > 1:
                    try:
                        params['roll'] = float(part[1:])
                    except:
                        pass
                # Translation X (TrX123.4)
                elif part.startswith('TrX'):
                    try:
                        params['trans_x'] = float(part[3:])
                    except:
                        pass
                # Translation Y (TrY-45.6)
                elif part.startswith('TrY'):
                    try:
                        params['trans_y'] = float(part[3:])
                    except:
                        pass
                # Translation Z (TrZ0.1)
                elif part.startswith('TrZ'):
                    try:
                        params['trans_z'] = float(part[3:])
                    except:
                        pass
            
            if not img_name:
                continue
            
            # Standardwerte
            pitch = math.radians(params.get('pitch', 0.0))
            yaw = math.radians(params.get('yaw', 0.0))
            roll = math.radians(params.get('roll', 0.0))
            fov = params.get('fov', 66.0)
            if fov <= 0:
                fov = 66.0  # Fallback
            width = params.get('width', 3280)
            height = params.get('height', 2464)
            
            # Panorama-Parameter
            # Verwende tatsächliche Größe aus gerendertem Bild, falls verfügbar
            if panorama_size:
                pano_width = panorama_size['width']
                pano_height = panorama_size['height']
            else:
                pano_width = panorama_params.get('width', 5748)
                pano_height = panorama_params.get('height', 6283)
            pano_hfov = panorama_params.get('hfov', 140.0)  # Horizontales FOV des Panoramas
            
            # Berechne Transformations-Matrix für sphärische Projektion
            # Hugin verwendet equirectangular Projektion (f2)
            # Transformation: Bildpixel → lokale Winkel → globale sphärische Koordinaten → Panorama-Pixel
            
            # Erstelle viele Punkt-Paare für Homographie-Approximation
            # Verwende ein Grid von Punkten im Originalbild
            grid_size = 11  # 11x11 = 121 Punkte
            src_points = []
            dst_points = []
            
            fov_rad = math.radians(fov)
            pano_hfov_rad = math.radians(pano_hfov)
            
            # Rotations-Matrix aus Euler-Winkeln (Hugin: Roll um Z, Pitch um Y, Yaw um X)
            # Hugin verwendet die Reihenfolge: Roll (Z), Pitch (Y), Yaw (X)
            R_roll = np.array([
                [math.cos(roll), -math.sin(roll), 0],
                [math.sin(roll), math.cos(roll), 0],
                [0, 0, 1]
            ])
            R_pitch = np.array([
                [math.cos(pitch), 0, math.sin(pitch)],
                [0, 1, 0],
                [-math.sin(pitch), 0, math.cos(pitch)]
            ])
            R_yaw = np.array([
                [1, 0, 0],
                [0, math.cos(yaw), -math.sin(yaw)],
                [0, math.sin(yaw), math.cos(yaw)]
            ])
            
            # Kombinierte Rotation: R = R_roll * R_pitch * R_yaw
            R = R_roll @ R_pitch @ R_yaw
            
            # Generiere Punkt-Paare
            for i in range(grid_size):
                for j in range(grid_size):
                    # Bildpixel-Koordinaten (normalisiert auf [-1, 1])
                    x_norm = (i / (grid_size - 1)) * 2 - 1  # -1 bis 1
                    y_norm = (j / (grid_size - 1)) * 2 - 1  # -1 bis 1
                    
                    # Lokale Winkel (basierend auf FOV)
                    # Für rectilinear: tan(angle) = pixel / focal
                    # Vereinfacht: angle ≈ pixel * (fov/2)
                    local_theta = x_norm * (fov_rad / 2)  # Horizontaler Winkel
                    local_phi = y_norm * (fov_rad / 2) * (height / width)  # Vertikaler Winkel
                    
                    # Lokale Richtung (3D-Vektor)
                    # Z-Achse zeigt nach vorne, X nach rechts, Y nach oben
                    local_dir = np.array([
                        math.tan(local_theta),
                        math.tan(local_phi),
                        1.0
                    ])
                    local_dir = local_dir / np.linalg.norm(local_dir)
                    
                    # Transformiere in globale Richtung (mit Rotation)
                    global_dir = R @ local_dir
                    
                    # Konvertiere zu sphärischen Koordinaten (theta, phi)
                    # theta: Azimuth (0 = vorne, + = rechts)
                    # phi: Elevation (0 = horizontal, + = oben)
                    global_theta = math.atan2(global_dir[0], global_dir[2])  # Azimuth
                    global_phi = math.asin(global_dir[1])  # Elevation
                    
                    # Konvertiere zu Panorama-Pixel (equirectangular)
                    # Panorama: theta von -hfov/2 bis +hfov/2 → x von 0 bis width
                    # Panorama: phi von -90° bis +90° → y von 0 bis height
                    # WICHTIG: Verwende tatsächliche Panorama-Größe, nicht .pto-Größe
                    if panorama_size:
                        actual_pano_width = panorama_size['width']
                        actual_pano_height = panorama_size['height']
                    else:
                        actual_pano_width = pano_width
                        actual_pano_height = pano_height
                    
                    pano_x = (global_theta / pano_hfov_rad + 0.5) * actual_pano_width
                    pano_y = (-global_phi / math.pi + 0.5) * actual_pano_height
                    
                    # Originalbild-Pixel
                    img_x = (i / (grid_size - 1)) * width
                    img_y = (j / (grid_size - 1)) * height
                    
                    src_points.append([img_x, img_y])
                    dst_points.append([pano_x, pano_y])
            
            # Berechne Homographie aus Punkt-Paaren
            src_pts = np.float32(src_points)
            dst_pts = np.float32(dst_points)
            
            # Verwende RANSAC für robuste Schätzung
            H, mask = cv2.findHomography(src_pts, dst_pts, 
                                        cv2.RANSAC, 
                                        ransacReprojThreshold=50.0)
            
            if H is None:
                # Fallback: Identitäts-Matrix mit Translation
                H = np.eye(3, dtype=np.float32)
                # Versuche zumindest eine grobe Translation zu schätzen
                if len(dst_points) > 0 and len(src_points) > 0:
                    center_src = np.mean(src_pts, axis=0)
                    center_dst = np.mean(dst_pts, axis=0)
                    H[0, 2] = center_dst[0] - center_src[0]
                    H[1, 2] = center_dst[1] - center_src[1]
            
            # Finde Bild-Index
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
                    'pitch': math.degrees(pitch),
                    'yaw': math.degrees(yaw),
                    'roll': math.degrees(roll),
                    'trans_x': float(H[0, 2]),
                    'trans_y': float(H[1, 2]),
                    'trans_z': params.get('trans_z', 0.0),
                    'fov': fov,
                    'width': width,
                    'height': height,
                    'pano_hfov': pano_hfov  # Speichere Panorama HFOV für sphärische Projektion
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

