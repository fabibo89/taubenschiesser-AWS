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
    echo -e "${RED}❌ .env.prod nicht gefunden!${NC}"
    echo ""
    echo "Bitte erstelle zuerst die Produktions-Konfiguration:"
    echo "  cp .env.prod.example .env.prod"
    echo "  nano .env.prod  # Passe die Werte an!"
    echo ""
    exit 1
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
elif [ "$MODE" = "2" ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    ENV_FILE="--env-file .env.prod"
    echo -e "${GREEN}✓ Produktions-Modus${NC}"
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
echo "1. Öffne http://localhost:3000 im Browser"
echo "2. Erstelle einen User: cd server && node create_user.js"
echo "3. Login im Dashboard"
echo "4. Konfiguriere MQTT: Profil → Einstellungen"
echo "   Broker: 192.168.1.x (dein Mosquitto)"
echo "   Port: 1883"
echo ""
echo -e "${YELLOW}🔧 Verwaltung:${NC}"
echo "  Logs ansehen:   docker-compose -f $COMPOSE_FILE logs -f"
echo "  Services neu starten: docker-compose -f $COMPOSE_FILE restart"
echo "  Stoppen:        docker-compose -f $COMPOSE_FILE down"
echo ""


