# 📋 Docker Logs - Überwachung und Fehlersuche

Anleitung zum Anzeigen und Überwachen der Docker-Container-Logs für das Taubenschiesser-System.

---

## 📋 Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Container-Namen](#container-namen)
- [Basis-Befehle](#basis-befehle)
- [Live-Überwachung](#live-überwachung)
- [Filtern und Suchen](#filtern-und-suchen)
- [Log-Rotation](#log-rotation)
- [Troubleshooting](#troubleshooting)

---

## Übersicht

Das Taubenschiesser-System besteht aus mehreren Docker-Containern. Diese Anleitung zeigt, wie du die Logs überwachen kannst.

### Container-Übersicht

| Container | Service | Port | Beschreibung |
|-----------|---------|------|--------------|
| `taubenschiesser-api-prod` | API | 5001 | Node.js Backend |
| `taubenschiesser-cv-prod` | CV Service | 8000 | Computer Vision (YOLOv8) |
| `taubenschiesser-frontend-prod` | Frontend | 3000 | React Web-Interface |
| `taubenschiesser-hardware-monitor-prod` | Hardware Monitor | - | Device-Überwachung |

---

## Container-Namen

Die Container-Namen sind in `docker-compose.prod.yml` definiert:

```yaml
# Service-Namen (für docker-compose)
- api
- cv-service
- frontend
- hardware-monitor

# Container-Namen (für docker)
- taubenschiesser-api-prod
- taubenschiesser-cv-prod
- taubenschiesser-frontend-prod
- taubenschiesser-hardware-monitor-prod
```

---

## Basis-Befehle

### Alle Logs anzeigen

```bash
# Alle Services
docker-compose -f docker-compose.prod.yml logs

# Nur die letzten 100 Zeilen
docker-compose -f docker-compose.prod.yml logs --tail=100
```

### Logs eines einzelnen Service

```bash
# API Server
docker-compose -f docker-compose.prod.yml logs api

# Computer Vision Service
docker-compose -f docker-compose.prod.yml logs cv-service

# Frontend
docker-compose -f docker-compose.prod.yml logs frontend

# Hardware Monitor
docker-compose -f docker-compose.prod.yml logs hardware-monitor
```

### Logs mehrerer Services gleichzeitig

```bash
# API und CV Service
docker-compose -f docker-compose.prod.yml logs api cv-service

# Backend-Services
docker-compose -f docker-compose.prod.yml logs api cv-service hardware-monitor
```

---

## Live-Überwachung

### Alle Container live überwachen

```bash
# Alle Services im Follow-Modus (empfohlen)
docker-compose -f docker-compose.prod.yml logs -f api cv-service frontend hardware-monitor

# Oder kürzer: alle Services
docker-compose -f docker-compose.prod.yml logs -f
```

### Einzelnen Service live überwachen

```bash
# API Server
docker-compose -f docker-compose.prod.yml logs -f api

# Computer Vision Service
docker-compose -f docker-compose.prod.yml logs -f cv-service

# Frontend
docker-compose -f docker-compose.prod.yml logs -f frontend

# Hardware Monitor
docker-compose -f docker-compose.prod.yml logs -f hardware-monitor
```

### Mit Zeitstempel

```bash
# Logs mit Timestamps
docker-compose -f docker-compose.prod.yml logs -f -t api

# Alle Services mit Timestamps
docker-compose -f docker-compose.prod.yml logs -f -t
```

### Kombinierte Optionen

```bash
# Letzte 50 Zeilen + Live-Überwachung
docker-compose -f docker-compose.prod.yml logs -f --tail=50 api

# Mehrere Services mit Timestamps
docker-compose -f docker-compose.prod.yml logs -f -t api cv-service

# Alle Services, letzte 100 Zeilen, mit Timestamps
docker-compose -f docker-compose.prod.yml logs -f -t --tail=100
```

---

## Filtern und Suchen

### Mit grep filtern

```bash
# Nach ERROR suchen
docker-compose -f docker-compose.prod.yml logs api | grep ERROR

# Nach WARNING suchen (case-insensitive)
docker-compose -f docker-compose.prod.yml logs api | grep -i warning

# Mehrere Filter
docker-compose -f docker-compose.prod.yml logs api | grep -E "ERROR|WARNING"
```

### Live mit grep

```bash
# Live-Logs nach ERROR filtern
docker-compose -f docker-compose.prod.yml logs -f api | grep ERROR

# Alle Services nach ERROR durchsuchen
docker-compose -f docker-compose.prod.yml logs -f | grep ERROR
```

### Nach Zeitraum filtern

```bash
# Logs seit bestimmter Zeit (erfordert timestamps)
docker-compose -f docker-compose.prod.yml logs -t api | grep "2025-10-26"

# Logs der letzten Stunde (mit since)
docker logs --since 1h taubenschiesser-api-prod
```

---

## Alternativ: Direkt mit Docker

Falls du die Container-Namen bevorzugst:

```bash
# Logs anzeigen
docker logs taubenschiesser-api-prod
docker logs taubenschiesser-cv-prod
docker logs taubenschiesser-frontend-prod
docker logs taubenschiesser-hardware-monitor-prod

# Live-Überwachung
docker logs -f taubenschiesser-api-prod

# Letzte N Zeilen
docker logs --tail=100 taubenschiesser-api-prod

# Seit bestimmter Zeit
docker logs --since 30m taubenschiesser-api-prod
docker logs --since "2025-10-26T10:00:00" taubenschiesser-api-prod

# Kombiniert
docker logs -f --tail=50 --since 10m taubenschiesser-api-prod
```

---

## Log-Rotation

Die Logs werden automatisch rotiert, um Speicherplatz zu sparen.

### Konfiguration

In `docker-compose.prod.yml`:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"    # Max. 10 MB pro Log-Datei
    max-file: "3"      # Max. 3 Dateien behalten
```

**Maximaler Speicherplatz pro Container:** 30 MB (3 × 10 MB)

### Log-Dateien finden

```bash
# Log-Datei-Pfad anzeigen
docker inspect taubenschiesser-api-prod | grep LogPath

# Log-Dateien direkt lesen (erfordert sudo)
sudo ls -lh /var/lib/docker/containers/*/
```

### Logs manuell löschen

```bash
# Container stoppen
docker-compose -f docker-compose.prod.yml stop api

# Logs löschen
docker logs taubenschiesser-api-prod 2>&1 | head -n 0

# Oder: Container neu erstellen
docker-compose -f docker-compose.prod.yml up -d --force-recreate api
```

---

## Troubleshooting

### Container startet nicht

```bash
# Container-Status prüfen
docker-compose -f docker-compose.prod.yml ps

# Logs des nicht startenden Containers
docker-compose -f docker-compose.prod.yml logs api

# Detaillierte Fehler
docker inspect taubenschiesser-api-prod
```

### CV Service Fehler

```bash
# CV Service Logs
docker-compose -f docker-compose.prod.yml logs -f cv-service

# Häufige Fehler:
# - Modell nicht gefunden → models/yolov8l.onnx prüfen
# - ONNX Runtime Error → Container mit privileged: true starten
```

### API Verbindungsprobleme

```bash
# API Logs
docker-compose -f docker-compose.prod.yml logs -f api

# MongoDB-Verbindung prüfen
docker-compose -f docker-compose.prod.yml exec api sh -c "curl -v http://localhost:5000/health"

# Häufige Fehler:
# - MongoDB nicht erreichbar → MONGODB_URI in .env.prod prüfen
# - JWT_SECRET fehlt → .env.prod prüfen
```

### Hardware Monitor Probleme

```bash
# Hardware Monitor Logs
docker-compose -f docker-compose.prod.yml logs -f hardware-monitor

# Häufige Fehler:
# - MQTT Broker nicht erreichbar → MQTT-Settings im Dashboard prüfen
# - API nicht erreichbar → API_URL in docker-compose.prod.yml prüfen
```

### Frontend lädt nicht

```bash
# Frontend Logs
docker-compose -f docker-compose.prod.yml logs -f frontend

# Nginx Konfiguration testen
docker-compose -f docker-compose.prod.yml exec frontend nginx -t

# Häufige Fehler:
# - API URL falsch → REACT_APP_API_URL beim Build prüfen
# - Port 3000 bereits belegt → Port in docker-compose.prod.yml ändern
```

### Netzwerk-Probleme zwischen Containern

```bash
# Netzwerk-Konfiguration prüfen
docker network inspect taubenschiesser_aws_taubenschiesser-network

# Container im Netzwerk
docker network inspect taubenschiesser_aws_taubenschiesser-network | grep -A 3 "Containers"

# Container-zu-Container Verbindung testen
docker-compose -f docker-compose.prod.yml exec api ping cv-service
```

---

## Schnellreferenz

### Meistgenutzte Befehle

```bash
# Live-Überwachung ALLER Container (empfohlen für Monitoring)
docker-compose -f docker-compose.prod.yml logs -f api cv-service frontend hardware-monitor

# Letzte 100 Zeilen aller Container
docker-compose -f docker-compose.prod.yml logs --tail=100

# API-Fehler suchen
docker-compose -f docker-compose.prod.yml logs api | grep -i error

# CV Service live überwachen
docker-compose -f docker-compose.prod.yml logs -f cv-service

# Container-Status
docker-compose -f docker-compose.prod.yml ps

# Container neustarten
docker-compose -f docker-compose.prod.yml restart api
```

### Nützliche Aliases (optional)

Füge zu deiner `~/.bashrc` oder `~/.zshrc` hinzu:

```bash
# Docker Compose Shortcut
alias dcp='docker-compose -f docker-compose.prod.yml'

# Dann kannst du verwenden:
dcp logs -f api                    # Statt: docker-compose -f docker-compose.prod.yml logs -f api
dcp ps                              # Status
dcp restart api                     # Restart
dcp logs -f api cv-service frontend hardware-monitor  # Alle Logs
```

---

## Weitere Ressourcen

- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Komplette Deployment-Anleitung
- **[QUICKSTART_MONGODB.md](QUICKSTART_MONGODB.md)** - Schnellstart für Produktion
- **[README.md](../README.md)** - Projekt-Übersicht

---

**Zurück zur Dokumentation**: [docs/README.md](README.md)

