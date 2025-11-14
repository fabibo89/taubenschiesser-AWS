# Environment Configuration Guide

## Schnellstart

Kopiere diesen Inhalt in deine `server/.env` Datei:

```bash
# ============================================
# Taubenschiesser Server Configuration
# ============================================

# Environment
NODE_ENV=development
PORT=5000

# ============================================
# Database Configuration
# ============================================
# Lokal mit Docker:
MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin

# Für AWS DocumentDB (auskommentiert):
# MONGODB_URI=mongodb://admin:your-password@your-docdb-endpoint:27017/taubenschiesser?ssl=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false

# ============================================
# Authentication
# ============================================
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=30d  # optional, fallback sind 7 Tage

# ============================================
# Frontend & Services
# ============================================
CLIENT_URL=http://localhost:3000
CV_SERVICE_URL=http://localhost:8000

# ============================================
# MQTT Configuration
# ============================================
# Wähle EINE der beiden Optionen:

# --- Option 1: Lokales MQTT mit Mosquitto (AKTIV) ---
# Keine Konfiguration hier nötig!
# MQTT Settings werden über das Dashboard (Profil -> Einstellungen) konfiguriert
# Standard: localhost:1883

# --- Option 2: AWS IoT Core (INAKTIV - zum Aktivieren Kommentare entfernen) ---
# Nach Terraform Deployment diese Werte eintragen:
# AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com
# AWS_REGION=eu-central-1

# AWS Credentials (nur nötig wenn NICHT über IAM Role):
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=secret...
```

## Wie du die Werte bekommst

### AWS IoT Endpoint

Nach Terraform Deployment:
```bash
cd aws/terraform
terraform output -raw iot_endpoint
```

Oder mit AWS CLI:
```bash
aws iot describe-endpoint --endpoint-type iot:Data-ATS --region eu-central-1 --query 'endpointAddress' --output text
```

### AWS Credentials (optional)

Nur nötig wenn du NICHT in AWS ECS deployed bist (also lokal entwickelst mit AWS IoT):

1. AWS Console → IAM → Users → Dein User → Security Credentials
2. "Create access key" klicken
3. Access Key ID und Secret Key kopieren

**Besser:** Nutze AWS CLI Profile:
```bash
aws configure
# Dann brauchst du keine Credentials in .env
```

## Umschalten zwischen Lokal und AWS

### Von Lokal zu AWS IoT Core

1. `.env` bearbeiten:
```bash
# Diese Zeilen auskommentieren:
AWS_IOT_ENDPOINT=a1b2c3d4e5f6g7-ats.iot.eu-central-1.amazonaws.com
AWS_REGION=eu-central-1
```

2. Server neu starten:
```bash
npm run dev
```

3. Prüfen:
```bash
curl http://localhost:5000/api/iot/status
# Sollte zeigen: "enabled": true
```

### Von AWS IoT Core zu Lokal

1. `.env` bearbeiten:
```bash
# Diese Zeilen kommentieren:
# AWS_IOT_ENDPOINT=a1b2c3d4e5f6g7-ats.iot.eu-central-1.amazonaws.com
# AWS_REGION=eu-central-1
```

2. Server neu starten:
```bash
npm run dev
```

3. Im Dashboard MQTT konfigurieren:
   - Profil → Einstellungen
   - MQTT aktivieren
   - Broker: localhost
   - Port: 1883

4. Prüfen:
```bash
curl http://localhost:5000/api/iot/status
# Sollte zeigen: "enabled": false
```

## Status in Server-Logs

Beim Start siehst du:

**Bei lokalem MQTT:**
```
Hardware Helper initialized with local MQTT support
```

**Bei AWS IoT Core:**
```
Hardware Helper initialized with AWS IoT Core support
AWS IoT Core initialized with endpoint: xxxxx-ats.iot.eu-central-1.amazonaws.com
```

## Troubleshooting

### "AWS IoT is not enabled"

Problem: AWS_IOT_ENDPOINT nicht gesetzt oder falsch

Lösung:
```bash
# In .env prüfen:
AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com  # Keine Kommentare!
AWS_REGION=eu-central-1
```

### "MQTT connection failed"

Problem bei lokalem MQTT: Mosquitto läuft nicht

Lösung:
```bash
# Mosquitto starten
brew services start mosquitto

# Oder Docker
docker run -d -p 1883:1883 eclipse-mosquitto
```

### "Credentials not found"

Problem: AWS Credentials fehlen

Lösung:
```bash
# AWS CLI konfigurieren
aws configure

# Oder in .env eintragen:
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=secret...
```

## Best Practices

1. **Lokal entwickeln**: Nutze Mosquitto (schneller, einfacher)
2. **AWS testen**: Aktiviere AWS IoT Core zum Testen
3. **Produktion**: Nutze AWS IoT Core mit IAM Roles (keine Credentials in .env)
4. **Nie committen**: .env ist in .gitignore - gut so!
5. **Dokumentieren**: Schreibe deine aktuellen Werte irgendwo sicher auf

## Beispiel-Setup für verschiedene Szenarien

### Entwicklung lokal
```bash
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin
JWT_SECRET=dev-secret-key
CLIENT_URL=http://localhost:3000
CV_SERVICE_URL=http://localhost:8000
# Keine AWS Variablen
```

### Test mit AWS IoT (lokal)
```bash
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin
JWT_SECRET=dev-secret-key
CLIENT_URL=http://localhost:3000
CV_SERVICE_URL=http://localhost:8000
AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=secret...
```

### Produktion in AWS
```bash
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb://admin:password@docdb-endpoint:27017/taubenschiesser?ssl=true
JWT_SECRET=super-secure-production-key
CLIENT_URL=https://taubenschiesser.example.com
CV_SERVICE_URL=http://cv-service:8000
AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com
AWS_REGION=eu-central-1
# Keine Credentials - nutzt IAM Role von ECS Task
```


