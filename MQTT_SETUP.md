# MQTT-Setup für Taubenschiesser

## Übersicht
Für die Gerätesteuerung wird ein MQTT-Broker benötigt. Hier sind die Setup-Optionen:

## Option 1: Lokaler MQTT-Broker (Empfohlen für Entwicklung)

### Mosquitto installieren (macOS)
```bash
# Mit Homebrew
brew install mosquitto

# Mosquitto starten
brew services start mosquitto

# Oder manuell starten
mosquitto -c /usr/local/etc/mosquitto/mosquitto.conf
```

### Mosquitto installieren (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients

# Mosquitto starten
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

### Mosquitto installieren (Windows)
1. Download von: https://mosquitto.org/download/
2. Installieren und als Service starten

## Option 2: Docker MQTT-Broker

```bash
# Einfacher MQTT-Broker ohne Authentifizierung
docker run -it -p 1883:1883 eclipse-mosquitto

# Mit Authentifizierung
docker run -it -p 1883:1883 -p 9001:9001 \
  -v $(pwd)/mosquitto.conf:/mosquitto/config/mosquitto.conf \
  eclipse-mosquitto
```

## Option 3: Cloud MQTT-Services

### AWS IoT Core
- **Vorteile**: Skalierbar, sicher, integriert
- **Kosten**: Pay-per-use
- **Setup**: AWS Console → IoT Core → MQTT

### HiveMQ Cloud
- **Vorteile**: Einfach, kostenloser Plan
- **URL**: https://www.hivemq.com/cloud/
- **Setup**: Account erstellen → Broker-URL kopieren

### Azure IoT Hub
- **Vorteile**: Microsoft-Integration
- **Setup**: Azure Portal → IoT Hub

## MQTT-Konfiguration in Taubenschiesser

### 1. Settings öffnen
- Profil → Einstellungen Tab
- MQTT aktivieren

### 2. Broker-Daten eingeben
```
Broker: localhost (oder deine MQTT-Server-IP)
Port: 1883 (Standard) oder 8883 (SSL)
Username: (optional, je nach Broker-Konfiguration)
Password: (optional, je nach Broker-Konfiguration)
```

### 3. Verbindung testen
- "MQTT-Verbindung testen" klicken
- Bei Erfolg: "MQTT-Verbindung erfolgreich"
- Bei Fehler: Fehlermeldung prüfen

## MQTT-Topics (Automatisch)

Das System nutzt folgende Topics:
- **Commands**: `taubenschiesser/{device_ip}` (z.B. `taubenschiesser/192.168.1.100`)
- **Status**: `taubenschiesser/{device_ip}/status` (für Position-Updates)

## Sicherheit

### Lokaler Broker
```bash
# Passwort-Datei erstellen
mosquitto_passwd -c /etc/mosquitto/passwd username

# Konfiguration in /etc/mosquitto/mosquitto.conf:
allow_anonymous false
password_file /etc/mosquitto/passwd
```

### Cloud-Broker
- Verwende SSL/TLS (Port 8883)
- Starke Passwörter
- Regelmäßige Passwort-Updates

## Troubleshooting

### "Connection timeout"
- Broker läuft nicht
- Falsche IP/Port
- Firewall blockiert

### "Authentication failed"
- Falsche Username/Password
- Broker erfordert keine Auth (Username/Password leer lassen)

### "ENOTFOUND"
- DNS-Problem
- Falsche Broker-URL

## Test ohne Hardware

```bash
# MQTT-Nachricht senden (Terminal)
mosquitto_pub -h localhost -t "taubenschiesser/test" -m '{"type":"test"}'

# MQTT-Nachrichten empfangen
mosquitto_sub -h localhost -t "taubenschiesser/+/status"
```

## Empfohlene Konfiguration

### Für Entwicklung:
- **Broker**: localhost
- **Port**: 1883
- **Auth**: Keine (einfacher)

### Für Produktion:
- **Broker**: Cloud-Service (AWS IoT, HiveMQ)
- **Port**: 8883 (SSL)
- **Auth**: Username/Password
- **SSL**: Aktiviert
