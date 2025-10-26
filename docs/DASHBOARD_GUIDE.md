# 🎮 Taubenschiesser Dashboard Guide

## Übersicht

Das neue Dashboard bietet eine zentrale Steuerungs-Oberfläche für alle Taubenschiesser-Geräte mit Live-Streams und Echtzeit-Steuerung.

## 🚀 Features

### 📱 Geräte-Übersicht
- **Live-Status**: Echtzeit-Anzeige von Taubenschiesser- und Kamera-Status
- **Geräte-Karten**: Jedes Gerät in einer eigenen Karte mit allen Funktionen
- **Status-Indikatoren**: Farbkodierte Status-Anzeige (Online/Offline/Wartung/Fehler)

### 📹 Live-Streams
- **RTSP-Integration**: Direkte Einbindung von Tapo-Kameras und direkten RTSP-Streams
- **Stream-Steuerung**: Start/Stop-Funktionen für jeden Stream
- **Echtzeit-Anzeige**: Live-Video direkt im Dashboard

### 🎮 Geräte-Steuerung
- **Basis-Steuerung**: Start, Pause, Stop
- **Bewegungs-Steuerung**: 
  - Links/Rechts drehen
  - Hoch/Runter bewegen
  - Schieß-Funktion
  - Reset-Funktion
- **MQTT-Integration**: Befehle werden über MQTT an die Geräte gesendet

### 📊 Echtzeit-Monitoring
- **Ping-basierte Status-Erkennung**: Automatische Überwachung der Geräte-IPs
- **Socket.IO-Updates**: Echtzeit-Updates ohne Seiten-Reload
- **Status-Historie**: Letztes Signal und Verbindungsstatus

## 🛠️ Technische Details

### API-Endpunkte

#### Geräte-Steuerung
```bash
# Gerät steuern
POST /api/device-control/:id/control
{
  "action": "start|stop|pause|rotate_left|rotate_right|move_up|move_down|shoot|reset"
}

# Status aktualisieren
POST /api/device-control/:id/refresh

# Stream steuern
POST /api/device-control/:id/stream
{
  "action": "start|stop"
}

# Verfügbare Befehle abrufen
GET /api/device-control/commands
```

#### MQTT-Befehle
```json
{
  "start": {
    "topic": "taubenschiesser/control",
    "message": "{\"action\":\"start\",\"timestamp\":1234567890}"
  },
  "rotate_left": {
    "topic": "taubenschiesser/movement", 
    "message": "{\"action\":\"rotate\",\"direction\":\"left\",\"timestamp\":1234567890}"
  },
  "shoot": {
    "topic": "taubenschiesser/action",
    "message": "{\"action\":\"shoot\",\"timestamp\":1234567890}"
  }
}
```

### Frontend-Komponenten

#### DeviceCard
- **Live-Stream-Bereich**: 200px hoher Stream-Container
- **Steuerungs-Buttons**: Gruppierte Buttons für verschiedene Aktionen
- **Status-Anzeige**: Separate Chips für Taubenschiesser- und Kamera-Status
- **Geräte-Info**: IP-Adresse und letztes Signal

#### Dashboard-Layout
- **Responsive Grid**: 1-4 Spalten je nach Bildschirmgröße
- **Statistik-Karten**: Übersicht über alle Geräte
- **Echtzeit-Updates**: Socket.IO-Integration für Live-Updates

## 🎯 Verwendung

### 1. Dashboard öffnen
```
http://localhost:3000
```

### 2. Gerät auswählen
- Jedes Gerät wird als Karte angezeigt
- Status wird automatisch aktualisiert
- Bei Offline-Geräten werden Steuerungs-Buttons deaktiviert

### 3. Live-Stream starten
- Klick auf "Stream starten" Button
- RTSP-Stream wird automatisch konfiguriert
- Video wird im Stream-Bereich angezeigt

### 4. Gerät steuern
- **Start/Stop/Pause**: Basis-Steuerung
- **Bewegung**: Drehen und Bewegen
- **Schießen**: Schieß-Funktion aktivieren
- **Reset**: Gerät zurücksetzen

### 5. Status überwachen
- Echtzeit-Updates der Geräte-Status
- Ping-basierte Überwachung
- Automatische Status-Aktualisierung alle 30 Sekunden

## 🔧 Konfiguration

### Gerät einrichten
1. **Taubenschiesser-IP**: IP-Adresse des Geräts
2. **Kamera-Konfiguration**: 
   - Tapo-Kamera: IP, Benutzername, Passwort, Stream
   - Direkter RTSP: Vollständige RTSP-URL
3. **MQTT-Verbindung**: Automatische Konfiguration

### Stream-Konfiguration
```javascript
// Tapo-Kamera
{
  type: 'tapo',
  tapo: {
    ip: '192.168.1.100',
    username: 'admin',
    password: 'password',
    stream: 'stream1'
  }
}

// Direkter RTSP
{
  type: 'direct',
  directUrl: 'rtsp://user:pass@192.168.1.100:554/stream'
}
```

## 🧪 Testing

### Dashboard testen
```bash
# Test-Script ausführen
python test_dashboard.py

# Server starten
npm run dev

# Frontend starten
cd client && npm start
```

### Manuelle Tests
1. **Gerät erstellen**: Über Geräte-Verwaltung
2. **Status prüfen**: Ping-Funktionalität testen
3. **Steuerung testen**: MQTT-Befehle senden
4. **Stream testen**: RTSP-Verbindung prüfen

## 🚨 Troubleshooting

### Häufige Probleme

#### Gerät zeigt "Offline"
- **Ursache**: Ping schlägt fehl
- **Lösung**: IP-Adresse und Netzwerk-Verbindung prüfen

#### Stream startet nicht
- **Ursache**: RTSP-URL ungültig oder Kamera offline
- **Lösung**: Kamera-Konfiguration und Netzwerk prüfen

#### Steuerung funktioniert nicht
- **Ursache**: MQTT-Verbindung oder Gerät offline
- **Lösung**: MQTT-Broker und Gerät-Verbindung prüfen

#### Echtzeit-Updates fehlen
- **Ursache**: Socket.IO-Verbindung unterbrochen
- **Lösung**: Browser-Refresh oder Server-Neustart

### Debug-Informationen
```bash
# Server-Logs prüfen
tail -f server/logs/combined.log

# MQTT-Verbindung testen
mosquitto_pub -h localhost -t "taubenschiesser/control" -m '{"action":"test"}'

# Ping-Test
ping 192.168.1.100
```

## 📈 Performance

### Optimierungen
- **Lazy Loading**: Streams werden nur bei Bedarf geladen
- **Caching**: Geräte-Status wird gecacht
- **Debouncing**: Steuerungs-Befehle werden gedrosselt
- **WebSocket**: Effiziente Echtzeit-Updates

### Monitoring
- **Status-Checks**: Alle 30 Sekunden
- **Connection-Health**: Automatische Reconnection
- **Error-Handling**: Graceful Degradation bei Fehlern

## 🔮 Zukünftige Features

### Geplante Erweiterungen
- **Video-Recording**: Aufnahme von Streams
- **Screenshot-Funktion**: Bilder vom Stream speichern
- **Bewegungs-Erkennung**: Automatische Aktivierung
- **Zeitplanung**: Automatische Steuerung nach Zeitplan
- **Multi-User**: Mehrere Benutzer gleichzeitig
- **Mobile App**: Native App für Smartphones

### API-Erweiterungen
- **WebRTC**: Direkte Browser-Streams
- **HLS-Streaming**: Adaptive Bitrate-Streams
- **Recording-API**: Video-Aufnahme-Endpunkte
- **Analytics**: Detaillierte Nutzungsstatistiken

---

## 🎉 Fazit

Das neue Dashboard bietet eine vollständige Steuerungs-Oberfläche für Taubenschiesser-Geräte mit:

✅ **Live-Streams** für alle Geräte  
✅ **Echtzeit-Steuerung** über MQTT  
✅ **Automatische Status-Überwachung**  
✅ **Responsive Design** für alle Geräte  
✅ **Socket.IO-Integration** für Live-Updates  

**Das System ist jetzt bereit für den produktiven Einsatz! 🚀**
