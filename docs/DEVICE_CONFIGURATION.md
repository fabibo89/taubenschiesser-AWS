# Geräte-Konfiguration - Neue Struktur

## Übersicht

Die Geräte-Struktur wurde überarbeitet, um eine bessere Trennung zwischen Taubenschiesser-Hardware (Motoren) und Kamera-Konfiguration zu ermöglichen. Dies ermöglicht flexiblere Kamera-Setups und bessere Verwaltung.

## Neue Geräte-Struktur

### Taubenschiesser-Konfiguration
```javascript
{
  taubenschiesser: {
    ip: "192.168.1.100",        // IP des Taubenschiesser-Geräts (für Motoren)
    mqttPort: 1883              // MQTT-Port (Standard: 1883)
  }
}
```

### Kamera-Konfiguration
```javascript
{
  camera: {
    type: "tp-link",           // "tp-link", "direct-rtsp", "other"
    
    // Für TP-Link Kameras
    tpLink: {
      ip: "192.168.1.101",
      username: "admin",
      password: "password123",
      stream: "stream1"        // "stream1" oder "stream2"
    },
    
    // Für direkte RTSP-Links
    directUrl: "rtsp://user:pass@ip:port/stream",
    
    // Legacy-Feld für Rückwärtskompatibilität
    rtspUrl: "rtsp://user:pass@ip:port/stream"
  }
}
```

## Kamera-Typen

### 1. TP-Link Kamera
- **Typ**: `tp-link`
- **Konfiguration**: IP, Benutzername, Passwort, Stream (stream1/stream2)
- **Generierte RTSP-URL**: `rtsp://username:password@ip:554/stream`

### 2. Direkter RTSP-Link
- **Typ**: `direct-rtsp`
- **Konfiguration**: Vollständige RTSP-URL
- **Verwendung**: Für Kameras mit vorgefertigten RTSP-Links

### 3. Andere Kameras
- **Typ**: `other`
- **Konfiguration**: Beliebige URL (RTSP, HTTP, etc.)
- **Verwendung**: Für spezielle Kamera-Setups

## API-Endpunkte

### Geräte-Konfiguration abrufen
```http
GET /api/devices/:id/config
```
**Antwort:**
```json
{
  "id": "device_id",
  "ip": "192.168.1.100",
  "stream": "stream1",
  "ipCam": "192.168.1.101",
  "rtspUrl": "rtsp://admin:password@192.168.1.101:554/stream1"
}
```

### Alle Geräte-Konfigurationen
```http
GET /api/devices/config/all
```
**Antwort:** Array von Geräte-Konfigurationen

### RTSP-URL für ein Gerät
```http
GET /api/devices/:id/rtsp-url
```
**Antwort:**
```json
{
  "rtspUrl": "rtsp://admin:password@192.168.1.101:554/stream1"
}
```

## Verwendung in stream.py

### Alte Methode (hardcoded)
```python
RTSP_URL = 'rtsp://fabian.bosch@gmx.de:kUgdak-fyvpuh-5wipcy@' + station['ipCam'] + ':554/' + self.stream
```

### Neue Methode (API-basiert)
```python
import requests

def get_device_config(device_id):
    response = requests.get(f'http://localhost:3001/api/devices/{device_id}/config')
    if response.status_code == 200:
        config = response.json()
        return config['rtspUrl']
    return None

# Verwendung
rtsp_url = get_device_config('device_id')
```

## Migration bestehender Geräte

### Automatische Migration
```bash
node migrate_devices.js
```

### Manuelle Migration
1. **Taubenschiesser-IP hinzufügen**:
   ```javascript
   device.taubenschiesser = {
     ip: "192.168.1.100",
     mqttPort: 1883
   };
   ```

2. **Kamera-Typ setzen**:
   ```javascript
   device.camera.type = "tp-link"; // oder "direct-rtsp"
   ```

3. **TP-Link Konfiguration** (falls TP-Link):
   ```javascript
   device.camera.tpLink = {
     ip: "192.168.1.101",
     username: "admin",
     password: "password",
     stream: "stream1"
   };
   ```

## Frontend-Integration

### Gerät erstellen/bearbeiten
Das Frontend unterstützt jetzt:
- **Taubenschiesser-IP**: Eingabefeld für die Hardware-IP
- **Kamera-Typ-Auswahl**: Dropdown für verschiedene Kamera-Typen
- **TP-Link-Konfiguration**: Separate Felder für IP, Benutzername, Passwort, Stream
- **Direkter RTSP-Link**: Eingabefeld für vollständige URL
- **Legacy-Unterstützung**: Rückwärtskompatibilität für alte RTSP-URLs

### Beispiel-Gerät erstellen
```javascript
const deviceData = {
  name: "Taubenschiesser Garten",
  deviceId: "taubenschiesser_001",
  type: "taubenschiesser",
  taubenschiesser: {
    ip: "192.168.1.100",
    mqttPort: 1883
  },
  camera: {
    type: "tp-link",
    tpLink: {
      ip: "192.168.1.101",
      username: "admin",
      password: "password123",
      stream: "stream1"
    }
  }
};
```

## Vorteile der neuen Struktur

1. **Flexibilität**: Unterstützung verschiedener Kamera-Typen
2. **Sicherheit**: Getrennte Verwaltung von Hardware- und Kamera-IPs
3. **Skalierbarkeit**: Einfache Erweiterung für neue Kamera-Typen
4. **Rückwärtskompatibilität**: Bestehende Geräte funktionieren weiter
5. **API-basiert**: Zentrale Konfiguration über REST-API
6. **Typsicherheit**: Validierung der Konfiguration

## Beispiel-Scripts

### Python-Beispiel
```python
# example_device_usage.py
import requests

# Gerät-Konfiguration abrufen
config = requests.get('http://localhost:3001/api/devices/device_id/config').json()
rtsp_url = config['rtspUrl']
taubenschiesser_ip = config['ip']
```

### Node.js-Beispiel
```javascript
// Migration ausführen
const { migrateDevices } = require('./migrate_devices.js');
await migrateDevices();
```

## Troubleshooting

### Häufige Probleme

1. **RTSP-URL wird nicht generiert**:
   - Prüfe, ob alle TP-Link-Felder ausgefüllt sind
   - Prüfe, ob direkter RTSP-Link korrekt ist

2. **Migration schlägt fehl**:
   - Prüfe Datenbankverbindung
   - Prüfe Berechtigungen

3. **Frontend zeigt keine Felder**:
   - Prüfe, ob Kamera-Typ korrekt ausgewählt ist
   - Prüfe Browser-Konsole auf JavaScript-Fehler

### Debug-Tipps

1. **API testen**:
   ```bash
   curl http://localhost:3001/api/devices/config/all
   ```

2. **Geräte-Methoden testen**:
   ```javascript
   const device = await Device.findById('device_id');
   console.log(device.getRtspUrl());
   console.log(device.getTaubenschiesserIp());
   ```

3. **Migration testen**:
   ```bash
   node migrate_devices.js
   ```
