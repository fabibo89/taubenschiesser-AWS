#!/bin/bash
# Deployment Script für lokalen Server

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Taubenschiesser - Local Server Deployment      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env.prod exists
if [ ! -f ".env.prod" ]; then
    echo -e "${YELLOW}⚠️  .env.prod nicht gefunden!${NC}"
    echo ""
    echo "Möchtest du jetzt eine .env.prod Datei erstellen?"
    echo "Das Script wird dich durch die wichtigsten Einstellungen führen."
    echo ""
    read -p "Jetzt erstellen? (j/n): " CREATE_ENV
    
    if [ "$CREATE_ENV" = "j" ] || [ "$CREATE_ENV" = "J" ]; then
        echo ""
        echo -e "${GREEN}📝 Erstelle .env.prod...${NC}"
        echo ""
        
        # MongoDB URI
        echo -e "${YELLOW}MongoDB Konfiguration:${NC}"
        echo "Die MongoDB läuft auf deinem Host-System (nicht in Docker)"
        echo ""
        read -p "MongoDB Host [host.docker.internal]: " MONGO_HOST
        MONGO_HOST=${MONGO_HOST:-host.docker.internal}
        
        read -p "MongoDB Port [27017]: " MONGO_PORT
        MONGO_PORT=${MONGO_PORT:-27017}
        
        read -p "MongoDB Username [admin]: " MONGO_USER
        MONGO_USER=${MONGO_USER:-admin}
        
        read -sp "MongoDB Passwort: " MONGO_PASS
        echo ""
        
        read -p "MongoDB Datenbank [taubenschiesser]: " MONGO_DB
        MONGO_DB=${MONGO_DB:-taubenschiesser}
        
        MONGODB_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}?authSource=admin"
        
        echo ""
        echo -e "${YELLOW}Sicherheit:${NC}"
        echo "Generiere JWT Secret..."
        JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "BITTE-AENDERN-$(date +%s)")
        echo -e "${GREEN}✓ JWT Secret generiert${NC}"
        
        echo ""
        echo -e "${YELLOW}Server-Konfiguration:${NC}"
        read -p "Server IP-Adresse [localhost]: " SERVER_IP
        SERVER_IP=${SERVER_IP:-localhost}
        
        CLIENT_URL="http://${SERVER_IP}:3000"
        REACT_APP_API_URL="http://${SERVER_IP}:5001"
        
        # Create .env.prod
        cat > .env.prod << EOF
# Taubenschiesser - Produktions-Konfiguration
# Erstellt am: $(date)

# MongoDB Konfiguration (Host-System)
MONGODB_URI=${MONGODB_URI}

# Sicherheit
JWT_SECRET=${JWT_SECRET}

# URLs & Ports
CLIENT_URL=${CLIENT_URL}
REACT_APP_API_URL=${REACT_APP_API_URL}

# Computer Vision
CV_SERVICE=yolov8
MODEL_PATH=/app/models/yolov8l.onnx
CLASSES_PATH=/app/models/yolov8l.json
YOLO_CONFIDENCE=0.25
YOLO_IOU=0.45

# AWS IoT (Optional - auskommentiert lassen für lokales MQTT)
# AWS_IOT_ENDPOINT=
# AWS_REGION=eu-central-1
EOF
        
        echo ""
        echo -e "${GREEN}✅ .env.prod erfolgreich erstellt!${NC}"
        echo ""
        echo -e "${YELLOW}📝 Gespeicherte Einstellungen:${NC}"
        echo "  MongoDB: ${MONGO_HOST}:${MONGO_PORT}"
        echo "  Datenbank: ${MONGO_DB}"
        echo "  Frontend: ${CLIENT_URL}"
        echo "  API: ${REACT_APP_API_URL}"
        echo ""
        echo "Du kannst die Datei später bearbeiten mit: nano .env.prod"
        echo ""
        read -p "Drücke Enter um fortzufahren..."
    else
        echo ""
        echo -e "${RED}❌ Deployment abgebrochen.${NC}"
        echo ""
        echo "Bitte erstelle die Konfiguration manuell:"
        echo "  cp docs/env.prod.template .env.prod"
        echo "  nano .env.prod"
        echo ""
        echo "📖 Siehe docs/QUICKSTART_MONGODB.md für Details"
        echo ""
        exit 1
    fi
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker läuft nicht!${NC}"
    echo "Bitte starte Docker Desktop oder den Docker Daemon."
    exit 1
fi

echo -e "${YELLOW}📋 Deployment-Modus:${NC}"
echo "1) Entwicklung (docker-compose.yml)"
echo "2) Produktion (docker-compose.prod.yml)"
echo ""
read -p "Wähle (1 oder 2): " MODE

if [ "$MODE" = "1" ]; then
    COMPOSE_FILE="docker-compose.yml"
    ENV_FILE=""
    echo -e "${GREEN}✓ Entwicklungs-Modus${NC}"
    echo "  → MongoDB läuft im Docker-Container"
elif [ "$MODE" = "2" ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    ENV_FILE="--env-file .env.prod"
    echo -e "${GREEN}✓ Produktions-Modus${NC}"
    echo "  → MongoDB läuft auf dem Host-System"
    echo ""
    
    # Check if MongoDB is running on host
    echo -e "${YELLOW}🔍 Prüfe MongoDB...${NC}"
    if command -v mongosh &> /dev/null; then
        if pgrep -x "mongod" > /dev/null; then
            echo -e "${GREEN}✓ MongoDB läuft${NC}"
        else
            echo -e "${YELLOW}⚠️  MongoDB scheint nicht zu laufen${NC}"
            echo "Starte MongoDB mit: sudo systemctl start mongod"
            read -p "Trotzdem fortfahren? (j/n): " CONTINUE
            if [ "$CONTINUE" != "j" ]; then
                exit 1
            fi
        fi
    else
        echo -e "${YELLOW}⚠️  mongosh nicht gefunden - kann MongoDB-Status nicht prüfen${NC}"
        echo "Stelle sicher, dass MongoDB auf dem Host läuft!"
    fi
else
    echo -e "${RED}❌ Ungültige Auswahl${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}🔨 Baue Docker Images...${NC}"
docker-compose -f $COMPOSE_FILE $ENV_FILE build

echo ""
echo -e "${YELLOW}🚀 Starte Services...${NC}"
docker-compose -f $COMPOSE_FILE $ENV_FILE up -d

echo ""
echo -e "${YELLOW}⏳ Warte auf Services...${NC}"
sleep 5

echo ""
echo -e "${GREEN}✅ Deployment abgeschlossen!${NC}"
echo ""
echo -e "${YELLOW}📊 Service Status:${NC}"
docker-compose -f $COMPOSE_FILE ps

echo ""
echo -e "${YELLOW}🌐 URLs:${NC}"
echo "  Frontend: http://localhost:3000"
echo "  API:      http://localhost:5001"
echo "  CV:       http://localhost:8000"
echo ""
echo -e "${YELLOW}📝 Nächste Schritte:${NC}"

if [ "$MODE" = "2" ]; then
    echo "1. Prüfe Verbindung:"
    echo "   curl http://localhost:5001/health"
    echo "   → Erwartete Ausgabe: {\"status\":\"OK\"}"
    echo ""
    echo "2. Prüfe MongoDB-Verbindung in API-Logs:"
    echo "   docker-compose -f $COMPOSE_FILE logs api | grep MongoDB"
    echo "   → Erwartete Ausgabe: \"MongoDB Connected: host.docker.internal\""
    echo ""
    echo "3. Erstelle einen User:"
    echo "   docker exec -it taubenschiesser-api-prod /bin/sh"
    echo "   node create_user.js"
    echo "   exit"
    echo ""
    echo "4. Öffne http://localhost:3000 im Browser"
    echo ""
    echo "5. Konfiguriere MQTT im Dashboard:"
    echo "   → Profil → Einstellungen → MQTT"
    echo "   → Server-Profil: custom"
    echo "   → Broker: 192.168.1.x (dein Mosquitto)"
    echo "   → Port: 1883"
    echo "   → MQTT-Verbindung testen"
    echo "   → Einstellungen speichern"
else
    echo "1. Öffne http://localhost:3000 im Browser"
    echo "2. Erstelle einen User:"
    echo "   docker exec -it taubenschiesser-api /bin/sh"
    echo "   node create_user.js"
    echo "   exit"
    echo "3. Login im Dashboard"
    echo "4. Konfiguriere MQTT: Profil → Einstellungen"
    echo "   Broker: 192.168.1.x (dein Mosquitto)"
    echo "   Port: 1883"
fi

echo ""
echo -e "${YELLOW}🔧 Verwaltung:${NC}"
echo "  Logs ansehen:        docker-compose -f $COMPOSE_FILE logs -f"
echo "  API Logs:            docker-compose -f $COMPOSE_FILE logs -f api"
echo "  Services neu starten: docker-compose -f $COMPOSE_FILE restart"
echo "  Stoppen:             docker-compose -f $COMPOSE_FILE down"

if [ "$MODE" = "2" ]; then
    echo ""
    echo -e "${YELLOW}📚 Dokumentation:${NC}"
    echo "  MongoDB Setup:       docs/MONGODB_CONFIG.md"
    echo "  MQTT Setup:          docs/MQTT_SETUP.md"
    echo "  Deployment Guide:    docs/DEPLOYMENT_GUIDE.md"
fi

echo ""


