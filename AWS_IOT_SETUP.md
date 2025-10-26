# AWS IoT Core Setup für Taubenschiesser

## Übersicht

Dieses Dokument beschreibt die AWS IoT Core Integration für das Taubenschiesser-Projekt. AWS IoT Core ersetzt den lokalen Mosquitto MQTT-Broker und bietet eine skalierbare, sichere Cloud-Lösung für die Gerätekommunikation.

## Architektur

```
┌─────────────────┐
│   ESP32 Device  │
│ (Taubenschiesser)│
└────────┬────────┘
         │ MQTT/TLS (Port 8883)
         │ X.509 Certificates
         ▼
┌─────────────────────────┐
│    AWS IoT Core         │
│  - Device Registry      │
│  - MQTT Broker          │
│  - Rules Engine         │
└────────┬────────────────┘
         │
         │ HTTP Rules
         ▼
┌─────────────────────────┐
│   Backend API (ECS)     │
│  - Device Management    │
│  - User Management      │
│  - CV Integration       │
└─────────────────────────┘
```

## Terraform-Ressourcen

Die Terraform-Konfiguration erstellt automatisch:

### 1. IoT Thing Type
- **Name**: `taubenschiesser-device`
- **Zweck**: Template für alle Taubenschiesser-Geräte
- **Attribute**: deviceId, location, version

### 2. IoT Policy
- **Name**: `taubenschiesser-device-policy`
- **Berechtigungen**:
  - `iot:Connect` - MQTT-Verbindung aufbauen
  - `iot:Publish` - Status und Telemetrie senden
  - `iot:Subscribe` - Commands und Config empfangen
  - `iot:Receive` - Nachrichten empfangen
  - `iot:UpdateThingShadow` - Device Shadow aktualisieren
  - `iot:GetThingShadow` - Device Shadow abrufen

### 3. IoT Topic Rules
- **device_status**: Leitet Status-Updates an Backend API weiter
- **device_telemetry**: Leitet Telemetrie-Daten an Backend API weiter

### 4. CloudWatch Logs
- **Log Group**: `/aws/iot/taubenschiesser`
- **Retention**: 7 Tage
- **Zweck**: Fehler-Logging für IoT Rules

### 5. IAM Roles
- **iot-rule-role**: Für Rules Engine (CloudWatch Logs)
- **ecs-task-role**: Für Backend API (IoT Core Zugriff)

## MQTT Topics

### Topic-Struktur

```
taubenschiesser/{device-name}/{topic-type}
```

### Für Geräte (Publish)

| Topic | Zweck | Beispiel Payload |
|-------|-------|------------------|
| `taubenschiesser/{device-name}/status` | Status-Updates | `{"status":"online","lastSeen":"2024-01-01T12:00:00Z"}` |
| `taubenschiesser/{device-name}/telemetry` | Position & Hardware-Daten | `{"position":{"rotation":90,"tilt":45},"firmware":"1.0.0"}` |

### Für Geräte (Subscribe)

| Topic | Zweck | Beispiel Payload |
|-------|-------|------------------|
| `taubenschiesser/{device-name}/commands` | Steuerungsbefehle | `{"action":"move","pan":90,"tilt":45}` |
| `taubenschiesser/{device-name}/config` | Konfiguration | `{"interval":60,"sensitivity":0.8}` |

## Device Shadow

AWS IoT Core bietet Device Shadows für Offline-Geräte:

```json
{
  "state": {
    "reported": {
      "status": "online",
      "position": {
        "pan": 90,
        "tilt": 45
      },
      "battery": 85,
      "firmware": "1.2.3"
    },
    "desired": {
      "position": {
        "pan": 120,
        "tilt": 30
      }
    }
  }
}
```

## Gerät registrieren

### Option 1: Mit Script (Empfohlen)

```bash
cd aws/scripts
chmod +x register-device.sh
./register-device.sh mein-device eu-central-1
```

Das Script:
1. Erstellt IoT Thing in AWS
2. Generiert X.509 Zertifikate
3. Erstellt und verknüpft Policy
4. Lädt Root CA herunter
5. Erstellt Konfigurationsdatei
6. Speichert alles in `./certs/mein-device/`

### Option 2: Manuell (AWS Console)

1. **AWS Console öffnen** → IoT Core
2. **Thing erstellen**:
   - Manage → Things → Create
   - Thing Type: `taubenschiesser-device`
   - Thing Name: z.B. `terasse-west`
3. **Zertifikat erstellen**:
   - Auto-generate Certificate
   - Alle 3 Dateien downloaden (Certificate, Private Key, Root CA)
4. **Policy anhängen**:
   - Policy: `taubenschiesser-device-policy`
   - An Zertifikat anhängen
5. **Zertifikat aktivieren**

## ESP32 Integration

### Bibliotheken

Benötigte Arduino/PlatformIO Libraries:
```ini
lib_deps =
    PubSubClient
    WiFiClientSecure
```

### Code-Beispiel

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// AWS IoT Configuration
const char* aws_iot_endpoint = "xxxxx-ats.iot.eu-central-1.amazonaws.com";
const char* device_name = "terasse-west";

// WiFi
const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";

// Topics
const char* topic_status = "taubenschiesser/terasse-west/status";
const char* topic_commands = "taubenschiesser/terasse-west/commands";

// Certificates (paste from files)
const char* root_ca = R"EOF(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)EOF";

const char* certificate = R"EOF(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)EOF";

const char* private_key = R"EOF(
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
)EOF";

WiFiClientSecure net;
PubSubClient client(net);

void messageHandler(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message on topic: ");
  Serial.println(topic);
  
  // Parse command
  // ...
}

void connectAWS() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  Serial.println("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  // Configure WiFiClientSecure with certificates
  net.setCACert(root_ca);
  net.setCertificate(certificate);
  net.setPrivateKey(private_key);
  
  // Connect to AWS IoT
  client.setServer(aws_iot_endpoint, 8883);
  client.setCallback(messageHandler);
  
  Serial.println("Connecting to AWS IoT");
  while (!client.connect(device_name)) {
    Serial.print(".");
    delay(1000);
  }
  
  if (!client.connected()) {
    Serial.println("AWS IoT Timeout!");
    return;
  }
  
  // Subscribe to commands
  client.subscribe(topic_commands);
  Serial.println("AWS IoT Connected!");
}

void publishStatus() {
  String payload = "{\"status\":\"online\",\"battery\":85}";
  client.publish(topic_status, payload.c_str());
}

void setup() {
  Serial.begin(115200);
  connectAWS();
}

void loop() {
  client.loop();
  
  // Publish status every 60 seconds
  static unsigned long lastPublish = 0;
  if (millis() - lastPublish > 60000) {
    publishStatus();
    lastPublish = millis();
  }
}
```

## Testing

### Mit mosquitto_pub/sub

```bash
# Get IoT Endpoint
ENDPOINT=$(terraform output -raw iot_endpoint)

# Publish Status
mosquitto_pub \
  --cafile certs/terasse-west/AmazonRootCA1.pem \
  --cert certs/terasse-west/certificate.pem.crt \
  --key certs/terasse-west/private.pem.key \
  -h $ENDPOINT \
  -p 8883 \
  -t "taubenschiesser/terasse-west/status" \
  -i terasse-west \
  -m '{"status":"online","battery":85}'

# Subscribe to Commands
mosquitto_sub \
  --cafile certs/terasse-west/AmazonRootCA1.pem \
  --cert certs/terasse-west/certificate.pem.crt \
  --key certs/terasse-west/private.pem.key \
  -h $ENDPOINT \
  -p 8883 \
  -t "taubenschiesser/terasse-west/commands" \
  -i terasse-west
```

### Mit AWS IoT Test Client

1. AWS Console → IoT Core → Test
2. Subscribe to topic: `taubenschiesser/+/status`
3. Publish to topic: `taubenschiesser/terasse-west/commands`

## Monitoring

### CloudWatch Logs

```bash
# View IoT Logs
aws logs tail /aws/iot/taubenschiesser --follow

# View API Logs
aws logs tail /ecs/taubenschiesser-api --follow
```

### IoT Core Metrics

AWS Console → IoT Core → Metrics:
- **Connect.Success/Failure**: Verbindungen
- **PublishIn.Success/Failure**: Eingehende Messages
- **PublishOut.Success/Failure**: Ausgehende Messages
- **RuleMessageThrottled**: Throttled Rules

## Kosten

Bei 10 Geräten mit je 1 Message/Minute:

| Service | Menge/Monat | Kosten |
|---------|-------------|--------|
| Connectivity | 10 Geräte | $0.08 |
| Messages | ~432,000 | $0.35 |
| Rules Actions | ~43,200 | $0.06 |
| **Total** | | **~$0.50/Monat** |

Bei 100 Geräten: ~$5/Monat

## Sicherheit

### Best Practices

1. **Zertifikate**:
   - Private Keys nie committen
   - Regelmäßig rotieren (alle 6-12 Monate)
   - Sichere Speicherung auf Geräten

2. **Policies**:
   - Least-Privilege Prinzip
   - Topic-Filter nutzen (`taubenschiesser/+/status`)
   - Keine Wildcards (`*`) verwenden

3. **Network**:
   - Nur TLS (Port 8883)
   - X.509 Client-Zertifikate
   - Root CA validieren

4. **Monitoring**:
   - CloudWatch Alarms für Failures
   - Ungewöhnliche Aktivitäten überwachen
   - Failed-Connection-Alerts

### Zertifikat rotieren

```bash
# Neues Zertifikat erstellen
NEW_CERT=$(aws iot create-keys-and-certificate --set-as-active --output json)
NEW_CERT_ARN=$(echo $NEW_CERT | jq -r '.certificateArn')

# Policy anhängen
aws iot attach-policy --policy-name taubenschiesser-device-policy --target $NEW_CERT_ARN

# Thing anhängen
aws iot attach-thing-principal --thing-name terasse-west --principal $NEW_CERT_ARN

# Altes Zertifikat deaktivieren (nach Update auf Gerät)
aws iot update-certificate --certificate-id OLD_CERT_ID --new-status INACTIVE
```

## Troubleshooting

### Connection Failed

**Problem**: Gerät kann sich nicht verbinden

**Lösungen**:
- WiFi-Verbindung prüfen
- IoT Endpoint korrekt? (`aws iot describe-endpoint`)
- Zertifikate korrekt eingebunden?
- Zertifikat aktiviert in AWS?
- Policy am Zertifikat attached?

### Publish Failed

**Problem**: Messages werden nicht gesendet

**Lösungen**:
- Topic-Name korrekt?
- Policy erlaubt Publish auf Topic?
- Payload-Size < 128KB?
- Rate Limit erreicht? (100 msg/sec/device)

### Rules nicht ausgeführt

**Problem**: IoT Rules werden nicht getriggert

**Lösungen**:
- Rule aktiviert?
- SQL-Statement korrekt?
- CloudWatch Logs prüfen
- Error Action konfiguriert?

## Migration von lokalem Mosquitto

### Schritte

1. **Geräte in AWS registrieren** (siehe oben)
2. **Firmware aktualisieren** mit neuen Zertifikaten
3. **Backend-Code anpassen** (automatisch via ENV vars)
4. **Parallel-Betrieb** testen
5. **Lokalen Mosquitto abschalten**

### Code-Änderungen

Minimal - nur ENV vars anpassen:
```bash
# Von
MQTT_BROKER=localhost:1883

# Zu
AWS_IOT_ENDPOINT=xxxxx-ats.iot.eu-central-1.amazonaws.com:8883
AWS_REGION=eu-central-1
```

Backend erkennt AWS IoT automatisch.

## Support

Bei Fragen oder Problemen:
- AWS Documentation: https://docs.aws.amazon.com/iot/
- AWS Support (wenn Account vorhanden)
- GitHub Issues im Projekt

