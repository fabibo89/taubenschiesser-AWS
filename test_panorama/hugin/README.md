# Hugin Panorama Export

Dieses Verzeichnis enthält Tools zum Exportieren von Routenbildern aus der Datenbank für Hugin-Panorama-Stitching.

## Voraussetzungen

### Python-Abhängigkeiten

Installiere die benötigten Python-Pakete:

```bash
pip install pymongo
```

### MongoDB-Verbindung

Das Script verbindet sich standardmäßig mit:
```
mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin
```

Du kannst die Verbindung über eine Umgebungsvariable überschreiben:
```bash
export MONGODB_URI="mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin"
```

## Verwendung

### Alle Devices exportieren

Exportiert Routenbilder von allen Devices im Route-Modus:

```bash
python export_route_images.py
```

### Spezifisches Device exportieren

Nach Device-ID:
```bash
python export_route_images.py --device-id "507f1f77bcf86cd799439011"
```

Nach Device-Name:
```bash
python export_route_images.py --device-name "Mein Taubenschiesser"
```

### Custom MongoDB-URI

```bash
python export_route_images.py --mongodb-uri "mongodb://user:pass@host:27017/dbname"
```

## Ausgabe

Das Script erstellt:

1. **input/** - Ordner mit den exportierten Bildern
   - `image_1.jpg`, `image_2.jpg`, etc. (sortiert nach `order`)

2. **camera_params.json** - Datei mit Kameraparametern
   ```json
   {
     "image_1.jpg": {
       "rotation": 65,
       "tilt": 52,
       "zoom": 1.0,
       "order": 0,
       "fov": 110
     },
     ...
   }
   ```

## Panorama-Erstellung

Nach dem Export kannst du ein Panorama mit Hugin erstellen. Es gibt zwei Varianten:

### Variante 1: Mit Kameraparametern (empfohlen)

Verwendet die Kameraparameter aus `camera_params.json` als Startwerte für bessere Ergebnisse:

```bash
# Im hugin-Verzeichnis
python create_panorama.py
```

**Vorteile:**
- Bessere Startwerte → schnelleres Stitching
- Zuverlässigere Ergebnisse
- Besonders bei großen Winkeldifferenzen

### Variante 2: Ohne Kameraparameter (automatisch)

Hugin findet automatisch alle Parameter:

```bash
# Im hugin-Verzeichnis
python create_panorama_simple.py
```

**Vorteile:**
- Einfacher - keine Parameter nötig
- Funktioniert auch ohne `camera_params.json`
- Hugin macht alles automatisch

**Beide Scripts:**
1. Laden Bilder aus `input/`
2. Erstellen eine `.pto` Datei mit Hugin
3. Führen Hugin-Tools aus (cpfind, autooptimiser, nona, enblend)
4. Speichern das Panorama in `panorama/`

### Voraussetzungen für Panorama-Erstellung

- **Hugin** muss installiert sein: https://hugin.sourceforge.io/
- **OpenCV** für Python: `pip install opencv-python`

### Ausgabe

Das Script erstellt im `panorama/` Ordner:
- `panorama.pto` - Hugin-Projektdatei
- `panorama.jpg` - Finales Panorama
- `panorama.tif` - Panorama in TIF-Format (falls enblend verwendet wurde)
- `panorama*.tif` - Einzelne gerenderte TIF-Dateien (vor dem Zusammenfügen)

## Struktur

```
hugin/
├── input/                    # Exportierte Routenbilder (wird erstellt)
│   ├── image_1.jpg
│   ├── image_2.jpg
│   └── camera_params.json    # Kamerapositionen und Zoom
├── panorama/                 # Panorama-Ausgabe (wird erstellt)
│   ├── panorama.pto         # Hugin-Projektdatei
│   ├── panorama.jpg         # Finales Panorama
│   └── panorama.tif         # Panorama in TIF-Format
├── export_route_images.py        # Export-Script (Datenbank → input/)
├── create_panorama.py            # Panorama mit Kameraparametern
├── create_panorama_simple.py     # Panorama ohne Parameter (automatisch)
└── README.md                     # Diese Datei
```

## Workflow

1. **Exportiere Routenbilder aus der Datenbank:**
   ```bash
   python export_route_images.py --device-name "Mein Device"
   ```

2. **Erstelle Panorama mit Hugin:**
   
   **Mit Kameraparametern (empfohlen):**
   ```bash
   python create_panorama.py
   ```
   
   **Oder ohne Parameter (automatisch):**
   ```bash
   python create_panorama_simple.py
   ```

3. **Ergebnis:** Panorama in `panorama/panorama.jpg`

