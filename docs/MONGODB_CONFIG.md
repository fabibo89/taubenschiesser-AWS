# MongoDB Konfiguration für lokales Produktions-Deployment

## Übersicht

Für das lokale Produktions-Deployment mit einer bereits laufenden MongoDB auf dem Server wurden folgende Anpassungen vorgenommen:

- ✅ MongoDB-Service aus `docker-compose.prod.yml` entfernt
- ✅ API-Container nutzt externe MongoDB über `host.docker.internal`
- ✅ Volumes für MongoDB entfernt
- ✅ Network-Konfiguration optimiert

## Voraussetzungen

### 1. MongoDB muss bereits auf dem Host-System laufen

Prüfe, ob MongoDB läuft:

```bash
# Systemd-Service prüfen
sudo systemctl status mongod

# Oder direkt Port prüfen
sudo netstat -tuln | grep 27017
```

Falls MongoDB noch nicht installiert ist:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install mongodb-org

# macOS
brew install mongodb-community

# Service starten
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 2. MongoDB User und Datenbank erstellen

Verbinde dich mit MongoDB:

```bash
mongosh
```

Erstelle einen Admin-User (falls noch nicht vorhanden):

```javascript
use admin

db.createUser({
  user: "admin",
  pwd: "DEIN_SICHERES_PASSWORT",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase" ]
})
```

Erstelle die Taubenschiesser-Datenbank:

```javascript
use taubenschiesser

// Datenbank wird beim ersten Insert automatisch erstellt
db.createCollection("devices")
```

## Environment-Konfiguration (.env.prod)

Erstelle eine `.env.prod` Datei im Root-Verzeichnis:

```bash
cd /Users/fabianbosch/Documents/GitHub/taubenschiesser_AWS
nano .env.prod
```

### Beispiel-Konfiguration

```env
# ======================
# MongoDB Konfiguration
# ======================
# WICHTIG: Verwende "host.docker.internal" um vom Container auf den Host zuzugreifen

# Option 1: MongoDB mit Authentifizierung (empfohlen)
MONGODB_URI=mongodb://admin:DEIN_MONGO_PASSWORT@host.docker.internal:27017/taubenschiesser?authSource=admin

# Option 2: MongoDB ohne Authentifizierung (nur für Tests!)
# MONGODB_URI=mongodb://host.docker.internal:27017/taubenschiesser

# Option 3: MongoDB auf anderer Server-IP
# MONGODB_URI=mongodb://admin:PASSWORT@192.168.1.100:27017/taubenschiesser?authSource=admin

# ======================
# Sicherheit
# ======================
JWT_SECRET=AENDERE-MICH-MINDESTENS-32-ZEICHEN-LANGER-SCHLUESSEL

# ======================
# URLs & Ports
# ======================
# Passe die IP-Adresse an deine Server-IP an
CLIENT_URL=http://192.168.1.100:3000
REACT_APP_API_URL=http://192.168.1.100:5001

# ======================
# AWS IoT (Optional)
# ======================
# Nur benötigt, wenn AWS IoT Core statt lokalem MQTT verwendet wird
# AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com
# AWS_REGION=eu-central-1
```

## MongoDB-URI Erklärung

Die MongoDB-URI hat folgendes Format:

```
mongodb://[username:password@]host[:port][/database][?options]
```

### Wichtige Hinweise:

1. **`host.docker.internal`**: Spezielle DNS-Name, um vom Docker-Container auf den Host zuzugreifen
   - Funktioniert auf macOS und Windows automatisch
   - Auf Linux: Wird durch `extra_hosts` in `docker-compose.prod.yml` ermöglicht

2. **`authSource=admin`**: Gibt an, in welcher Datenbank die User-Credentials gespeichert sind

3. **Port `27017`**: Standard MongoDB-Port

## Deployment

### 1. MongoDB-Verbindung testen

Bevor du die Docker-Container startest, teste die Verbindung:

```bash
# Von außerhalb des Containers
mongosh "mongodb://admin:DEIN_PASSWORT@localhost:27017/taubenschiesser?authSource=admin"
```

Falls die Verbindung funktioniert, ist MongoDB korrekt konfiguriert.

### 2. Docker Compose starten

```bash
# Mit .env.prod Datei
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Status prüfen
docker-compose -f docker-compose.prod.yml ps

# API-Logs ansehen (auf MongoDB-Verbindung achten)
docker-compose -f docker-compose.prod.yml logs -f api
```

Du solltest in den Logs sehen:

```
MongoDB Connected: host.docker.internal
```

### 3. Health Check

```bash
# API Health Check
curl http://localhost:5001/health

# Sollte zurückgeben:
# {"status":"OK","timestamp":"..."}
```

## Troubleshooting

### Problem: "Connection refused" oder "ECONNREFUSED"

**Ursache**: Container kann nicht auf Host-MongoDB zugreifen

**Lösung**:

1. Prüfe, ob MongoDB auf allen Interfaces lauscht:

```bash
# MongoDB Konfiguration prüfen
sudo cat /etc/mongod.conf

# net.bindIp sollte sein:
# bindIp: 0.0.0.0
# oder
# bindIp: 127.0.0.1,192.168.1.100
```

2. Editiere `/etc/mongod.conf`:

```bash
sudo nano /etc/mongod.conf
```

Stelle sicher:

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0  # Oder spezifische IPs
```

3. MongoDB neu starten:

```bash
sudo systemctl restart mongod
```

### Problem: "Authentication failed"

**Ursache**: Falsche Credentials oder authSource

**Lösung**:

1. Prüfe User in MongoDB:

```javascript
use admin
db.getUsers()
```

2. Teste Verbindung manuell:

```bash
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"
```

3. Falls User nicht existiert, erstelle ihn:

```javascript
use admin
db.createUser({
  user: "admin",
  pwd: "DEIN_PASSWORT",
  roles: [ { role: "root", db: "admin" } ]
})
```

### Problem: Container kann host.docker.internal nicht auflösen (Linux)

**Ursache**: `host.docker.internal` ist nicht standardmäßig auf Linux verfügbar

**Lösung**: Die `docker-compose.prod.yml` enthält bereits `extra_hosts`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Dies sollte das Problem beheben. Falls nicht, verwende direkt die IP-Adresse:

```bash
# Finde Host-IP
hostname -I
# z.B. 192.168.1.100

# In .env.prod:
MONGODB_URI=mongodb://admin:PASSWORT@192.168.1.100:27017/taubenschiesser?authSource=admin
```

### Problem: Datenbank-Verbindung langsam

**Ursache**: DNS-Auflösung oder Firewall

**Lösung**:

1. Verwende IP statt `host.docker.internal`
2. Prüfe Firewall:

```bash
# Ubuntu
sudo ufw status
sudo ufw allow 27017

# iptables
sudo iptables -L -n
```

## Backup & Restore

### Backup erstellen

```bash
# Vollständiges Backup
mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --out=/backup/$(date +%Y%m%d)

# Nur Taubenschiesser-Datenbank
mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --db=taubenschiesser --out=/backup/$(date +%Y%m%d)
```

### Backup wiederherstellen

```bash
# Vollständiges Restore
mongorestore --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" /backup/20241026

# Nur Taubenschiesser-Datenbank
mongorestore --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" --db=taubenschiesser /backup/20241026/taubenschiesser
```

## Migration von Docker-MongoDB

Falls du vorher MongoDB im Docker-Container hattest und jetzt auf die Host-MongoDB migrieren möchtest:

```bash
# 1. Backup aus Docker-Container erstellen
docker exec taubenschiesser-mongodb-prod mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --out=/dump

# 2. Backup aus Container kopieren
docker cp taubenschiesser-mongodb-prod:/dump ./mongodb-backup

# 3. In Host-MongoDB importieren
mongorestore --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" ./mongodb-backup

# 4. Verifizieren
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"
> db.devices.find()
```

## Sicherheits-Checkliste

- [ ] MongoDB verwendet starke Passwörter
- [ ] `bindIp` ist auf `0.0.0.0` ODER spezifische IPs beschränkt
- [ ] Firewall erlaubt nur notwendige Verbindungen zu Port 27017
- [ ] JWT_SECRET ist mindestens 32 Zeichen lang und zufällig
- [ ] `.env.prod` ist NICHT in Git committed (in `.gitignore`)
- [ ] Regelmäßige Backups sind eingerichtet
- [ ] MongoDB-Version ist aktuell (Sicherheitsupdates)

## Weitere Informationen

- [MongoDB Production Checklist](https://www.mongodb.com/docs/manual/administration/production-checklist-operations/)
- [Docker Networking](https://docs.docker.com/network/)
- [Docker Compose Environment Variables](https://docs.docker.com/compose/environment-variables/)

---

**Version**: 1.0  
**Erstellt**: Oktober 2024  
**Autor**: Fabian Bosch

