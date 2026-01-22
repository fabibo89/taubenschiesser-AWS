#!/usr/bin/env python3
"""
OpenCV detail.Stitcher mit Matrix-Ausgabe
Erstellt ein Panorama und gibt die Transformations-Matrizen aus
"""

import cv2
import numpy as np
import json
from pathlib import Path

def stitch_with_matrices(images_dir, output_dir):
    """Stitch Bilder und gebe Matrizen aus"""
    
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
    
    # Erstelle Stitcher
    print("\nErstelle Stitcher...")
    stitcher = None
    use_detail = False
    
    # Versuche zuerst cv2.detail.Stitcher
    try:
        if hasattr(cv2, 'detail') and hasattr(cv2.detail, 'Stitcher'):
            stitcher = cv2.detail.Stitcher.create()
            stitcher.setPanoConfidenceThresh(0.5)
            use_detail = True
            
            # Optional: Plane Warper für weniger Verzerrung
            try:
                warper = cv2.detail.PlaneWarper()
                stitcher.setWarper(warper)
                print("  ✓ Verwende cv2.detail.Stitcher mit Plane Warper")
            except:
                print("  ✓ Verwende cv2.detail.Stitcher (Standard Warper)")
        else:
            raise AttributeError("cv2.detail.Stitcher nicht verfügbar")
    except (AttributeError, Exception) as e:
        print(f"  ⚠️  cv2.detail.Stitcher nicht verfügbar: {e}")
        print("  → Verwende cv2.Stitcher (Matrizen müssen nachträglich berechnet werden)")
        stitcher = cv2.Stitcher.create()
        use_detail = False
    
    # Führe Stitching durch
    print("\nStarte Stitching...")
    status, panorama = stitcher.stitch(images)
        
        if status != cv2.Stitcher_OK:
            print(f"✗ Stitching fehlgeschlagen: Status {status}")
            status_messages = {
                1: "Nicht genug Bilder",
                2: "Homographie-Schätzung fehlgeschlagen",
                3: "Kamera-Parameter-Anpassung fehlgeschlagen",
                4: "Feature-Matching-Konfidenz zu niedrig",
                5: "Eingabebilder zu groß oder zu klein"
            }
            print(f"  Fehler: {status_messages.get(status, 'Unbekannter Fehler')}")
            return
        
        print(f"✓ Panorama erstellt: {panorama.shape[1]}x{panorama.shape[0]}")
        
        # Speichere Panorama
        panorama_path = output_dir / "panorama_opencv.jpg"
        cv2.imwrite(str(panorama_path), panorama)
        print(f"✓ Panorama gespeichert: {panorama_path}")
        
        # Extrahiere Matrizen
        print("\nExtrahiere Transformations-Matrizen...")
        matrices = []
        
        try:
            # Versuche Kamera-Parameter zu bekommen (nur bei detail.Stitcher)
            if use_detail:
                cameras = stitcher.cameras()
                if cameras and len(cameras) > 0:
                    print(f"  ✓ Gefunden: {len(cameras)} Kamera-Parameter")
                    
                    for i, camera in enumerate(cameras):
                        # K-Matrix (intrinsische Parameter)
                        K = camera.K()
                        
                        # R-Matrix (Rotation)
                        R = camera.R()
                        
                        # Berechne Homographie-Matrix für Bild zu Panorama
                        # Für planare Projektion: H = K * R * K^-1
                        K_inv = np.linalg.inv(K)
                        H = K @ R @ K_inv
                        
                        matrices.append({
                            'image_index': i,
                            'image_name': image_files[i].name if i < len(image_files) else f"image_{i}.jpg",
                            'K_matrix': K.tolist(),
                            'R_matrix': R.tolist(),
                            'H_matrix': H.tolist(),
                            'focal_length': float(K[0, 0]),
                            'aspect_ratio': float(K[1, 1] / K[0, 0]) if K[0, 0] != 0 else 1.0
                        })
                        
                        print(f"  Bild {i+1} ({image_files[i].name if i < len(image_files) else 'unknown'}):")
                        print(f"    Focal: {K[0,0]:.2f}")
                        print(f"    H-Matrix:")
                        for row in H:
                            print(f"      [{row[0]:.6f}, {row[1]:.6f}, {row[2]:.6f}]")
                else:
                    print("  ⚠️  Keine Kamera-Parameter verfügbar")
            else:
                # cv2.detail.Stitcher nicht verfügbar - FEHLER!
                print("  ✗ FEHLER: cv2.detail.Stitcher ist nicht verfügbar!")
                print("  → Installiere opencv-contrib-python:")
                print("     pip3 uninstall opencv-python")
                print("     pip3 install opencv-contrib-python")
                print("  → Ohne cv2.detail.Stitcher können die Matrizen NICHT direkt extrahiert werden!")
                return
        
        except Exception as e:
            print(f"  ✗ Fehler beim Extrahieren der Matrizen: {e}")
            import traceback
            traceback.print_exc()
        
        # Speichere Matrizen als JSON
        if matrices:
            matrices_path = output_dir / "matrices_opencv.json"
            with open(matrices_path, 'w') as f:
                json.dump({
                    'panorama_size': {'width': panorama.shape[1], 'height': panorama.shape[0]},
                    'num_images': len(images),
                    'matrices': matrices
                }, f, indent=2)
            print(f"\n✓ Matrizen gespeichert: {matrices_path}")
        else:
            print("\n⚠️  Keine Matrizen extrahiert")
        
    except Exception as e:
        print(f"✗ Fehler: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    script_dir = Path(__file__).parent
    images_dir = script_dir / "images"
    output_dir = script_dir / "results_opencv"
    
    stitch_with_matrices(images_dir, output_dir)

