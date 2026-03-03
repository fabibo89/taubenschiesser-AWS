#!/bin/bash
# Setup script for .env configuration (Server + CV Service)

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the script directory (server/)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Get the project root directory
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

SERVER_ENV_FILE="$SCRIPT_DIR/.env"
CV_ENV_FILE="$PROJECT_ROOT/cv-service/.env"

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Taubenschiesser - Environment Setup            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Server .env already exists
SERVER_EXISTS=false
if [ -f "$SERVER_ENV_FILE" ]; then
    SERVER_EXISTS=true
fi

# Check if CV Service .env already exists
CV_EXISTS=false
if [ -f "$CV_ENV_FILE" ]; then
    CV_EXISTS=true
fi

if [ "$SERVER_EXISTS" = true ] || [ "$CV_EXISTS" = true ]; then
    echo -e "${YELLOW}⚠️  Existing .env files found:${NC}"
    [ "$SERVER_EXISTS" = true ] && echo "  - Server: $SERVER_ENV_FILE"
    [ "$CV_EXISTS" = true ] && echo "  - CV Service: $CV_ENV_FILE"
    echo ""
    read -p "Do you want to overwrite them? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted. Your existing .env files were not changed."
        exit 0
    fi
fi

echo -e "${BLUE}Creating Server .env file...${NC}"

# Create Server .env file
cat > "$SERVER_ENV_FILE" <<'EOF'
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

echo -e "${GREEN}✅ Server .env created successfully!${NC}"
echo ""

# ============================================
# Create CV Service .env file
# ============================================

echo -e "${BLUE}Creating CV Service .env file...${NC}"

cat > "$CV_ENV_FILE" <<EOF
# ============================================
# Taubenschiesser CV Service Configuration
# ============================================

# Service Selection
CV_SERVICE=yolo  # Options: 'yolo' or 'rekognition'

# ============================================
# YOLO Configuration (Default)
# ============================================
# Optimized for bird detection (YOLOv8 or YOLO26 ONNX)
# Relative path from cv-service directory
MODEL_PATH=../models/yolo26m.onnx
YOLO_CONFIDENCE=0.25  # Confidence threshold (0.0-1.0)
YOLO_IOU=0.45         # IoU threshold for NMS (0.0-1.0)

# ============================================
# AWS Rekognition Configuration (Optional)
# ============================================
# Only needed when CV_SERVICE=rekognition
# AWS_REGION=eu-central-1
# AWS_ACCESS_KEY_ID=your_access_key_here
# AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Alternative: AWS credentials can be set via:
# - AWS credentials file (~/.aws/credentials)
# - IAM roles (when running on AWS)
# - Environment variables

# ============================================
# Notes:
# ============================================
# For local development:
#   - Use YOLO (default), model from MODEL_PATH (e.g. yolo26m.onnx)
#   - Export ONNX with: python3 -c "from ultralytics import YOLO; YOLO('yolo26n.pt').export(format='onnx', opset=21)"
#
# For AWS deployment:
#   - Can use AWS Rekognition for serverless CV
#   - Set CV_SERVICE=rekognition and configure AWS credentials
# ============================================
EOF

echo -e "${GREEN}✅ CV Service .env created successfully!${NC}"
echo ""

# ============================================
# Summary
# ============================================

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup Complete!                                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "📝 Configuration created:"
echo "  ✅ Server: $SERVER_ENV_FILE"
echo "  ✅ CV Service: $CV_ENV_FILE"
echo ""
echo "🔧 Default settings:"
echo "  - Mode: Development (local)"
echo "  - MQTT: Local Mosquitto (configure in Dashboard)"
echo "  - Database: Local MongoDB"
echo "  - CV Service: YOLO (local)"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "  1. Review and adjust values if needed"
echo "  2. Start services:"
echo "     cd $PROJECT_ROOT"
echo "     ./dev-start.sh"
echo ""
echo -e "${YELLOW}📖 Additional resources:${NC}"
echo "  - Server config: $SCRIPT_DIR/ENV_CONFIGURATION.md"
echo "  - CV Service: Use YOLO (default) or AWS Rekognition"
echo "  - AWS IoT Core: Uncomment AWS_IOT_ENDPOINT after terraform deployment"
echo ""


