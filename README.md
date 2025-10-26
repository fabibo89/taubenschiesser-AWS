# 🎯 Taubenschiesser Cloud Platform

Eine vollständige Cloud-Plattform zur Verwaltung von IoT-Hardware mit Computer Vision zur Vogelerkennung und -abwehr.

## 📋 Übersicht

Das Taubenschiesser System ist eine End-to-End-Lösung bestehend aus:
- **Hardware**: ESP32-basierte Geräte mit Kamera, Servos und Audio (siehe [Hardware-Repository](https://github.com/fabianbosch/taubenschiesser-hardware))
- **Cloud Platform**: Diese Repository - Web-Interface, API, Computer Vision und Device Management

## 🏗️ Architektur

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React     │────▶│  Node.js API │────▶│   MongoDB       │
│   Frontend  │     │  (Express)   │     │   Database      │
└─────────────┘     └──────────────┘     └─────────────────┘
                            │
                    ┌───────┴───────┐
                    ▼               ▼
            ┌──────────────┐  ┌────────────┐
            │  CV Service  │  │  Hardware  │
            │  (YOLOv8)    │  │  Monitor   │
            └──────────────┘  └────────────┘
                                     │
                                     ▼
                              ┌────────────┐
                              │ MQTT Broker│
                              │ (Mosquitto)│
                              └────────────┘
                                     │
                                     ▼
                              ┌────────────┐
                              │  ESP32     │
                              │  Devices   │
                              └────────────┘
```

## 🚀 Features

- 🎥 **Live Video Streaming** - Echtzeit-Kameraübertragung von ESP32-Geräten
- 🤖 **Computer Vision** - YOLOv8-basierte Vogelerkennung (ONNX)
- 🎮 **Remote Control** - Pan/Tilt-Steuerung, Audio-Wiedergabe
- 📊 **Analytics Dashboard** - Erkennungs-Statistiken und Device-Monitoring
- 🔐 **User Management** - JWT-basierte Authentifizierung
- 📱 **Responsive UI** - React mit Material-UI
- 🐳 **Docker Support** - Komplette Container-Orchestrierung
- ☁️ **AWS Ready** - Terraform-Konfiguration für Cloud-Deployment

## 📦 Services

| Service | Technologie | Port | Beschreibung |
|---------|------------|------|--------------|
| **Frontend** | React.js | 3000 | Web-Benutzeroberfläche |
| **API** | Node.js/Express | 5000 | RESTful Backend API |
| **CV Service** | FastAPI + ONNX | 8000 | Objekterkennung |
| **Hardware Monitor** | Python | - | Device-Status-Überwachung |
| **Database** | MongoDB | 27017 | Datenpersistierung |
| **MQTT Broker** | Eclipse Mosquitto | 1883 | IoT-Kommunikation |

## 🛠️ Schnellstart

### Voraussetzungen
- Node.js 18+
- Python 3.9+
- Docker & Docker Compose
- MongoDB

### Entwicklungsumgebung (einfach)

```bash
# Repository klonen
git clone https://github.com/yourusername/taubenschiesser_AWS.git
cd taubenschiesser_AWS

# Alle Services starten (automatisch)
./dev-start.sh
```

Das startet automatisch:
- ✅ MongoDB & MQTT Broker (Docker)
- ✅ Frontend auf http://localhost:3000
- ✅ Backend API auf http://localhost:5000
- ✅ CV Service auf http://localhost:8000

### Manuelles Setup

```bash
# Dependencies installieren
npm install
cd server && npm install
cd ../client && npm install
cd ../cv-service && pip install -r requirements.txt

# Environment-Variablen konfigurieren
cp client/.env.example client/.env
cp server/.env.example server/.env
# cv-service/.env wird automatisch durch setup-env.sh erstellt

# Services einzeln starten
npm run dev                    # Frontend + Backend
# oder
npm run client:dev            # Nur Frontend
npm run server:dev            # Nur Backend
python cv-service/app.py      # CV Service
```

### Docker Deployment (Production)

**Lokaler Server mit externer MongoDB:**

```bash
# 1. Stelle sicher, dass MongoDB auf dem Host läuft
sudo systemctl status mongod

# 2. Erstelle .env.prod Konfiguration
cp docs/env.prod.template .env.prod
nano .env.prod  # MONGODB_URI und Secrets anpassen

# 3. Container starten
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 4. Logs anzeigen
docker-compose -f docker-compose.prod.yml logs -f

# 5. Services stoppen
docker-compose -f docker-compose.prod.yml down
```

📖 **Vollständige Anleitung**: Siehe [docs/QUICKSTART_MONGODB.md](docs/QUICKSTART_MONGODB.md)

**Entwicklungs-Setup mit Docker-MongoDB:**

```bash
# Container bauen und starten (MongoDB im Container)
docker-compose up -d

# Logs anzeigen
docker-compose logs -f

# Services stoppen
docker-compose down
```

## 📁 Projektstruktur

```
taubenschiesser_AWS/
├── client/              # React Frontend
│   ├── src/
│   │   ├── components/  # UI-Komponenten
│   │   ├── context/     # React Context
│   │   ├── pages/       # Seiten
│   │   └── services/    # API-Services
│   └── public/
├── server/              # Node.js Backend
│   ├── routes/          # API-Endpunkte
│   ├── models/          # Mongoose-Modelle
│   ├── services/        # Business Logic
│   └── middleware/      # Auth, Error Handling
├── cv-service/          # Computer Vision Service
│   ├── app.py           # FastAPI App
│   └── yolov8/          # YOLO-Implementation
├── hardware-monitor/    # Device-Monitoring
│   └── main.py
├── aws/                 # Cloud-Deployment
│   └── terraform/       # Infrastructure as Code
└── models/              # ML-Modelle (.onnx)
```

## ⚙️ Konfiguration

### Environment-Variablen

**Client** (`client/.env`):
```env
REACT_APP_API_URL=http://localhost:5001
```

**Server** (`server/.env`):
```env
MONGODB_URI=mongodb://admin:password123@localhost:27017/taubenschiesser
JWT_SECRET=your-secret-key
CV_SERVICE_URL=http://localhost:8000
```

**CV Service** (`cv-service/.env`):
```env
MODEL_PATH=/app/models/yolov8l.onnx
YOLO_CONFIDENCE=0.25
```

## 🔧 API-Dokumentation

### Authentifizierung
```bash
POST /api/auth/register    # Benutzer registrieren
POST /api/auth/login       # Login
```

### Geräte
```bash
GET    /api/devices                # Alle Geräte
POST   /api/devices                # Gerät hinzufügen
PUT    /api/devices/:id            # Gerät aktualisieren
DELETE /api/devices/:id            # Gerät löschen
GET    /api/devices/:id/status     # Device-Status
POST   /api/devices/:id/control    # Servo-Steuerung
```

### Computer Vision
```bash
POST /api/cv/detect               # Objekt-Erkennung
GET  /api/cv/detections           # Erkennungs-Historie
```

## 🌐 AWS Deployment

```bash
cd aws/terraform

# Variablen konfigurieren
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars bearbeiten

# Infrastructure deployen
terraform init
terraform plan
terraform apply
```

Siehe [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) für Details.

## 📚 Weitere Dokumentation

📖 **Dokumentations-Übersicht**: Siehe [docs/INDEX.md](docs/INDEX.md) für eine komplette Übersicht aller Dokumente

### Deployment & Setup
- [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) - Vollständiger Deployment-Guide (Entwicklung, Lokal, AWS)
- [QUICKSTART_MONGODB.md](docs/QUICKSTART_MONGODB.md) - 5-Min Schnellstart für lokales Produktions-Setup
- [MONGODB_CONFIG.md](docs/MONGODB_CONFIG.md) - MongoDB-Konfiguration für lokalen Server
- [README-DEV.md](docs/README-DEV.md) - Entwickler-Guide

### Konfiguration & Guides
- [DEVICE_CONFIGURATION.md](docs/DEVICE_CONFIGURATION.md) - Hardware-Setup für ESP32-Geräte
- [MQTT_SETUP.md](docs/MQTT_SETUP.md) - MQTT-Broker Konfiguration
- [DASHBOARD_GUIDE.md](docs/DASHBOARD_GUIDE.md) - Dashboard-Nutzung
- [AWS_IOT_SETUP.md](docs/AWS_IOT_SETUP.md) - AWS IoT Core Setup

### Changelog & Templates
- [CHANGELOG_MONGODB.md](docs/CHANGELOG_MONGODB.md) - MongoDB Migration Changelog
- [env.prod.template](docs/env.prod.template) - Template für .env.prod Konfiguration

## 🧪 Testing

```bash
# Backend-Tests
cd server
npm test

# Python-Tests
cd cv-service
pytest

# Frontend-Tests
cd client
npm test
```

## 🤝 Contributing

1. Fork das Repository
2. Feature-Branch erstellen (`git checkout -b feature/AmazingFeature`)
3. Änderungen committen (`git commit -m 'Add some AmazingFeature'`)
4. Branch pushen (`git push origin feature/AmazingFeature`)
5. Pull Request öffnen

## 📝 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe [LICENSE](LICENSE) Datei für Details.

## 👤 Author

**Fabian Bosch**

## 🔗 Verwandte Repositories

- [taubenschiesser-hardware](https://github.com/fabianbosch/taubenschiesser-hardware) - ESP32 Firmware
- [taubenschiesser-server](https://github.com/fabianbosch/taubenschiesser-server) - Legacy Symfony Backend

## 📸 Screenshots

*Coming soon - Dashboard, Device Control, Analytics*

## 🐛 Bekannte Issues

Siehe [GitHub Issues](https://github.com/yourusername/taubenschiesser_AWS/issues)

## 📞 Support

Bei Fragen oder Problemen öffne bitte ein Issue auf GitHub.

---

**Made with ❤️ in Germany**
