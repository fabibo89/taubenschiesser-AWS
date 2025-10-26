#!/bin/bash
# Update Script für Taubenschiesser Produktions-Deployment
# Holt Updates von GitHub und deployed sie automatisch

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Taubenschiesser - Production Update            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env.prod exists
if [ ! -f ".env.prod" ]; then
    echo -e "${RED}❌ .env.prod nicht gefunden!${NC}"
    echo "Dieses Script ist nur für bestehende Produktions-Installationen."
    echo "Für Erst-Installation nutze: ./deploy-local.sh"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker läuft nicht!${NC}"
    echo "Bitte starte Docker Desktop oder den Docker Daemon."
    exit 1
fi

echo -e "${BLUE}📋 Was wird gemacht:${NC}"
echo "1. Git Status prüfen"
echo "2. Updates von GitHub holen"
echo "3. Docker Images neu bauen"
echo "4. Services neu starten"
echo "5. Health Check"
echo ""
read -p "Fortfahren? (j/n): " CONFIRM

if [ "$CONFIRM" != "j" ] && [ "$CONFIRM" != "J" ]; then
    echo -e "${YELLOW}Abgebrochen.${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}📊 Aktueller Git Status:${NC}"
git status --short

echo ""
echo -e "${YELLOW}🔄 Hole Updates von GitHub...${NC}"

# Check for local changes (ignoriere .env Dateien - die sind in .gitignore)
CHANGES=$(git status --porcelain | grep -v "\.env" | grep -v "\.log" | grep -v "\.pid")

if [ ! -z "$CHANGES" ]; then
    echo -e "${YELLOW}⚠️  Du hast lokale Änderungen an Code-Dateien!${NC}"
    echo ""
    echo "$CHANGES"
    echo ""
    read -p "Änderungen verwerfen und Updates holen? (j/n): " DISCARD
    
    if [ "$DISCARD" = "j" ] || [ "$DISCARD" = "J" ]; then
        git reset --hard
        echo -e "${GREEN}✓ Lokale Änderungen verworfen${NC}"
    else
        echo -e "${YELLOW}Abgebrochen.${NC}"
        echo ""
        echo "Optionen:"
        echo "  1) Änderungen committen:  git add . && git commit -m 'meine Änderungen'"
        echo "  2) Änderungen stashen:    git stash"
        echo "  3) Dann nochmal starten:  ./update-prod.sh"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Keine lokalen Änderungen an Code-Dateien${NC}"
    echo "  (.env Dateien werden automatisch ignoriert)"
fi

# Pull latest changes
echo -e "${YELLOW}Pulling latest changes...${NC}"
git pull origin main || git pull origin master

echo ""
echo -e "${GREEN}✓ Updates erfolgreich geholt${NC}"

# Show what changed
echo ""
echo -e "${YELLOW}📝 Letzte Commits:${NC}"
git log --oneline -5

echo ""
echo -e "${YELLOW}🔨 Baue Docker Images neu...${NC}"
echo "Dies kann 2-5 Minuten dauern..."
echo ""

# Build all images
docker-compose -f docker-compose.prod.yml --env-file .env.prod build

echo ""
echo -e "${GREEN}✓ Docker Images erfolgreich gebaut${NC}"

echo ""
echo -e "${YELLOW}🔄 Starte Services neu...${NC}"

# Restart services
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo ""
echo -e "${YELLOW}⏳ Warte auf Services (30 Sekunden)...${NC}"
sleep 30

echo ""
echo -e "${GREEN}✅ Update abgeschlossen!${NC}"
echo ""

echo -e "${YELLOW}📊 Service Status:${NC}"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo -e "${YELLOW}🏥 Health Checks:${NC}"

# Health check API
if curl -s http://localhost:5001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} API:         http://localhost:5001 - OK"
else
    echo -e "${RED}✗${NC} API:         http://localhost:5001 - FEHLER"
fi

# Health check CV
if curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} CV-Service:  http://localhost:8000 - OK"
else
    echo -e "${RED}✗${NC} CV-Service:  http://localhost:8000 - FEHLER"
fi

# Health check Frontend
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Frontend:    http://localhost:3000 - OK"
else
    echo -e "${RED}✗${NC} Frontend:    http://localhost:3000 - FEHLER"
fi

echo ""
echo -e "${YELLOW}📝 MongoDB-Verbindung:${NC}"
docker-compose -f docker-compose.prod.yml logs api | grep "MongoDB Connected" | tail -1

echo ""
echo -e "${YELLOW}🔧 Nützliche Befehle:${NC}"
echo "  Logs ansehen:    docker-compose -f docker-compose.prod.yml logs -f"
echo "  Status prüfen:   docker-compose -f docker-compose.prod.yml ps"
echo "  Stoppen:         docker-compose -f docker-compose.prod.yml down"
echo ""

echo -e "${GREEN}🎉 Update erfolgreich abgeschlossen!${NC}"
echo ""

