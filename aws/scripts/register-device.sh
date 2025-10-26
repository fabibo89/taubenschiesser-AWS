#!/bin/bash
# Script to register a new Taubenschiesser device with AWS IoT Core
# Usage: ./register-device.sh <device-name> [region]

set -e

# Configuration
DEVICE_NAME=$1
REGION=${2:-eu-central-1}
PROJECT_NAME="taubenschiesser"
POLICY_NAME="${PROJECT_NAME}-device-policy"
THING_TYPE="${PROJECT_NAME}-device"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if device name is provided
if [ -z "$DEVICE_NAME" ]; then
    echo -e "${RED}Error: Device name is required${NC}"
    echo "Usage: $0 <device-name> [region]"
    echo "Example: $0 terasse-west eu-central-1"
    exit 1
fi

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  AWS IoT Core - Device Registration             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Device Name:${NC} $DEVICE_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo -e "${YELLOW}Thing Type:${NC} $THING_TYPE"
echo ""

# Create directory for certificates
CERT_DIR="./certs/${DEVICE_NAME}"
mkdir -p "$CERT_DIR"

echo -e "${YELLOW}📝 Step 1: Creating IoT Thing...${NC}"
aws iot create-thing \
    --thing-name "$DEVICE_NAME" \
    --thing-type-name "$THING_TYPE" \
    --region "$REGION" \
    --attribute-payload "{\"attributes\":{\"project\":\"$PROJECT_NAME\"}}" \
    2>/dev/null || echo "Thing already exists, continuing..."

echo -e "${GREEN}✓ Thing created${NC}"
echo ""

echo -e "${YELLOW}📝 Step 2: Creating certificates and keys...${NC}"
CERT_OUTPUT=$(aws iot create-keys-and-certificate \
    --set-as-active \
    --region "$REGION" \
    --output json)

# Extract certificate details
CERT_ARN=$(echo $CERT_OUTPUT | jq -r '.certificateArn')
CERT_ID=$(echo $CERT_OUTPUT | jq -r '.certificateId')
CERT_PEM=$(echo $CERT_OUTPUT | jq -r '.certificatePem')
PRIVATE_KEY=$(echo $CERT_OUTPUT | jq -r '.keyPair.PrivateKey')
PUBLIC_KEY=$(echo $CERT_OUTPUT | jq -r '.keyPair.PublicKey')

# Save certificates to files
echo "$CERT_PEM" > "$CERT_DIR/certificate.pem.crt"
echo "$PRIVATE_KEY" > "$CERT_DIR/private.pem.key"
echo "$PUBLIC_KEY" > "$CERT_DIR/public.pem.key"

# Download Amazon Root CA
curl -s https://www.amazontrust.com/repository/AmazonRootCA1.pem -o "$CERT_DIR/AmazonRootCA1.pem"

echo -e "${GREEN}✓ Certificates created and saved to $CERT_DIR${NC}"
echo ""

echo -e "${YELLOW}📝 Step 3: Attaching policy to certificate...${NC}"
aws iot attach-policy \
    --policy-name "$POLICY_NAME" \
    --target "$CERT_ARN" \
    --region "$REGION"

echo -e "${GREEN}✓ Policy attached${NC}"
echo ""

echo -e "${YELLOW}📝 Step 4: Attaching certificate to thing...${NC}"
aws iot attach-thing-principal \
    --thing-name "$DEVICE_NAME" \
    --principal "$CERT_ARN" \
    --region "$REGION"

echo -e "${GREEN}✓ Certificate attached to thing${NC}"
echo ""

# Get IoT endpoint
IOT_ENDPOINT=$(aws iot describe-endpoint \
    --endpoint-type iot:Data-ATS \
    --region "$REGION" \
    --output text)

# Create device configuration file
cat > "$CERT_DIR/device-config.json" <<EOF
{
  "deviceName": "$DEVICE_NAME",
  "region": "$REGION",
  "iotEndpoint": "$IOT_ENDPOINT",
  "certificateId": "$CERT_ID",
  "certificateArn": "$CERT_ARN",
  "thingType": "$THING_TYPE",
  "topics": {
    "status": "taubenschiesser/$DEVICE_NAME/status",
    "telemetry": "taubenschiesser/$DEVICE_NAME/telemetry",
    "commands": "taubenschiesser/$DEVICE_NAME/commands",
    "config": "taubenschiesser/$DEVICE_NAME/config"
  },
  "files": {
    "certificate": "certificate.pem.crt",
    "privateKey": "private.pem.key",
    "rootCA": "AmazonRootCA1.pem"
  }
}
EOF

echo -e "${GREEN}✓ Configuration file created${NC}"
echo ""

# Create README for the device
cat > "$CERT_DIR/README.md" <<EOF
# Taubenschiesser Device: $DEVICE_NAME

## Device Information
- **Device Name**: $DEVICE_NAME
- **Region**: $REGION
- **IoT Endpoint**: $IOT_ENDPOINT
- **Certificate ID**: $CERT_ID

## MQTT Topics
- **Status**: \`taubenschiesser/$DEVICE_NAME/status\`
- **Telemetry**: \`taubenschiesser/$DEVICE_NAME/telemetry\`
- **Commands**: \`taubenschiesser/$DEVICE_NAME/commands\` (subscribe)
- **Config**: \`taubenschiesser/$DEVICE_NAME/config\` (subscribe)

## Files in this directory
- \`certificate.pem.crt\` - Device certificate
- \`private.pem.key\` - Private key (⚠️ KEEP SECRET!)
- \`public.pem.key\` - Public key
- \`AmazonRootCA1.pem\` - Amazon Root CA certificate
- \`device-config.json\` - Device configuration

## Testing the Connection

### Using mosquitto_pub/sub
\`\`\`bash
# Subscribe to commands (in one terminal)
mosquitto_sub \\
  --cafile AmazonRootCA1.pem \\
  --cert certificate.pem.crt \\
  --key private.pem.key \\
  -h $IOT_ENDPOINT \\
  -p 8883 \\
  -t "taubenschiesser/$DEVICE_NAME/commands" \\
  -i $DEVICE_NAME

# Publish status (in another terminal)
mosquitto_pub \\
  --cafile AmazonRootCA1.pem \\
  --cert certificate.pem.crt \\
  --key private.pem.key \\
  -h $IOT_ENDPOINT \\
  -p 8883 \\
  -t "taubenschiesser/$DEVICE_NAME/status" \\
  -i $DEVICE_NAME \\
  -m '{"status":"online","timestamp":"'"\$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
\`\`\`

## Security Notes
- ⚠️ **NEVER** share \`private.pem.key\`
- ⚠️ **NEVER** commit certificates to git
- Keep these files on the device only
- Rotate certificates regularly

## Deployment to ESP32

1. Copy the certificates to your ESP32:
   - \`certificate.pem.crt\`
   - \`private.pem.key\`
   - \`AmazonRootCA1.pem\`

2. Update your ESP32 code with:
   - IoT Endpoint: \`$IOT_ENDPOINT\`
   - Device Name: \`$DEVICE_NAME\`
   - Topics from above

3. Configure WiFi credentials

4. Flash and test!

## Deactivating/Deleting Device

To deactivate this device:
\`\`\`bash
# Deactivate certificate
aws iot update-certificate --certificate-id $CERT_ID --new-status INACTIVE --region $REGION

# To delete (requires detaching first)
aws iot detach-thing-principal --thing-name $DEVICE_NAME --principal $CERT_ARN --region $REGION
aws iot detach-policy --policy-name $POLICY_NAME --target $CERT_ARN --region $REGION
aws iot update-certificate --certificate-id $CERT_ID --new-status INACTIVE --region $REGION
aws iot delete-certificate --certificate-id $CERT_ID --region $REGION
aws iot delete-thing --thing-name $DEVICE_NAME --region $REGION
\`\`\`
EOF

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Registration Complete! ✅              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📁 Certificates saved to:${NC} $CERT_DIR"
echo -e "${YELLOW}🌐 IoT Endpoint:${NC} $IOT_ENDPOINT"
echo -e "${YELLOW}🔑 Certificate ID:${NC} $CERT_ID"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Copy certificates from $CERT_DIR to your device"
echo "2. Update device firmware with IoT endpoint and certificates"
echo "3. Test connection using mosquitto_pub/sub (see README.md)"
echo "4. Register device in Taubenschiesser Dashboard"
echo ""
echo -e "${RED}⚠️  IMPORTANT:${NC} Keep private.pem.key secure and never commit it to git!"
echo ""


