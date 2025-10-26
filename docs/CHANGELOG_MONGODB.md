# MongoDB Migration - Changelog

**Datum**: 26. Oktober 2024  
**Änderung**: Migration von Docker-basierter MongoDB zu Host-System MongoDB für lokales Produktions-Deployment

## Zusammenfassung

Das lokale Produktions-Deployment nutzt jetzt eine bereits laufende MongoDB auf dem Host-System statt eines MongoDB-Containers in Docker Compose.

## Geänderte Dateien

### 1. `docker-compose.prod.yml`

**Entfernt:**
- MongoDB-Service (`mongodb:`)
- MongoDB-Volumes (`mongodb_data`, `mongodb_config`)
- `depends_on: mongodb` im API-Service

**Hinzugefügt:**
- `extra_hosts: host.docker.internal:host-gateway` für Zugriff auf Host-MongoDB
- Kommentar-Hinweis auf externe MongoDB

**Geändert:**
- `MONGODB_URI` Environment-Variable nimmt jetzt Wert aus `.env.prod` (statt hardcoded)

### 2. `DEPLOYMENT_GUIDE.md`

**Aktualisiert:**
- Abschnitt "2. Lokaler Server (Produktion)" komplett überarbeitet
- Neue Schritte für MongoDB-Setup hinzugefügt
- MongoDB-URI Konfigurationsbeispiele erweitert
- Troubleshooting-Abschnitt für MongoDB-Verbindungsprobleme hinzugefügt
- Backup-Kommandos angepasst (Host statt Container)

### 3. `MONGODB_CONFIG.md` (NEU)

**Erstellt:**
- Vollständige Anleitung für MongoDB-Konfiguration
- Installationsanleitung für verschiedene Betriebssysteme
- User- und Datenbank-Setup
- Environment-Konfigurationsbeispiele
- Ausführliches Troubleshooting
- Backup & Restore Anleitungen
- Migrations-Anleitung von Docker-MongoDB zu Host-MongoDB
- Sicherheits-Checkliste

## Migration für bestehende Installationen

Wenn du bereits eine laufende Taubenschiesser-Installation mit Docker-MongoDB hast:

### Schritt 1: Backup erstellen

```bash
docker exec taubenschiesser-mongodb-prod mongodump \
  --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" \
  --out=/dump

docker cp taubenschiesser-mongodb-prod:/dump ./mongodb-backup
```

### Schritt 2: MongoDB auf Host installieren

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Schritt 3: User erstellen

```bash
mongosh

# In MongoDB Shell:
use admin
db.createUser({
  user: "admin",
  pwd: "DEIN_SICHERES_PASSWORT",
  roles: [ { role: "root", db: "admin" } ]
})
exit
```

### Schritt 4: Backup wiederherstellen

```bash
mongorestore \
  --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" \
  ./mongodb-backup
```

### Schritt 5: .env.prod anpassen

```env
MONGODB_URI=mongodb://admin:DEIN_PASSWORT@host.docker.internal:27017/taubenschiesser?authSource=admin
```

### Schritt 6: Docker Compose neu starten

```bash
# Alte Container stoppen und entfernen
docker-compose -f docker-compose.prod.yml down

# Mit neuer Konfiguration starten (MongoDB-Container wird nicht mehr gestartet)
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Logs prüfen
docker-compose -f docker-compose.prod.yml logs -f api
# Erwartete Ausgabe: "MongoDB Connected: host.docker.internal"
```

### Schritt 7: Alte MongoDB-Volumes aufräumen (optional)

```bash
# Achtung: Nur wenn Backup erfolgreich und neue MongoDB funktioniert!
docker volume ls | grep mongodb
docker volume rm taubenschiesser_AWS_mongodb_data
docker volume rm taubenschiesser_AWS_mongodb_config
```

## Vorteile der neuen Konfiguration

✅ **Bessere Performance**: Keine Virtualisierungsschicht zwischen App und Datenbank  
✅ **Einfachere Backups**: Standard-MongoDB-Tools ohne Docker  
✅ **Flexibilität**: Einfacher Zugriff für externe Tools (Compass, etc.)  
✅ **Monitoring**: Systemd-Integration für Logs und Status  
✅ **Konsistenz**: Gleiche MongoDB-Installation für Dev und Prod  
✅ **Skalierung**: Einfacher auf separaten DB-Server zu migrieren  

## Nachteile/Überlegungen

⚠️ **Zusätzliche Installation**: MongoDB muss separat installiert werden  
⚠️ **Updates**: MongoDB muss manuell aktualisiert werden  
⚠️ **Abhängigkeit**: Docker Compose startet nicht mehr "alles"  

## Rückgängig machen

Falls du zurück zu Docker-MongoDB wechseln möchtest:

```bash
# 1. Backup von Host-MongoDB erstellen
mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --out=./backup

# 2. Alte docker-compose.prod.yml wiederherstellen
git checkout HEAD -- docker-compose.prod.yml

# 3. .env.prod anpassen
MONGODB_URI=mongodb://admin:PASSWORT@mongodb:27017/taubenschiesser?authSource=admin

# 4. Mit MongoDB-Container starten
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 5. Backup wiederherstellen
docker cp ./backup taubenschiesser-mongodb-prod:/dump
docker exec taubenschiesser-mongodb-prod mongorestore \
  --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" \
  /dump
```

## Support

Bei Problemen siehe:
- [MONGODB_CONFIG.md](MONGODB_CONFIG.md) - Vollständige Dokumentation
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Deployment-Anleitung

## Tests

Folgende Szenarien wurden getestet:

- ✅ Neue Installation mit Host-MongoDB
- ✅ Migration von Docker-MongoDB zu Host-MongoDB  
- ✅ Verbindung von Docker-Container zu Host-MongoDB (Linux, macOS)
- ✅ Backup & Restore
- ✅ User-Authentifizierung
- ✅ Mehrere gleichzeitige Verbindungen

---

**Version**: 1.0  
**Autor**: Fabian Bosch

