#!/bin/bash
# Setup script for .env configuration

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENV_FILE=".env"

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Taubenschiesser - Environment Setup            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  .env file already exists!${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted. Your existing .env was not changed."
        exit 0
    fi
fi

# Create .env file
cat > "$ENV_FILE" <<'EOF'
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

# ============================================
# Hinweise zum Umschalten:
# ============================================
# VON LOKAL → AWS IoT Core:
#   1. Kommentare (#) vor AWS_IOT_* Zeilen entfernen
#   2. Werte eintragen (von terraform output)
#   3. Server neu starten: npm run dev
#
# VON AWS IoT Core → LOKAL:
#   1. Kommentare (#) vor AWS_IOT_* Zeilen hinzufügen
#   2. Server neu starten: npm run dev
#   3. Im Dashboard: MQTT Settings konfigurieren
#
# Status prüfen:
#   curl http://localhost:5000/api/iot/status
# ============================================
EOF

echo -e "${GREEN}✅ .env file created successfully!${NC}"
echo ""
echo "📝 Configuration:"
echo "  - Mode: Development (local)"
echo "  - MQTT: Local Mosquitto (configure in Dashboard)"
echo "  - Database: Local MongoDB"
echo ""
echo -e "${YELLOW}🔧 Next steps:${NC}"
echo "  1. Review and adjust values in .env if needed"
echo "  2. Start MongoDB: docker-compose up -d mongodb"
echo "  3. Start Mosquitto: brew services start mosquitto"
echo "  4. Start server: npm run dev"
echo ""
echo -e "${YELLOW}📖 For AWS IoT Core:${NC}"
echo "  - See ENV_CONFIGURATION.md for details"
echo "  - Uncomment AWS_IOT_ENDPOINT after terraform deployment"
echo ""


