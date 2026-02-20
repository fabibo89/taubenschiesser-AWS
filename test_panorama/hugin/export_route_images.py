#!/usr/bin/env python3
"""
Exportiert Routenbilder aus der MongoDB-Datenbank in den Input-Ordner
für Hugin-Panorama-Stitching.

Das Script:
1. Verbindet sich mit MongoDB
2. Findet alle Devices im Route-Modus
3. Extrahiert Routenbilder (Base64) und speichert sie als JPG
4. Speichert Kamerapositionen (rotation, tilt, zoom) in JSON
"""

import os
import sys
import json
import base64
import argparse
from pathlib import Path
from typing import List, Dict, Optional
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import re

# Standard MongoDB-Verbindung (kann über Umgebungsvariable überschrieben werden)
DEFAULT_MONGODB_URI = os.getenv(
    'MONGODB_URI',
    'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin'
)

# Script-Verzeichnis - finde hugin-Verzeichnis
# Funktioniert sowohl wenn Script direkt aufgerufen wird als auch aus test_panorama/
SCRIPT_DIR = Path(__file__).parent.absolute()
# Wenn wir im hugin-Verzeichnis sind, verwende es direkt
if SCRIPT_DIR.name == 'hugin':
    HUGIN_DIR = SCRIPT_DIR
else:
    # Versuche hugin-Verzeichnis relativ zum Script zu finden
    HUGIN_DIR = SCRIPT_DIR / 'hugin'
    if not HUGIN_DIR.exists():
        # Fallback: versuche vom aktuellen Arbeitsverzeichnis
        cwd = Path.cwd()
        if (cwd / 'hugin').exists():
            HUGIN_DIR = cwd / 'hugin'
        elif cwd.name == 'hugin':
            HUGIN_DIR = cwd
        else:
            # Letzter Fallback: verwende Script-Verzeichnis
            HUGIN_DIR = SCRIPT_DIR

INPUT_DIR = HUGIN_DIR / "input"
PARAMS_FILE = HUGIN_DIR / "camera_params.json"


def decode_base64_image(base64_string: str) -> Optional[bytes]:
    """
    Dekodiert einen Base64-String zu Bilddaten.
    Unterstützt sowohl reine Base64-Strings als auch data URLs.
    """
    if not base64_string:
        return None
    
    try:
        # Entferne data URL Präfix falls vorhanden
        if base64_string.startswith('data:image'):
            # Extrahiere Base64-Teil nach dem Komma
            base64_string = base64_string.split(',', 1)[1]
        
        # Dekodiere Base64
        image_data = base64.b64decode(base64_string)
        return image_data
    except Exception as e:
        print(f"  ⚠️  Fehler beim Dekodieren des Bildes: {e}")
        return None


def sanitize_filename(name: str) -> str:
    """Erstellt einen sicheren Dateinamen aus einem Device-Namen."""
    # Entferne ungültige Zeichen
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    # Entferne führende/abschließende Punkte und Leerzeichen
    name = name.strip('. ')
    # Begrenze Länge
    if len(name) > 50:
        name = name[:50]
    return name or "device"


def export_device_route_images(client: MongoClient, device_id: Optional[str] = None, device_name: Optional[str] = None):
    """
    Exportiert Routenbilder für ein oder alle Devices.
    
    Args:
        client: MongoDB Client
        device_id: Optional - spezifische Device-ID
        device_name: Optional - spezifischer Device-Name
    """
    db = client.taubenschiesser
    devices_collection = db.devices
    
    # Erstelle Input-Ordner
    INPUT_DIR.mkdir(exist_ok=True)
    
    # Query für Devices
    query = {
        'actions.mode': 'route',
        'actions.route.coordinates': {'$exists': True, '$ne': []}
    }
    
    if device_id:
        query['_id'] = device_id
    elif device_name:
        query['name'] = device_name
    
    devices = list(devices_collection.find(query))
    
    if not devices:
        print(f"❌ Keine Devices im Route-Modus gefunden")
        if device_id or device_name:
            print(f"   (Filter: device_id={device_id}, device_name={device_name})")
        return
    
    print(f"✅ {len(devices)} Device(s) im Route-Modus gefunden")
    print(f"📁 Ausgabe-Verzeichnis: {INPUT_DIR}\n")
    
    for device in devices:
        device_id_str = str(device['_id'])
        device_name_safe = sanitize_filename(device.get('name', 'unknown'))
        
        print(f"📷 Device: {device.get('name', 'Unbekannt')} (ID: {device_id_str})")
        
        coordinates = device.get('actions', {}).get('route', {}).get('coordinates', [])
        
        if not coordinates:
            print(f"  ⚠️  Keine Koordinaten gefunden")
            continue
        
        # Sortiere nach order
        coordinates_sorted = sorted(
            [c for c in coordinates if c.get('image')],
            key=lambda x: x.get('order', 999)
        )
        
        if not coordinates_sorted:
            print(f"  ⚠️  Keine Koordinaten mit Bildern gefunden")
            continue
        
        print(f"  📸 {len(coordinates_sorted)} Bilder gefunden")
        
        # Erstelle Device-spezifischen Unterordner (optional)
        # Oder speichere direkt im Input-Ordner mit Präfix
        device_prefix = f"{device_name_safe}_{device_id_str[:8]}"
        
        # Speichere Bilder und sammle Parameter
        camera_params = {}
        saved_count = 0
        
        for idx, coord in enumerate(coordinates_sorted, start=1):
            image_base64 = coord.get('image')
            if not image_base64:
                continue
            
            # Dekodiere Bild
            image_data = decode_base64_image(image_base64)
            if not image_data:
                continue
            
            # Dateiname: image_1.jpg, image_2.jpg, etc.
            filename = f"image_{idx}.jpg"
            filepath = INPUT_DIR / filename
            
            # Speichere Bild
            try:
                with open(filepath, 'wb') as f:
                    f.write(image_data)
                
                # Speichere Parameter
                rotation = coord.get('rotation')
                tilt = coord.get('tilt')
                zoom = coord.get('zoom', 1.0)
                
                camera_params[filename] = {
                    'rotation': rotation,
                    'tilt': tilt,
                    'zoom': zoom,
                    'order': coord.get('order', idx - 1)
                }
                
                # Optional: FOV aus Device-Konfiguration
                camera_config = device.get('camera', {})
                if camera_config.get('type') == 'tapo':
                    fov = camera_config.get('tapo', {}).get('fov', 110)
                elif camera_config.get('type') == 'raspberry-pi':
                    fov = camera_config.get('raspberryPi', {}).get('fov', 75)
                else:
                    fov = 66  # Default
                
                camera_params[filename]['fov'] = fov
                
                saved_count += 1
                print(f"    ✓ {filename} gespeichert (rotation={rotation}°, tilt={tilt}°, zoom={zoom}x)")
                
            except Exception as e:
                print(f"    ✗ Fehler beim Speichern von {filename}: {e}")
        
        # Speichere Parameter-JSON
        if camera_params:
            params_filepath = INPUT_DIR / "camera_params.json"
            try:
                with open(params_filepath, 'w', encoding='utf-8') as f:
                    json.dump(camera_params, f, indent=2, ensure_ascii=False)
                print(f"\n  ✅ {saved_count} Bilder gespeichert")
                print(f"  ✅ Parameter gespeichert: {params_filepath}")
            except Exception as e:
                print(f"  ✗ Fehler beim Speichern der Parameter: {e}")
        
        print()


def main():
    parser = argparse.ArgumentParser(
        description='Exportiert Routenbilder aus MongoDB für Hugin-Panorama-Stitching'
    )
    parser.add_argument(
        '--device-id',
        type=str,
        help='Spezifische Device-ID zum Exportieren'
    )
    parser.add_argument(
        '--device-name',
        type=str,
        help='Spezifischer Device-Name zum Exportieren'
    )
    parser.add_argument(
        '--mongodb-uri',
        type=str,
        default=DEFAULT_MONGODB_URI,
        help=f'MongoDB Verbindungs-URI (Standard: {DEFAULT_MONGODB_URI[:50]}...)'
    )
    
    args = parser.parse_args()
    
    print("🔌 Verbinde mit MongoDB...")
    # Maskiere Credentials in der Ausgabe
    import re
    masked_uri = re.sub(r'://[^@]+@', '://<credentials>@', args.mongodb_uri)
    print(f"   URI: {masked_uri}")
    
    try:
        client = MongoClient(
            args.mongodb_uri,
            serverSelectionTimeoutMS=5000
        )
        # Teste Verbindung
        client.admin.command('ping')
        print("✅ MongoDB-Verbindung erfolgreich\n")
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        print(f"❌ MongoDB-Verbindung fehlgeschlagen: {e}")
        print("\n💡 Tipp: Stelle sicher, dass MongoDB läuft und die URI korrekt ist.")
        print("   Standard: mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unerwarteter Fehler: {e}")
        sys.exit(1)
    
    try:
        export_device_route_images(
            client,
            device_id=args.device_id,
            device_name=args.device_name
        )
    finally:
        client.close()
        print("🔌 MongoDB-Verbindung geschlossen")


if __name__ == "__main__":
    main()

