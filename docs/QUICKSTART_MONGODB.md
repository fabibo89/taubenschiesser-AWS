# Quick Start - Lokales Produktions-Deployment mit Host-MongoDB

Schnellanleitung für das Deployment auf lokalem Server mit bereits laufender MongoDB.

## ⚡ Schnellstart (5 Minuten)

### 1. Prüfe MongoDB

```bash
sudo systemctl status mongod
# Falls nicht läuft: sudo systemctl start mongod
```

### 2. Erstelle .env.prod

```bash
cp docs/env.prod.template .env.prod
nano .env.prod
```

**Minimal-Konfiguration (ändere diese Werte!):**

```env
MONGODB_URI=mongodb://admin:DEIN_MONGO_PASSWORT@host.docker.internal:27017/taubenschiesser?authSource=admin
JWT_SECRET=GENERIERE_EINEN_32_ZEICHEN_SCHLUESSEL
CLIENT_URL=http://DEINE_SERVER_IP:3000
REACT_APP_API_URL=http://DEINE_SERVER_IP:5001
```

### 3. Starte Services

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 4. Prüfe Status

```bash
# Container-Status
docker-compose -f docker-compose.prod.yml ps

# API-Logs (auf MongoDB-Verbindung achten)
docker-compose -f docker-compose.prod.yml logs -f api
# ✅ Erwartete Ausgabe: "MongoDB Connected: host.docker.internal"

# Health Check
curl http://localhost:5001/health
```

### 5. Erstelle User

```bash
docker exec -it taubenschiesser-api-prod /bin/sh
node create_user.js
exit
```

### 6. Fertig! 🎉

Öffne `http://DEINE_SERVER_IP:3000` im Browser.

---

## 📋 Checkliste: Erstmalige Installation

- [ ] MongoDB ist installiert und läuft auf dem Host
- [ ] MongoDB User erstellt (siehe unten)
- [ ] `.env.prod` Datei erstellt und angepasst
- [ ] Docker Compose gestartet
- [ ] API verbindet sich erfolgreich mit MongoDB
- [ ] Health Check erfolgreich
- [ ] User erstellt
- [ ] Login im Dashboard funktioniert
- [ ] MQTT konfiguriert (Dashboard → Profil → Einstellungen)

---

## 🔧 MongoDB Setup (Falls noch nicht vorhanden)

### Installation

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod

# macOS
brew install mongodb-community
brew services start mongodb-community
```

### User erstellen

```bash
mongosh

# In der MongoDB Shell:
use admin

db.createUser({
  user: "admin",
  pwd: "DEIN_SICHERES_PASSWORT",
  roles: [ { role: "root", db: "admin" } ]
})

exit
```

### bindIp konfigurieren (wichtig!)

```bash
sudo nano /etc/mongod.conf
```

Stelle sicher:

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0  # Oder 127.0.0.1 für mehr Sicherheit
```

Neu starten:

```bash
sudo systemctl restart mongod
```

---

## 🚀 Häufige Befehle

### Services verwalten

```bash
# Starten
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Stoppen
docker-compose -f docker-compose.prod.yml down

# Neu starten
docker-compose -f docker-compose.prod.yml restart api

# Status anzeigen
docker-compose -f docker-compose.prod.yml ps

# Logs ansehen
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f cv-service
```

### MongoDB verwalten

```bash
# Status prüfen
sudo systemctl status mongod

# Neu starten
sudo systemctl restart mongod

# Logs ansehen
sudo journalctl -u mongod -f

# MongoDB Shell
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"
```

### Backup & Restore

```bash
# Backup erstellen
mongodump \
  --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" \
  --out=./backup-$(date +%Y%m%d)

# Backup wiederherstellen
mongorestore \
  --uri="mongodb://admin:PASSWORT@localhost:27017/?authSource=admin" \
  ./backup-20241026
```

---

## ❌ Troubleshooting

### Problem: "MongoDB Connected" erscheint nicht in den Logs

**Lösung 1: MongoDB läuft nicht**

```bash
sudo systemctl status mongod
sudo systemctl start mongod
```

**Lösung 2: Falsche Credentials**

```bash
# Teste Verbindung manuell
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"
```

**Lösung 3: bindIp falsch konfiguriert**

```bash
# Prüfe Konfiguration
sudo cat /etc/mongod.conf | grep bindIp

# Sollte sein: bindIp: 0.0.0.0
# Editieren und neu starten:
sudo nano /etc/mongod.conf
sudo systemctl restart mongod
```

### Problem: "Connection refused" oder "ECONNREFUSED"

**Ursache**: Container kann nicht auf Host-MongoDB zugreifen

**Lösung**:

```bash
# 1. Prüfe ob MongoDB auf Port 27017 lauscht
sudo netstat -tuln | grep 27017

# 2. Prüfe ob host.docker.internal funktioniert
docker exec taubenschiesser-api-prod ping -c 1 host.docker.internal

# 3. Falls ping fehlschlägt, verwende direkte IP in .env.prod:
# Finde Server-IP:
hostname -I
# Setze in .env.prod:
# MONGODB_URI=mongodb://admin:PASSWORT@192.168.1.100:27017/taubenschiesser?authSource=admin
```

### Problem: "Authentication failed"

**Lösung**:

```bash
# User in MongoDB prüfen
mongosh

use admin
db.getUsers()
exit

# Falls User nicht existiert, erstelle ihn:
mongosh

use admin
db.createUser({
  user: "admin",
  pwd: "DEIN_PASSWORT",
  roles: [ { role: "root", db: "admin" } ]
})
exit
```

---

## 📚 Vollständige Dokumentation

- **MongoDB-Konfiguration**: [MONGODB_CONFIG.md](MONGODB_CONFIG.md)
- **Deployment-Guide**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- **Änderungsprotokoll**: [CHANGELOG_MONGODB.md](CHANGELOG_MONGODB.md)

---

## 🔐 Sicherheits-Tipps

1. **Starke Passwörter verwenden**:
   ```bash
   # MongoDB-Passwort generieren
   openssl rand -base64 32
   
   # JWT-Secret generieren
   openssl rand -base64 32
   ```

2. **Firewall konfigurieren**:
   ```bash
   # Nur lokale Verbindungen zu MongoDB erlauben
   sudo ufw allow from 127.0.0.1 to any port 27017
   sudo ufw allow from 172.16.0.0/12 to any port 27017  # Docker-Netzwerk
   ```

3. **Regelmäßige Backups**:
   ```bash
   # Cronjob für tägliche Backups
   0 2 * * * mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --out=/backup/$(date +\%Y\%m\%d)
   ```

---

**Fragen?** Siehe [MONGODB_CONFIG.md](MONGODB_CONFIG.md) für ausführliche Hilfe!

