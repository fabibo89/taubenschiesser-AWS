#!/usr/bin/env python3
"""
OpenCV Stitcher Pipeline manuell aufbauen
Extrahiert Matrizen direkt aus CameraParams
"""

import cv2
import numpy as np
import json
from pathlib import Path

def stitch_with_manual_pipeline(images_dir, output_dir):
    """Stitch Bilder mit manueller Pipeline und extrahiere Matrizen aus CameraParams"""
    
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Lade alle Bilder
    image_files = sorted(images_dir.glob("image_*.jpg"))
    if not image_files:
        print(f"Keine Bilder gefunden in {images_dir}")
        return
    
    print(f"Lade {len(image_files)} Bilder...")
    images = []
    for img_path in image_files:
        img = cv2.imread(str(img_path))
        if img is not None:
            images.append(img)
            print(f"  ✓ {img_path.name}: {img.shape[1]}x{img.shape[0]}")
        else:
            print(f"  ✗ Konnte {img_path.name} nicht laden")
    
    if len(images) < 2:
        print("Mindestens 2 Bilder benötigt!")
        return
    
    print("\n" + "="*60)
    print("Baue Stitcher-Pipeline manuell auf...")
    print("="*60)
    
    # 1. Feature-Finder
    print("\n1. Feature-Finder...")
    try:
        finder = cv2.SIFT_create(nfeatures=5000)
        finder_name = "SIFT"
    except:
        try:
            finder = cv2.ORB_create(nfeatures=5000)
            finder_name = "ORB"
        except:
            print("  ✗ Kein Feature-Finder verfügbar")
            return
    
    print(f"  ✓ Verwende {finder_name}")
    
    # 2. Finde Features in allen Bildern
    print("\n2. Finde Features...")
    features = []
    for i, img in enumerate(images):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        kp, desc = finder.detectAndCompute(gray, None)
        
        if desc is None or len(kp) < 10:
            print(f"  ⚠️  Bild {i+1}: Zu wenige Features ({len(kp) if kp else 0})")
            continue
        
        # Verwende direkt Dictionary (ImageFeatures verursacht Segmentation Fault)
        features.append({
            'keypoints': kp,
            'descriptors': desc,
            'img_size': img.shape[:2][::-1]  # (width, height)
        })
        print(f"  ✓ Bild {i+1}: {len(kp)} Features")
    
    if len(features) < 2:
        print("  ✗ Zu wenige Bilder mit Features")
        return
    
    # 3. Matcher
    print("\n3. Matcher...")
    try:
        matcher = cv2.detail.BestOf2NearestMatcher_create()
        print("  ✓ BestOf2NearestMatcher erstellt")
    except Exception as e:
        print(f"  ✗ Fehler beim Erstellen des Matchers: {e}")
        return
    
    # 4. Finde Matches (direktes Feature-Matching, da Matcher ImageFeatures benötigt)
    print("\n4. Finde Matches...")
    pairwise_matches = []
    pairwise_matches_data = []  # Für Estimator
    
    for i in range(len(features)):
        for j in range(i+1, len(features)):
            # Direktes Matching zwischen zwei Bildern
            bf = cv2.BFMatcher()
            matches = bf.knnMatch(features[i]['descriptors'], features[j]['descriptors'], k=2)
            
            # Lowe's ratio test
            good_matches = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < 0.75 * n.distance:
                        good_matches.append(m)
            
            if len(good_matches) > 10:
                pairwise_matches.append((i, j, good_matches))
                pairwise_matches_data.append({
                    'src_idx': i,
                    'dst_idx': j,
                    'matches': good_matches
                })
                print(f"  ✓ Bild {i+1} <-> Bild {j+1}: {len(good_matches)} Matches")
    
    if len(pairwise_matches) == 0:
        print("  ✗ Keine Matches gefunden")
        return
    
    print(f"  ✓ {len(pairwise_matches)} Match-Paare gefunden")
    
    # 5. Estimator (gibt CameraParams zurück!)
    print("\n5. Estimator (schätzt Kamera-Parameter)...")
    try:
        estimator = cv2.detail.HomographyBasedEstimator()
        print("  ✓ HomographyBasedEstimator erstellt")
    except Exception as e:
        print(f"  ✗ Fehler beim Erstellen des Estimators: {e}")
        return
    
    # 6. Berechne Homographien direkt aus Matches
    print("\n6. Berechne Homographien aus Matches...")
    homographies = []
    
    # Erstelle eine Kette von Homographien
    # Starte mit Bild 0 als Referenz (Panorama-Basis)
    H_to_pano = [np.eye(3, dtype=np.float32)]  # Bild 0 ist Referenz = Identität
    
    for match_data in pairwise_matches_data:
        i = match_data['src_idx']
        j = match_data['dst_idx']
        matches = match_data['matches']
        
        if len(matches) < 10:
            continue
        
        # Extrahiere Punkte
        src_pts = np.float32([features[i]['keypoints'][m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([features[j]['keypoints'][m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        
        # Berechne Homographie: H transformiert von Bild i zu Bild j
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        
        if H is not None:
            # H transformiert von Bild i zu Bild j
            # Wenn wir H_to_pano[i] haben (von Bild i zu Panorama),
            # dann ist H_to_pano[j] = H_to_pano[i] @ H (von Bild j zu Panorama über Bild i)
            
            # Erweitere H_to_pano falls nötig
            while len(H_to_pano) <= max(i, j):
                H_to_pano.append(None)
            
            # Wenn H_to_pano[i] existiert, berechne H_to_pano[j]
            if H_to_pano[i] is not None:
                H_to_pano[j] = H_to_pano[i] @ H
            # Wenn H_to_pano[j] existiert, berechne H_to_pano[i] (inverse)
            elif H_to_pano[j] is not None:
                H_to_pano[i] = H_to_pano[j] @ np.linalg.inv(H)
            # Sonst: Setze beide basierend auf der Kette
            else:
                # Versuche über andere Bilder zu finden
                pass
            
            homographies.append((i, j, H))
            print(f"  ✓ Homographie Bild {i+1} -> Bild {j+1}: {np.sum(mask)} Inlier")
    
    if len(homographies) == 0:
        print("  ✗ Keine Homographien berechnet")
        return
    
    print(f"  ✓ {len(homographies)} Homographien berechnet")
    
    # Fülle fehlende Matrizen durch Propagation
    # Starte mit Bild 0 (Referenz)
    changed = True
    while changed:
        changed = False
        for i, j, H in homographies:
            if H_to_pano[i] is not None and H_to_pano[j] is None:
                H_to_pano[j] = H_to_pano[i] @ H
                changed = True
            elif H_to_pano[j] is not None and H_to_pano[i] is None:
                H_to_pano[i] = H_to_pano[j] @ np.linalg.inv(H)
                changed = True
    
    # Setze None-Matrizen auf Identität (Fallback)
    for i in range(len(H_to_pano)):
        if H_to_pano[i] is None:
            H_to_pano[i] = np.eye(3, dtype=np.float32)
    
    print(f"  ✓ Transformations-Matrizen zum Panorama berechnet: {len(H_to_pano)} Matrizen")
    
    # 7. Extrahiere Matrizen direkt aus Homographien
    print("\n7. Extrahiere Matrizen aus Homographien...")
    matrices = []
    
    for i in range(len(features)):
        try:
            # K-Matrix (intrinsische Parameter) - geschätzt
            K = np.eye(3, dtype=np.float64)
            focal = features[i]['img_size'][0] * 0.5  # Geschätzte Focal Length
            K[0, 0] = focal
            K[1, 1] = focal
            K[0, 2] = features[i]['img_size'][0] / 2.0  # Principal Point
            K[1, 2] = features[i]['img_size'][1] / 2.0
            
            # H-Matrix: Transformation von Bild i zum Panorama
            if i < len(H_to_pano):
                # H_to_pano[i] transformiert direkt von Bild i zum Panorama
                H_matrix = H_to_pano[i].astype(np.float64)
            else:
                # Fallback: Identitäts-Matrix
                H_matrix = np.eye(3, dtype=np.float64)
            
            # R-Matrix aus Homographie (vereinfacht)
            # Für planare Projektion: R ≈ H[:3, :3] (nur Rotationsteil)
            R = H_matrix[:3, :3].astype(np.float64)
            # Normalisiere R (sollte Rotations-Matrix sein)
            try:
                U, S, Vt = np.linalg.svd(R)
                R = U @ Vt
            except:
                R = np.eye(3, dtype=np.float64)
            
            matrices.append({
                'image_index': i,
                'image_name': image_files[i].name if i < len(image_files) else f"image_{i}.jpg",
                'K_matrix': K.tolist(),
                'R_matrix': R.tolist(),
                'H_matrix': H_matrix.tolist(),  # Direkte Homographie zum Panorama
                'focal_length': float(K[0, 0]),
                'aspect_ratio': float(K[1, 1] / K[0, 0]) if K[0, 0] != 0 else 1.0
            })
            
            print(f"  ✓ Bild {i+1} ({image_files[i].name if i < len(image_files) else 'unknown'}):")
            print(f"    Focal: {K[0,0]:.2f}")
            print(f"    H-Matrix (zum Panorama):")
            for row in H_matrix:
                print(f"      [{row[0]:.6f}, {row[1]:.6f}, {row[2]:.6f}]")
        except Exception as e:
            print(f"  ✗ Fehler bei Bild {i+1}: {e}")
            import traceback
            traceback.print_exc()
    
    # 8. Rendere Panorama und berechne korrekte Matrizen
    print("\n8. Rendere Panorama...")
    panorama = None
    try:
        stitcher = cv2.Stitcher.create()
        status, panorama = stitcher.stitch(images)
        
        if status == cv2.Stitcher_OK:
            print(f"  ✓ Panorama erstellt: {panorama.shape[1]}x{panorama.shape[0]}")
            panorama_path = output_dir / "panorama_opencv_manual.jpg"
            cv2.imwrite(str(panorama_path), panorama)
            print(f"  ✓ Panorama gespeichert: {panorama_path}")
            
            # WICHTIG: Die H_to_pano Matrizen transformieren von Bild i zu Bild 0 (Referenz)
            # Aber das Panorama ist nicht Bild 0 - der Stitcher verschiebt alles
            # Wir müssen die tatsächliche Translation finden, die der Stitcher verwendet
            
            print("\n  → Berechne Panorama-Offset...")
            h_pano, w_pano = panorama.shape[:2]
            
            # Transformiere alle Ecken aller Bilder ins Referenz-Koordinatensystem (Bild 0)
            all_corners_in_ref = []
            for i in range(len(images)):
                if i >= len(H_to_pano):
                    continue
                h_img, w_img = images[i].shape[:2]
                corners = np.float32([
                    [0, 0],
                    [w_img, 0],
                    [w_img, h_img],
                    [0, h_img]
                ]).reshape(-1, 1, 2)
                corners_in_ref = cv2.perspectiveTransform(corners, H_to_pano[i])
                all_corners_in_ref.append(corners_in_ref)
            
            if all_corners_in_ref:
                # Finde Bounding Box aller transformierten Ecken
                all_corners_flat = np.concatenate(all_corners_in_ref, axis=0)
                x_min_ref = float(np.min(all_corners_flat[:, 0, 0]))
                x_max_ref = float(np.max(all_corners_flat[:, 0, 0]))
                y_min_ref = float(np.min(all_corners_flat[:, 0, 1]))
                y_max_ref = float(np.max(all_corners_flat[:, 0, 1]))
                
                # Der Stitcher verschiebt das Panorama, sodass der linke obere Punkt bei (0,0) ist
                # Translation = -min(x), -min(y)
                tx = -x_min_ref
                ty = -y_min_ref
                
                print(f"    Referenz-Bounding Box: x=[{x_min_ref:.0f}, {x_max_ref:.0f}], y=[{y_min_ref:.0f}, {y_max_ref:.0f}]")
                print(f"    Panorama-Offset: tx={tx:.0f}, ty={ty:.0f}")
                
                # Erstelle Translations-Matrix
                T = np.array([
                    [1.0, 0.0, tx],
                    [0.0, 1.0, ty],
                    [0.0, 0.0, 1.0]
                ], dtype=np.float64)
                
                # Aktualisiere alle Matrizen: H_pano = T @ H_to_pano
                for i in range(len(images)):
                    if i < len(H_to_pano) and i < len(matrices):
                        H_corrected = T @ H_to_pano[i].astype(np.float64)
                        matrices[i]['H_matrix'] = H_corrected.tolist()
                        print(f"    ✓ Bild {i+1}: Matrix korrigiert mit Panorama-Offset")
        else:
            print(f"  ⚠️  Stitching fehlgeschlagen: Status {status}")
            panorama = None
    except Exception as e:
        print(f"  ⚠️  Panorama-Rendering fehlgeschlagen: {e}")
        import traceback
        traceback.print_exc()
        panorama = None
    
    # 9. Zeichne Matrizen ins Panorama (falls Panorama vorhanden)
    if panorama is not None and len(matrices) > 0:
        print("\n9. Zeichne Matrizen ins Panorama...")
        try:
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
                H = np.array(matrix_data['H_matrix'], dtype=np.float32)
                img_name = matrix_data['image_name']
                
                # Finde Originalbild, um Größe zu bekommen
                img_path = images_dir / img_name
                if img_path.exists():
                    img = cv2.imread(str(img_path))
                    if img is not None:
                        h_img, w_img = img.shape[:2]
                    else:
                        # Fallback: Verwende geschätzte Größe
                        w_img, h_img = 3280, 2464
                else:
                    # Fallback: Verwende geschätzte Größe
                    w_img, h_img = 3280, 2464
                
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
                
                # Transformiere alle Punkte ins Panorama-Koordinatensystem
                edge_points_np = np.float32(edge_points).reshape(-1, 1, 2)
                transformed_points = cv2.perspectiveTransform(edge_points_np, H)
                transformed_points_int = transformed_points.astype(np.int32).reshape(-1, 2)
                
                # Zeichne Linien zwischen den Punkten
                color = colors[i % len(colors)]
                for j in range(len(transformed_points_int) - 1):
                    pt1 = tuple(transformed_points_int[j])
                    pt2 = tuple(transformed_points_int[j + 1])
                    cv2.line(panorama, pt1, pt2, color, 3)
                
                # Schließe den Rahmen
                if len(transformed_points_int) > 0:
                    cv2.line(panorama, 
                            tuple(transformed_points_int[-1]), 
                            tuple(transformed_points_int[0]), 
                            color, 3)
                    
                    # Zeichne Bildnummer
                    text_pos = tuple(transformed_points_int[0])
                    cv2.putText(panorama, f"Bild {i+1}", 
                               (text_pos[0] + 10, text_pos[1] + 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 2, color, 3)
                
                print(f"  ✓ Rahmen für {img_name} gezeichnet (Farbe: {color})")
            
            # Speichere Panorama mit Rahmen
            panorama_with_borders_path = output_dir / "panorama_opencv_manual_with_borders.jpg"
            cv2.imwrite(str(panorama_with_borders_path), panorama)
            print(f"  ✓ Panorama mit Rahmen gespeichert: {panorama_with_borders_path}")
        except Exception as e:
            print(f"  ⚠️  Fehler beim Zeichnen der Rahmen: {e}")
            import traceback
            traceback.print_exc()
    
    # 10. Speichere Matrizen
    print("\n10. Speichere Matrizen...")
    if matrices:
        matrices_path = output_dir / "matrices_opencv_manual.json"
        with open(matrices_path, 'w') as f:
            json.dump({
                'panorama_size': {'width': panorama.shape[1], 'height': panorama.shape[0]} if panorama is not None else None,
                'num_images': len(images),
                'matrices': matrices
            }, f, indent=2)
        print(f"  ✓ Matrizen gespeichert: {matrices_path}")
        print(f"  ✓ {len(matrices)} Matrizen extrahiert")
    else:
        print("  ⚠️  Keine Matrizen extrahiert")
    
    print("\n" + "="*60)
    print("Fertig!")
    print("="*60)

if __name__ == "__main__":
    script_dir = Path(__file__).parent
    images_dir = script_dir / "images"
    output_dir = script_dir / "results_opencv_manual"
    
    stitch_with_manual_pipeline(images_dir, output_dir)

