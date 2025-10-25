# Taubenschiesser Cloud Platform - Deployment Guide

## Übersicht

Diese Anleitung erklärt, wie Sie die Taubenschiesser Cloud Platform auf AWS deployen.

## Voraussetzungen

### Lokale Entwicklung
- Node.js 18+
- Python 3.11+
- Docker & Docker Compose
- MongoDB (lokal oder Docker)

### AWS Deployment
- AWS CLI konfiguriert
- Terraform installiert
- Docker installiert
- AWS Account mit entsprechenden Berechtigungen

## Lokale Entwicklung

### 1. Repository klonen und Dependencies installieren

```bash
cd taubenschiesser-cursor
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
cd cv-service && pip install -r requirements.txt && cd ..
cd hardware-monitor && pip install -r requirements.txt && cd ..
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
# Bearbeiten Sie .env mit Ihren Werten
```

### 3. Lokale Services starten

```bash
# Alle Services mit Docker Compose
npm run docker:up

# Oder einzeln:
npm run server:dev  # Backend API
npm run client:dev  # Frontend
# CV Service und Hardware Monitor laufen in Docker
```

### 4. Datenbank initialisieren

```bash
# MongoDB wird automatisch mit Docker Compose gestartet
# Oder lokal: mongod
```

## AWS Deployment

### 1. AWS CLI konfigurieren

```bash
aws configure
# Geben Sie Ihre AWS Access Key ID, Secret Access Key und Region ein
```

### 2. Deployment-Skript ausführen

```bash
cd aws
chmod +x deploy.sh
./deploy.sh
```

Das Skript führt folgende Schritte aus:
- Erstellt ECR Repository
- Baut und pushed Docker Images
- Deployt Infrastructure mit Terraform
- Startet ECS Services

### 3. Manuelle Deployment-Schritte

Falls das automatische Skript nicht funktioniert:

#### ECR Repository erstellen
```bash
aws ecr create-repository --repository-name taubenschiesser --region eu-central-1
```

#### Docker Images bauen und pushen
```bash
# API Image
cd server
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:latest

# CV Service Image
cd ../cv-service
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest

# Frontend Image
cd ../client
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest
```

#### Infrastructure deployen
```bash
cd aws/terraform
terraform init
terraform plan
terraform apply
```

## Konfiguration

### Umgebungsvariablen

#### Backend (API)
- `NODE_ENV`: production
- `PORT`: 5000
- `MONGODB_URI`: MongoDB Connection String
- `JWT_SECRET`: JWT Secret Key
- `CLIENT_URL`: Frontend URL
- `CV_SERVICE_URL`: Computer Vision Service URL

#### Computer Vision Service
- `MODEL_PATH`: Pfad zum ONNX Modell
- `CLASSES_PATH`: Pfad zur Klassen-Definition

#### Hardware Monitor
- `API_URL`: Backend API URL
- `MQTT_BROKER`: MQTT Broker URL

### AWS Services

#### ECS (Elastic Container Service)
- **Cluster**: taubenschiesser-cluster
- **Services**: 
  - API Service (Port 5000)
  - CV Service (Port 8000)
  - Frontend Service (Port 80)

#### DocumentDB
- **Cluster**: taubenschiesser-docdb
- **Engine**: DocumentDB (MongoDB-kompatibel)
- **Backup**: 7 Tage Retention

#### Application Load Balancer
- **Frontend**: Port 80 → Frontend Service
- **API**: Port 80/api → API Service
- **Health Checks**: Konfiguriert für alle Services

## Hardware Integration

### 1. Geräte registrieren

1. Melden Sie sich in der Web-Oberfläche an
2. Gehen Sie zu "Geräte" → "Neues Gerät"
3. Geben Sie die Geräte-ID und RTSP-URL ein
4. Das Gerät wird automatisch überwacht

### 2. RTSP-Streaming konfigurieren

```bash
# Beispiel RTSP-URL
rtsp://username:password@192.168.1.100:554/stream1
```

### 3. MQTT-Kommunikation

```bash
# Hardware kann über MQTT Status senden
mosquitto_pub -h your-mqtt-broker -t "devices/DEVICE_ID/status" -m '{"status":"online"}'
```

## Monitoring und Wartung

### CloudWatch Logs
- API Logs: `/ecs/taubenschiesser-api`
- CV Service Logs: `/ecs/taubenschiesser-cv`
- Hardware Monitor Logs: `/ecs/taubenschiesser-hardware-monitor`

### ECS Service Updates
```bash
# Service neu starten
aws ecs update-service --cluster taubenschiesser-cluster --service taubenschiesser-api --force-new-deployment
```

### Database Backup
```bash
# DocumentDB automatische Backups sind aktiviert
# Manuelle Snapshots:
aws docdb create-db-cluster-snapshot --db-cluster-identifier taubenschiesser-docdb --db-cluster-snapshot-identifier taubenschiesser-backup-$(date +%Y%m%d)
```

## Troubleshooting

### Häufige Probleme

#### 1. ECS Service startet nicht
- Prüfen Sie die CloudWatch Logs
- Überprüfen Sie die Task Definition
- Stellen Sie sicher, dass alle Umgebungsvariablen gesetzt sind

#### 2. Database Connection Fehler
- Überprüfen Sie die Security Groups
- Stellen Sie sicher, dass DocumentDB im privaten Subnet läuft
- Prüfen Sie die Connection String

#### 3. CV Service Fehler
- Überprüfen Sie, ob das ONNX-Modell verfügbar ist
- Prüfen Sie die Logs für Speicher-Probleme
- Stellen Sie sicher, dass genügend CPU/Memory zugewiesen ist

### Logs anzeigen
```bash
# ECS Service Logs
aws logs tail /ecs/taubenschiesser-api --follow

# DocumentDB Logs
aws logs describe-log-groups --log-group-name-prefix /aws/docdb
```

## Kosten-Optimierung

### ECS Fargate
- **API Service**: 0.5 vCPU, 1GB RAM
- **CV Service**: 1 vCPU, 2GB RAM (für ONNX-Inferenz)
- **Frontend**: 0.25 vCPU, 0.5GB RAM

### DocumentDB
- **Instance**: db.t3.medium (2 vCPU, 4GB RAM)
- **Storage**: 20GB GP2

### Load Balancer
- **Application Load Balancer**: ~$16/Monat
- **Data Processing**: $0.008/GB

## Sicherheit

### Best Practices
1. **JWT Secrets**: Verwenden Sie starke, zufällige Secrets
2. **Database**: Aktivieren Sie Encryption at Rest
3. **Network**: Verwenden Sie private Subnets für Database
4. **Access**: Implementieren Sie IAM-basierte Zugriffskontrolle
5. **Monitoring**: Aktivieren Sie CloudTrail für Audit-Logs

### SSL/TLS
- Konfigurieren Sie SSL-Zertifikate für den Load Balancer
- Verwenden Sie HTTPS für alle API-Calls
- Implementieren Sie HSTS Headers

## Skalierung

### Horizontal Scaling
```bash
# ECS Service skalieren
aws ecs update-service --cluster taubenschiesser-cluster --service taubenschiesser-api --desired-count 3
```

### Vertical Scaling
- Erhöhen Sie CPU/Memory in der Task Definition
- Skalieren Sie DocumentDB Instances

### Auto Scaling
- Konfigurieren Sie ECS Auto Scaling basierend auf CPU/Memory
- Implementieren Sie Application Load Balancer Target Group Scaling
