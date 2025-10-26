# Taubenschiesser - Deployment Guide

Komplette Anleitung für alle Deployment-Szenarien: Entwicklung, Lokaler Server und AWS Cloud.

---

## 📋 Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [1. Entwicklung (Lokal)](#1-entwicklung-lokal)
- [2. Lokaler Server (Produktion)](#2-lokaler-server-produktion)
- [3. AWS Cloud (Produktion)](#3-aws-cloud-produktion)
- [MQTT Konfiguration](#mqtt-konfiguration)
- [Troubleshooting](#troubleshooting)

---

## Übersicht

### Deployment-Szenarien

| Szenario | Verwendung | MQTT | Datenbank | Skalierung |
|----------|------------|------|-----------|------------|
| **1. Entwicklung** | Lokale Entwicklung mit Hot-Reload | Dein Mosquitto | MongoDB (Docker) | Nicht relevant |
| **2. Lokaler Server** | Produktiv auf eigenem Server | Dein Mosquitto | MongoDB (Docker) | Manuell |
| **3. AWS Cloud** | Cloud-Hosting | AWS IoT Core | DocumentDB | Automatisch |

### Was brauchst du?

**Alle Szenarien:**
- Git
- Docker & Docker Compose
- Node.js 18+
- Python 3.11+

**Nur AWS:**
- AWS Account
- AWS CLI
- Terraform
- ECR Registry

---

## 1. Entwicklung (Lokal)

Für lokale Entwicklung mit Live-Reload und schnellem Feedback.

### Quick Start

```bash
# Repository klonen
git clone https://github.com/your-username/taubenschiesser_AWS.git
cd taubenschiesser_AWS

# .env erstellen
cd server
./setup-env.sh
cd ..

# Development starten
./dev-start.sh
```

**Fertig!** Services laufen auf:
- Frontend: http://localhost:3000
- API: http://localhost:5001
- CV Service: http://localhost:8000
- MongoDB: localhost:27017

### Detaillierte Schritte

#### 1.1 Dependencies installieren

```bash
# Root Dependencies
npm install

# Server Dependencies
cd server && npm install && cd ..

# Client Dependencies
cd client && npm install && cd ..

# CV Service
cd cv-service
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
deactivate
cd ..
```

#### 1.2 Environment konfigurieren

**Option A: Mit Setup-Script (empfohlen)**

```bash
cd server
./setup-env.sh
```

Das Script erstellt automatisch **beide** `.env` Dateien mit allen notwendigen Variablen:
- `server/.env` - API Server Konfiguration
- `cv-service/.env` - Computer Vision Service Konfiguration

**Option B: Manuell**

**Server .env:**
```bash
cd server
nano .env
```

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin
JWT_SECRET=your-super-secret-jwt-key
CLIENT_URL=http://localhost:3000
CV_SERVICE_URL=http://localhost:8000

# AWS IoT auskommentiert (lokal nicht benötigt)
# AWS_IOT_ENDPOINT=...
# AWS_REGION=eu-central-1
```

**CV Service .env:**
```bash
cd cv-service
nano .env
```

```env
# Service Selection
CV_SERVICE=yolov8  # 'yolov8' oder 'rekognition'

# YOLOv8 Configuration
# Relative path from cv-service directory
MODEL_PATH=../models/yolov8l.onnx
YOLO_CONFIDENCE=0.25
YOLO_IOU=0.45

# AWS Rekognition (optional, nur wenn CV_SERVICE=rekognition)
# AWS_REGION=eu-central-1
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
```

#### 1.3 Services starten

**Option A: Mit dev-start.sh (empfohlen)**

```bash
chmod +x dev-start.sh
./dev-start.sh
```

Startet automatisch:
- MongoDB (Docker)
- CV Service (Python, lokal)
- Hardware Monitor (Python, lokal)
- API Server (Node.js mit Nodemon)
- Frontend (React mit Hot-Reload)

**Option B: Manuell**

```bash
# MongoDB starten
docker-compose up -d mongodb

# Terminal 1: API Server
cd server
npm run dev

# Terminal 2: Frontend
cd client
npm start

# Terminal 3: CV Service
cd cv-service
source venv/bin/activate
python app.py

# Terminal 4: Hardware Monitor
cd hardware-monitor
python main.py
```

#### 1.4 User erstellen

```bash
cd server
node create_user.js

# Erstellt:
# Email: fabian.bosch@gmx.de
# Password: rotwand
# Role: admin
```

#### 1.5 MQTT konfigurieren

1. Öffne http://localhost:3000
2. Login
3. **Profil** → **Einstellungen** → **MQTT**
4. Eintragen:
   ```
   ✅ MQTT aktivieren
   Server-Profil: custom
   Broker: 192.168.1.x  (Dein Mosquitto)
   Port: 1883
   ```
5. **MQTT-Verbindung testen**
6. **Einstellungen speichern**

#### 1.6 Stoppen

```bash
# Mit Script
./dev-stop.sh

# Oder manuell: Ctrl+C in allen Terminals
```

### Development Workflow

```bash
# Code ändern → automatisch neu geladen!
# Frontend: React Hot-Reload
# Backend: Nodemon Auto-Restart
# CV Service: Manuell neu starten

# Logs ansehen
tail -f cv-service.log
tail -f hardware-monitor.log
docker-compose logs -f mongodb
```

---

## 2. Lokaler Server (Produktion)

Für stabilen Dauerbetrieb auf deinem eigenen Server.

### ⚠️ WICHTIG: MongoDB-Konfiguration

Dieses Setup nutzt eine **bereits laufende MongoDB** auf dem Host-System statt eines Docker-Containers.

**Voraussetzung**: MongoDB muss auf dem Server installiert und gestartet sein.

Siehe **[MONGODB_CONFIG.md](MONGODB_CONFIG.md)** für eine vollständige Anleitung.

### Quick Start

```bash
cd taubenschiesser_AWS

# 1. Stelle sicher, dass MongoDB läuft
sudo systemctl status mongod

# 2. YOLOv8 Model herunterladen (nur beim ersten Mal)
cd models
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
mv yolov8n.onnx yolov8l.onnx
cd ..

# 3. Deploy Script starten
chmod +x deploy-local.sh
./deploy-local.sh
# Wähle: 2 (Produktion)
# Script erstellt interaktiv .env.prod für dich
```

### Detaillierte Schritte

#### 2.1 MongoDB vorbereiten

**Falls MongoDB noch nicht installiert:**

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

**MongoDB User erstellen:**

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

Detaillierte Anleitung: **[MONGODB_CONFIG.md](MONGODB_CONFIG.md)**

#### 2.2 YOLOv8 Model herunterladen ⚠️

**WICHTIG**: Das YOLOv8 Model ist **NICHT** auf GitHub (zu groß: ~500MB)!

Du musst es **vor dem ersten Start** herunterladen:

```bash
cd ~/docker/taubenschiesser-AWS/models

# Option A: Kleines Model zum Testen (6 MB, schneller)
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
mv yolov8n.onnx yolov8l.onnx

# Option B: Großes Model für Produktion (500 MB, genauer)
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8l.onnx

# Prüfen
ls -lh yolov8l.onnx
# Sollte Dateigröße anzeigen (6 MB oder 500 MB)
```

**Model-Optionen:**

| Model | Größe | Geschwindigkeit | Genauigkeit | Verwendung |
|-------|-------|-----------------|-------------|------------|
| yolov8n | 6 MB | Sehr schnell | Niedrig | Test & Entwicklung |
| yolov8s | 22 MB | Schnell | Mittel | - |
| yolov8m | 50 MB | Mittel | Gut | - |
| **yolov8l** | **500 MB** | Langsam | **Sehr gut** | **Produktion** |

**Warum nicht auf GitHub?**
- Models sind in `.gitignore` (zu groß für Git)
- Du musst sie separat herunterladen
- Nur einmal nötig, dann bleiben sie lokal

#### 2.3 Deployment mit deploy-local.sh (Empfohlen) 🚀

Das **deploy-local.sh** Script automatisiert das gesamte Deployment und führt dich interaktiv durch die Konfiguration.

**Vorbereitung:**

```bash
chmod +x deploy-local.sh
```

**Script starten:**

```bash
./deploy-local.sh
```

**Was das Script macht:**

1. **Prüft Voraussetzungen**
   - `.env.prod` vorhanden?
   - Docker läuft?
   - MongoDB läuft? (bei Produktions-Modus)

2. **Erstellt `.env.prod` interaktiv** (falls nicht vorhanden)
   ```
   MongoDB Host [host.docker.internal]: ← Enter
   MongoDB Port [27017]: ← Enter
   MongoDB Username [admin]: ← Enter
   MongoDB Passwort: ← Dein Passwort eingeben
   MongoDB Datenbank [taubenschiesser]: ← Enter
   
   Server IP-Adresse [localhost]: 192.168.1.100 ← Deine IP
   ```
   
   - Generiert automatisch sicheren JWT Secret
   - Erstellt vollständige `.env.prod` Datei

3. **Wähle Deployment-Modus**
   ```
   1) Entwicklung (docker-compose.yml)
   2) Produktion (docker-compose.prod.yml)
   
   Wähle (1 oder 2): 2
   ```

4. **Baut Docker Images und startet Services**
   - Automatisches Build aller Images
   - Startet alle Container
   - Zeigt Status und nächste Schritte

**Nach dem Deployment zeigt das Script:**

```
✅ Deployment abgeschlossen!

📊 Service Status:
NAME                              STATUS
taubenschiesser-api-prod          Up
taubenschiesser-cv-prod           Up
taubenschiesser-frontend-prod     Up
taubenschiesser-hardware-monitor  Up

🌐 URLs:
  Frontend: http://localhost:3000
  API:      http://localhost:5001
  CV:       http://localhost:8000

📝 Nächste Schritte:
1. Prüfe Verbindung:
   curl http://localhost:5001/health
   
2. Prüfe MongoDB-Verbindung in API-Logs:
   docker-compose -f docker-compose.prod.yml logs api | grep MongoDB
   → Erwartete Ausgabe: "MongoDB Connected: host.docker.internal"
   
3. Erstelle einen User:
   docker exec -it taubenschiesser-api-prod /bin/sh
   node create_user.js
   exit
   
4. Öffne http://localhost:3000 im Browser

5. Konfiguriere MQTT im Dashboard:
   → Profil → Einstellungen → MQTT
   → Server-Profil: custom
   → Broker: 192.168.1.x (dein Mosquitto)
   → Port: 1883
   → MQTT-Verbindung testen
   → Einstellungen speichern
```

#### 2.4 Manuelle Konfiguration (Alternative)

Falls du die `.env.prod` manuell erstellen möchtest:

**Template kopieren:**

```bash
cp docs/env.prod.template .env.prod
nano .env.prod
```

**Wichtig - UNBEDINGT ändern:**

```env
# MongoDB Konfiguration (auf Host-System)
# WICHTIG: "host.docker.internal" verweist auf den Host
MONGODB_URI=mongodb://admin:DEIN_MONGO_PASSWORT@host.docker.internal:27017/taubenschiesser?authSource=admin

# Sichere Passwörter!
JWT_SECRET=mindestens-32-zeichen-langer-schluessel

# Server-Adresse (WICHTIG für Zugriff von anderen Geräten!)
# Option A: Hostname (einfacher zu merken)
CLIENT_URL=http://casahosch:3000
REACT_APP_API_URL=http://casahosch:5001

# Option B: IP-Adresse (zuverlässiger)
# CLIENT_URL=http://192.168.1.100:3000
# REACT_APP_API_URL=http://192.168.1.100:5001

# ⚠️ NICHT "localhost" verwenden wenn du von Handy/Notebook zugreifen willst!

# Computer Vision
CV_SERVICE=yolov8
MODEL_PATH=/app/models/yolov8l.onnx
CLASSES_PATH=/app/models/yolov8l.json
YOLO_CONFIDENCE=0.25
YOLO_IOU=0.45

# AWS IoT (optional)
# AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com
# AWS_REGION=eu-central-1
```

**MongoDB-URI Optionen:**

- **Standard**: `mongodb://admin:PASSWORT@host.docker.internal:27017/taubenschiesser?authSource=admin`
- **Andere Server-IP**: `mongodb://admin:PASSWORT@192.168.1.100:27017/taubenschiesser?authSource=admin`
- **Ohne Auth** (nicht empfohlen): `mongodb://host.docker.internal:27017/taubenschiesser`

**JWT Secret generieren:**

```bash
openssl rand -base64 32
```

#### 2.5 Docker Images bauen und starten

**Mit deploy-local.sh:**

```bash
./deploy-local.sh
# Wähle: 2 (Produktion)
```

**Manuell:**

```bash
# Images bauen (kann 5-10 Min dauern)
docker-compose -f docker-compose.prod.yml --env-file .env.prod build

# Services starten
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Status prüfen
docker-compose -f docker-compose.prod.yml ps

# Logs ansehen (achte auf erfolgreiche MongoDB-Verbindung)
docker-compose -f docker-compose.prod.yml logs -f api
# Erwartete Ausgabe: "MongoDB Connected: host.docker.internal"
```

#### 2.6 Health Check & Verifizierung

```bash
# Warte 30 Sekunden, dann:

# 1. Health Check
curl http://localhost:5001/health
# Erwartete Ausgabe: {"status":"OK","timestamp":"..."}

curl http://localhost:8000/health
# Erwartete Ausgabe: {"status":"healthy",...}

# 2. MongoDB-Verbindung prüfen
docker-compose -f docker-compose.prod.yml logs api | grep MongoDB
# Erwartete Ausgabe: "MongoDB Connected: host.docker.internal"

# 3. Frontend öffnen
open http://localhost:3000
# Oder im Browser: http://DEINE_SERVER_IP:3000
```

#### 2.7 User erstellen

```bash
# In API Container
docker exec -it taubenschiesser-api-prod /bin/sh
node create_user.js
exit

# Standard-User wird erstellt:
# Email: fabian.bosch@gmx.de
# Passwort: rotwand
# Rolle: admin
```

#### 2.8 MQTT konfigurieren

Nach dem Login im Dashboard:

1. Navigiere zu **Profil** → **Einstellungen** → **MQTT**
2. Aktiviere MQTT: ✅
3. Wähle **Server-Profil**: `custom`
4. Trage ein:
   - **Broker**: `192.168.1.x` (IP deines Mosquitto-Servers)
   - **Port**: `1883`
   - **Username**: (optional)
   - **Password**: (optional)
5. Klicke **MQTT-Verbindung testen**
6. Bei Erfolg: **Einstellungen speichern**

Die MQTT-Konfiguration wird in der MongoDB gespeichert (`users.settings.mqtt`).

#### 2.9 Autostart bei Server-Neustart

**Systemd Service erstellen:**

```bash
sudo nano /etc/systemd/system/taubenschiesser.service
```

Inhalt:
```ini
[Unit]
Description=Taubenschiesser Docker Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/yourusername/taubenschiesser_AWS
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Aktivieren:
```bash
sudo systemctl enable taubenschiesser
sudo systemctl start taubenschiesser
sudo systemctl status taubenschiesser
```

### Verwaltung

#### Updates von GitHub

**Mit update-prod.sh (empfohlen):**

```bash
# Update-Script ausführbar machen (einmalig)
chmod +x update-prod.sh

# Updates holen und deployen
./update-prod.sh
```

**Was das Script macht:**
1. ✅ Prüft Git-Status
2. ✅ Holt Updates von GitHub (`git pull`)
3. ✅ Baut Docker Images neu
4. ✅ Startet Services neu
5. ✅ Führt Health Checks durch
6. ✅ Zeigt Status und Logs

**Ausgabe:**
```
✓ Updates erfolgreich geholt
✓ Docker Images erfolgreich gebaut
✓ Services neu gestartet

📊 Service Status:
✓ API:         http://localhost:5001 - OK
✓ CV-Service:  http://localhost:8000 - OK
✓ Frontend:    http://localhost:3000 - OK

MongoDB Connected: host.docker.internal

🎉 Update erfolgreich abgeschlossen!
```

#### Schnellbefehle mit deploy-local.sh

```bash
# Komplettes Neu-Deployment (z.B. nach Konfigurationsänderung)
./deploy-local.sh
# Wähle: 2 (Produktion)

# Das Script macht automatisch:
# - Prüft MongoDB-Verbindung
# - Erstellt .env.prod (falls nicht vorhanden)
# - Baut neue Images
# - Startet Services neu
# - Zeigt Status und nächste Schritte
```

#### Manuelle Verwaltung

```bash
# Logs ansehen
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f cv-service
docker-compose -f docker-compose.prod.yml logs -f frontend

# Einzelnen Service neu starten
docker-compose -f docker-compose.prod.yml restart api

# Alle Services neu starten
docker-compose -f docker-compose.prod.yml restart

# Nach Code-Update (git pull)
git pull
docker-compose -f docker-compose.prod.yml up -d --build
# Oder einfach: ./deploy-local.sh

# Status prüfen
docker-compose -f docker-compose.prod.yml ps

# MongoDB Backup erstellen (auf Host-System)
# WICHTIG: MongoDB läuft auf dem Host, nicht in Docker!
mongodump --uri="mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin" --out=./backup-$(date +%Y%m%d)
# Siehe MONGODB_CONFIG.md für mehr Backup-Optionen

# Services stoppen
docker-compose -f docker-compose.prod.yml down

# Services stoppen UND Container entfernen
docker-compose -f docker-compose.prod.yml down -v
# ACHTUNG: Löscht NICHT die MongoDB-Daten (die liegen auf dem Host)
```

---

## 3. AWS Cloud (Produktion)

Für skalierbaren Cloud-Betrieb mit AWS.

### Quick Start

```bash
cd taubenschiesser_AWS/aws

# AWS konfigurieren
aws configure

# Terraform Variablen
cd terraform
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # Werte eintragen

# Deploy
terraform init
terraform apply

# IoT Endpoint abrufen
terraform output iot_endpoint
```

### Detaillierte Schritte

#### 3.1 Voraussetzungen

**AWS Account Setup:**
- AWS Account erstellt
- IAM User mit Admin-Rechten
- Access Key und Secret Key

**Lokal installiert:**
```bash
# AWS CLI
aws --version

# Terraform
terraform --version

# Docker
docker --version
```

#### 3.2 AWS CLI konfigurieren

```bash
aws configure

# Eingaben:
AWS Access Key ID: AKIA...
AWS Secret Access Key: secret...
Default region name: eu-central-1
Default output format: json
```

#### 3.3 Terraform Variablen

```bash
cd aws/terraform
nano terraform.tfvars
```

Inhalt:
```hcl
aws_region = "eu-central-1"
project_name = "taubenschiesser"
jwt_secret = "dein-super-geheimer-jwt-schluessel"
docdb_password = "dein-sicheres-db-passwort"
ecr_repository_url = "123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser"
```

#### 3.4 ECR Repository erstellen

```bash
# ECR für Docker Images
aws ecr create-repository \
  --repository-name taubenschiesser \
  --region eu-central-1

# URL notieren, z.B.:
# 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser
```

#### 3.5 Docker Images bauen und pushen

```bash
# ECR Login
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.eu-central-1.amazonaws.com

# API Image
cd ../../server
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:api-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:api-latest

# CV Service Image
cd ../cv-service
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest

# Frontend Image
cd ../client
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest
```

#### 3.6 Terraform Deploy

```bash
cd ../aws/terraform

# Initialisieren
terraform init

# Plan prüfen
terraform plan

# Deployen (dauert 15-20 Min)
terraform apply
```

**Erstellt:**
- VPC mit Public/Private Subnets
- ECS Cluster (Fargate)
- DocumentDB Cluster
- Application Load Balancer
- AWS IoT Core (Thing Type, Policy, Rules)
- CloudWatch Logs

#### 3.7 AWS IoT Core Setup

Nach dem Terraform Deploy:

```bash
# IoT Endpoint abrufen
cd aws/terraform
terraform output -raw iot_endpoint

# Beispiel: a1b2c3d4e5f6g7-ats.iot.eu-central-1.amazonaws.com
```

**Device registrieren:**

```bash
cd ../scripts
chmod +x register-device.sh
./register-device.sh terasse-west eu-central-1

# Erstellt Zertifikate in:
# ./certs/terasse-west/
#   - certificate.pem.crt
#   - private.pem.key
#   - AmazonRootCA1.pem
#   - device-config.json
```

**⚠️ WICHTIG:** Zertifikate sicher aufbewahren!

#### 3.8 ESP32 Firmware

Zertifikate auf ESP32 flashen:

```cpp
// AWS IoT Konfiguration
const char* aws_endpoint = "a1b2c3d4e5f6g7-ats.iot.eu-central-1.amazonaws.com";
const char* device_name = "terasse-west";
const int aws_port = 8883;

// Zertifikate (aus generierten Files)
const char* root_ca = R"EOF(
-----BEGIN CERTIFICATE-----
[Inhalt von AmazonRootCA1.pem]
-----END CERTIFICATE-----
)EOF";

const char* certificate = R"EOF(
-----BEGIN CERTIFICATE-----
[Inhalt von certificate.pem.crt]
-----END CERTIFICATE-----
)EOF";

const char* private_key = R"EOF(
-----BEGIN RSA PRIVATE KEY-----
[Inhalt von private.pem.key]
-----END RSA PRIVATE KEY-----
)EOF";

// TLS Setup
WiFiClientSecure espClient;
espClient.setCACert(root_ca);
espClient.setCertificate(certificate);
espClient.setPrivateKey(private_key);

PubSubClient client(espClient);
client.setServer(aws_endpoint, aws_port);
```

#### 3.9 Deployment prüfen

```bash
# Load Balancer URL
terraform output load_balancer_dns

# Frontend öffnen
open http://$(terraform output -raw load_balancer_dns)

# Services prüfen
aws ecs list-services \
  --cluster taubenschiesser-cluster \
  --region eu-central-1

# Logs
aws logs tail /ecs/taubenschiesser-api --follow --region eu-central-1
```

### AWS Verwaltung

```bash
# Service neu starten
aws ecs update-service \
  --cluster taubenschiesser-cluster \
  --service taubenschiesser-api \
  --force-new-deployment \
  --region eu-central-1

# Skalieren
aws ecs update-service \
  --cluster taubenschiesser-cluster \
  --service taubenschiesser-api \
  --desired-count 3 \
  --region eu-central-1

# Logs
aws logs tail /ecs/taubenschiesser-api --follow

# IoT Things auflisten
aws iot list-things \
  --thing-type-name taubenschiesser-device \
  --region eu-central-1

# Komplettes Teardown
cd aws/terraform
terraform destroy
```

### Kosten (ca.)

| Service | Konfiguration | Kosten/Monat |
|---------|---------------|--------------|
| ECS Fargate (3 Tasks) | API, CV, Frontend | ~$50 |
| DocumentDB | db.t3.medium | ~$70 |
| ALB | Standard | ~$16 |
| AWS IoT Core | 10 Geräte | ~$0.50 |
| CloudWatch | 7 Tage | ~$5 |
| **Total** | | **~$145/Monat** |

**Sparen:**
- Reserved Instances nutzen
- Task-Größen optimieren
- Log-Retention verkürzen

---

## MQTT Konfiguration

### Lokal (Entwicklung & Lokaler Server)

Du nutzt deinen **vorhandenen Mosquitto-Server**.

**Im Dashboard:**
1. Login → **Profil** → **Einstellungen** → **MQTT**
2. Konfiguration:
   ```
   ✅ MQTT aktivieren
   Server-Profil: custom
   Broker: 192.168.1.100  (Dein Mosquitto)
   Port: 1883
   Username: (optional)
   Password: (optional)
   ```
3. **MQTT-Verbindung testen**
4. **Einstellungen speichern**

**ESP32 Code:**
```cpp
const char* mqtt_server = "192.168.1.100";
const int mqtt_port = 1883;
const char* mqtt_topic = "taubenschiesser/192.168.1.87";

WiFiClient espClient;
PubSubClient client(espClient);
client.setServer(mqtt_server, mqtt_port);
```

### AWS Cloud

Nutzt **AWS IoT Core** statt Mosquitto.

**Device registrieren:**
```bash
cd aws/scripts
./register-device.sh mein-device eu-central-1
```

**ESP32 Code:**
```cpp
// TLS mit Zertifikaten!
const char* aws_endpoint = "xxxxx-ats.iot.eu-central-1.amazonaws.com";
const int aws_port = 8883;

WiFiClientSecure espClient;
espClient.setCACert(root_ca);
espClient.setCertificate(certificate);
espClient.setPrivateKey(private_key);

PubSubClient client(espClient);
client.setServer(aws_endpoint, aws_port);
```

**Topics:**
- Status: `taubenschiesser/{device-name}/status`
- Commands: `taubenschiesser/{device-name}/commands`
- Telemetry: `taubenschiesser/{device-name}/telemetry`
- Config: `taubenschiesser/{device-name}/config`

**MQTT in Dashboard:**
- AWS IoT benötigt **KEINE** MQTT-Konfiguration im Dashboard
- Backend nutzt automatisch AWS IoT wenn `AWS_IOT_ENDPOINT` gesetzt

---

## Troubleshooting

### Allgemein

**Port belegt:**
```bash
lsof -i :3000  # Welcher Prozess?
kill $(lsof -ti:3000)  # Beenden
```

**Docker Issues:**
```bash
docker system prune -a  # Aufräumen
docker-compose down -v  # Alles löschen (inkl. Daten!)
```

**MongoDB Verbindung (Host-System):**
```bash
# MongoDB Status prüfen
sudo systemctl status mongod

# MongoDB Logs
sudo journalctl -u mongod -f

# MongoDB Shell
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"

# Siehe MONGODB_CONFIG.md für Troubleshooting-Details
```

### Entwicklung

**Frontend lädt nicht:**
```bash
cd client
rm -rf node_modules package-lock.json
npm install
npm start
```

**API startet nicht:**
```bash
cd server
cat .env  # Prüfe Config
npm run dev  # Logs ansehen
```

**CV Service Fehler:**
```bash
cd cv-service
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

### Lokaler Server

**Container startet nicht:**
```bash
docker-compose -f docker-compose.prod.yml logs api
docker inspect taubenschiesser-api-prod
```

**Socket.io Fehler / "Verbindung zum Server konnte nicht hergestellt werden":**

**Ursache:** Frontend versucht sich mit `localhost:5001` zu verbinden, aber du greifst von anderem Gerät zu!

**Lösung:**
```bash
# 1. .env.prod prüfen
cat .env.prod | grep REACT_APP_API_URL

# Falls es "localhost" zeigt:
nano .env.prod

# Ändere zu:
# REACT_APP_API_URL=http://DEIN_HOSTNAME:5001
# ODER
# REACT_APP_API_URL=http://DEINE_IP:5001

# 2. WICHTIG: Frontend NEU BAUEN!
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 3. Im Browser: Seite neu laden (Ctrl+Shift+R)
```

**MongoDB-Verbindung fehlschlägt:**
```bash
# 1. Prüfe ob MongoDB läuft
sudo systemctl status mongod

# 2. Prüfe MongoDB Logs
sudo journalctl -u mongod -n 50

# 3. Teste Verbindung vom Host
mongosh "mongodb://admin:PASSWORT@localhost:27017/taubenschiesser?authSource=admin"

# 4. Prüfe ob MongoDB auf richtigem Interface lauscht
sudo netstat -tuln | grep 27017

# 5. Ausführliche Anleitung:
cat docs/MONGODB_CONFIG.md
```

**Nach Update nicht funktioniert:**
```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### AWS Cloud

**ECS Task startet nicht:**
```bash
aws logs tail /ecs/taubenschiesser-api --follow
aws ecs describe-tasks --cluster taubenschiesser-cluster --tasks TASK_ID
```

**IoT Verbindung fehlschlägt:**
```bash
# Endpoint prüfen
aws iot describe-endpoint --endpoint-type iot:Data-ATS

# Thing Status
aws iot describe-thing --thing-name mein-device

# Certificate Status
aws iot describe-certificate --certificate-id CERT_ID
```

**Database Connection:**
```bash
# Security Groups prüfen
aws ec2 describe-security-groups --filters "Name=tag:Name,Values=taubenschiesser-docdb-sg"
```

---

## Cheat Sheet

### Entwicklung
```bash
./dev-start.sh              # Starten
./dev-stop.sh               # Stoppen
docker-compose logs -f      # Logs
```

### Lokaler Server (Produktion)

**Updates von GitHub:**
```bash
./update-prod.sh            # Updates holen und deployen
```

**Deployment:**
```bash
./deploy-local.sh           # Erst-Installation / Neu-Deployment (wähle: 2)
```

**Manuell:**
```bash
# Updates holen und neu bauen
git pull
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Starten
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Logs
docker-compose -f docker-compose.prod.yml logs -f api

# Einzelnen Service neu starten
docker-compose -f docker-compose.prod.yml restart api

# Stoppen
docker-compose -f docker-compose.prod.yml down

# Health Check
curl http://localhost:5001/health
docker-compose -f docker-compose.prod.yml logs api | grep MongoDB
```

### AWS Cloud
```bash
cd aws/terraform
terraform apply                    # Deploy
terraform output iot_endpoint      # IoT Endpoint
terraform destroy                  # Teardown

aws ecs update-service --cluster taubenschiesser-cluster --service taubenschiesser-api --force-new-deployment
aws logs tail /ecs/taubenschiesser-api --follow
```

---

## Weiterführende Dokumentation

- **MongoDB Konfiguration**: Siehe [MONGODB_CONFIG.md](MONGODB_CONFIG.md) ⭐ NEU
- **AWS IoT Setup**: Siehe [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md)
- **MQTT Konfiguration**: Siehe [MQTT_SETUP.md](MQTT_SETUP.md)
- **Dashboard Guide**: Siehe [DASHBOARD_GUIDE.md](DASHBOARD_GUIDE.md)
- **Device Config**: Siehe [DEVICE_CONFIGURATION.md](DEVICE_CONFIGURATION.md)
- **Server ENV**: Siehe [../server/ENV_CONFIGURATION.md](../server/ENV_CONFIGURATION.md)

---

**Version**: 2.0  
**Letzte Aktualisierung**: Oktober 2024  
**Autor**: Fabian Bosch


