# AWS Deployment für Taubenschiesser

## Übersicht

Diese Verzeichnis enthält alle AWS-spezifischen Konfigurationen und Scripts für das Taubenschiesser Cloud-Projekt.

## Struktur

```
aws/
├── terraform/           # Infrastructure as Code
│   ├── main.tf         # Hauptkonfiguration (VPC, ECS, ALB, DocumentDB)
│   ├── iot.tf          # AWS IoT Core Ressourcen
│   ├── variables.tf    # Terraform Variablen
│   └── outputs.tf      # Terraform Outputs (falls vorhanden)
│
├── scripts/            # Deployment und Utility Scripts
│   └── register-device.sh  # Device-Registrierung für IoT Core
│
└── deploy.sh          # Haupt-Deployment Script

```

## Schnellstart

### 1. AWS Credentials konfigurieren

```bash
aws configure
# Gib deine AWS Access Key ID und Secret Access Key ein
```

### 2. Terraform-Variablen setzen

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Bearbeite terraform.tfvars mit deinen Werten
```

Beispiel `terraform.tfvars`:
```hcl
aws_region = "eu-central-1"
project_name = "taubenschiesser"
jwt_secret = "your-super-secret-jwt-key"
docdb_password = "your-secure-database-password"
ecr_repository_url = "123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser"
```

### 3. Infrastructure deployen

```bash
terraform init
terraform plan
terraform apply
```

### 4. Docker Images bauen und pushen

```bash
# Login zu ECR
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.eu-central-1.amazonaws.com

# Backend API
cd ../server
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:api-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:api-latest

# CV Service
cd ../cv-service
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:cv-latest

# Frontend
cd ../client
docker build -t 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest .
docker push 123456789012.dkr.ecr.eu-central-1.amazonaws.com/taubenschiesser:frontend-latest
```

## AWS IoT Core

### Device registrieren

```bash
cd scripts
chmod +x register-device.sh
./register-device.sh mein-device eu-central-1
```

Das Script erstellt:
- IoT Thing in AWS
- X.509 Zertifikate
- Policy-Verknüpfungen
- Konfigurationsdateien in `./certs/mein-device/`

**⚠️ WICHTIG**: Die Zertifikate werden nur einmal angezeigt. Sichere sie sofort!

### MQTT Topics

Jedes Gerät nutzt folgende Topics:
- **Status**: `taubenschiesser/{device-name}/status`
- **Telemetry**: `taubenschiesser/{device-name}/telemetry`
- **Commands**: `taubenschiesser/{device-name}/commands` (Subscribe)
- **Config**: `taubenschiesser/{device-name}/config` (Subscribe)

### Device testen

```bash
# Status senden
mosquitto_pub \
  --cafile certs/mein-device/AmazonRootCA1.pem \
  --cert certs/mein-device/certificate.pem.crt \
  --key certs/mein-device/private.pem.key \
  -h $(terraform output -raw iot_endpoint) \
  -p 8883 \
  -t "taubenschiesser/mein-device/status" \
  -i mein-device \
  -m '{"status":"online","battery":85}'

# Commands empfangen
mosquitto_sub \
  --cafile certs/mein-device/AmazonRootCA1.pem \
  --cert certs/mein-device/certificate.pem.crt \
  --key certs/mein-device/private.pem.key \
  -h $(terraform output -raw iot_endpoint) \
  -p 8883 \
  -t "taubenschiesser/mein-device/commands" \
  -i mein-device
```

## Erstellte AWS Ressourcen

### Networking
- VPC mit Public und Private Subnets
- Internet Gateway
- NAT Gateway (optional, für Private Subnets)
- Security Groups

### Compute
- ECS Cluster (Fargate)
- ECS Services:
  - API Service (Backend)
  - CV Service (Computer Vision)
  - Frontend Service

### Database
- DocumentDB Cluster (MongoDB-kompatibel)
- Subnet Group
- Security Group

### Load Balancing
- Application Load Balancer
- Target Groups für Services
- Listener Rules

### IoT
- IoT Thing Type: `taubenschiesser-device`
- IoT Policy: `taubenschiesser-device-policy`
- IoT Topic Rules für Status und Telemetrie
- CloudWatch Log Group für IoT

### Monitoring
- CloudWatch Log Groups für alle Services
- Container Insights

## Terraform Outputs

Nach dem Deployment erhältst du folgende Outputs:

```bash
terraform output

# load_balancer_dns - URL deiner Application
# vpc_id - VPC ID
# cluster_name - ECS Cluster Name
# iot_endpoint - AWS IoT MQTT Endpoint
# iot_thing_type - IoT Thing Type Name
# iot_policy_name - IoT Policy Name
```

## Kosten-Schätzung

Monatliche Kosten (ca., abhängig von Region und Nutzung):

| Service | Konfiguration | Kosten/Monat |
|---------|---------------|--------------|
| ECS Fargate (API) | 0.5 vCPU, 1GB RAM | ~$15 |
| ECS Fargate (CV) | 1 vCPU, 2GB RAM | ~$30 |
| ECS Fargate (Frontend) | 0.25 vCPU, 0.5GB RAM | ~$8 |
| DocumentDB | db.t3.medium | ~$70 |
| Application Load Balancer | Standard | ~$16 |
| AWS IoT Core | 10 Geräte, 1 msg/min | ~$0.50 |
| CloudWatch Logs | 7 Tage Retention | ~$5 |
| **Total** | | **~$145/Monat** |

**Spar-Tipps**:
- Nutze Reserved Instances für DocumentDB (-40%)
- Reduziere Fargate Task Größen
- Verkürze Log Retention
- Nutze Savings Plans

## Troubleshooting

### ECS Tasks starten nicht

```bash
# Logs prüfen
aws logs tail /ecs/taubenschiesser-api --follow --region eu-central-1

# Task Details
aws ecs describe-tasks \
  --cluster taubenschiesser-cluster \
  --tasks $(aws ecs list-tasks --cluster taubenschiesser-cluster --query 'taskArns[0]' --output text) \
  --region eu-central-1
```

### Database Connection Fehler

```bash
# Security Groups prüfen
aws ec2 describe-security-groups \
  --filters "Name=tag:Name,Values=taubenschiesser-docdb-sg" \
  --region eu-central-1

# DocumentDB Status
aws docdb describe-db-clusters \
  --db-cluster-identifier taubenschiesser-docdb \
  --region eu-central-1
```

### IoT Connection Fehler

```bash
# IoT Endpoint prüfen
aws iot describe-endpoint --endpoint-type iot:Data-ATS --region eu-central-1

# Thing Status
aws iot describe-thing --thing-name mein-device --region eu-central-1

# Certificate Status
aws iot describe-certificate --certificate-id YOUR_CERT_ID --region eu-central-1
```

## Cleanup

**ACHTUNG**: Dies löscht alle Ressourcen!

```bash
cd terraform
terraform destroy
```

Optional: IoT Things manuell löschen:
```bash
# Liste alle Things
aws iot list-things --thing-type-name taubenschiesser-device

# Lösche Thing
aws iot delete-thing --thing-name mein-device
```

## Weitere Dokumentation

- [DEPLOYMENT.md](../DEPLOYMENT.md) - Detaillierte Deployment-Anleitung
- [AWS_IOT_SETUP.md](../AWS_IOT_SETUP.md) - AWS IoT Core Setup Guide
- [MQTT_SETUP.md](../MQTT_SETUP.md) - MQTT Konfiguration

## Support

Bei Fragen oder Problemen:
1. Check die Logs mit CloudWatch
2. Prüfe die Security Groups
3. Validiere IAM Permissions
4. Öffne ein GitHub Issue


