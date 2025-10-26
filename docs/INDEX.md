# 📚 Dokumentations-Index

Übersicht aller Dokumentationsdateien und deren Verwendungszweck.

## 🎯 Wo fange ich an?

```
START HIER
    │
    ├─── Neu zum Projekt? ──────────> README.md
    │
    ├─── Development starten? ──────> DEPLOYMENT_GUIDE.md (Abschnitt 1)
    │
    ├─── Lokaler Server Setup? ────> QUICKSTART_MONGODB.md
    │                                  └─> MONGODB_CONFIG.md (bei Problemen)
    │
    ├─── AWS Cloud Deployment? ────> DEPLOYMENT_GUIDE.md (Abschnitt 3)
    │                                  └─> AWS_IOT_SETUP.md
    │
    ├─── ESP32 konfigurieren? ─────> DEVICE_CONFIGURATION.md
    │
    └─── Dashboard nutzen? ────────> DASHBOARD_GUIDE.md
```

## 📂 Dokumentations-Kategorien

### 🚀 Getting Started

| Datei | Zweck | Lesezeit |
|-------|-------|----------|
| [README.md](../README.md) | Projekt-Übersicht, Features, Quick Start | 5 min |
| [QUICKSTART_MONGODB.md](QUICKSTART_MONGODB.md) | Schnelleinstieg für lokales Produktions-Setup | 5 min |

### 📖 Deployment & Installation

| Datei | Zweck | Wann nutzen? |
|-------|-------|--------------|
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | **Hauptdokumentation** für alle Deployment-Szenarien | Immer beim Deployment lesen |
| [README-DEV.md](README-DEV.md) | Entwicklungsumgebung einrichten | Für lokale Entwicklung |
| [MONGODB_CONFIG.md](MONGODB_CONFIG.md) | MongoDB-Setup für lokalen Server | Bei Produktions-Setup mit Host-MongoDB |

### ⚙️ Konfiguration

| Datei | Zweck | Für wen? |
|-------|-------|----------|
| [DEVICE_CONFIGURATION.md](DEVICE_CONFIGURATION.md) | ESP32-Hardware konfigurieren | Hardware-Setup |
| [MQTT_SETUP.md](MQTT_SETUP.md) | MQTT-Broker einrichten | Lokales MQTT statt AWS IoT |
| [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md) | AWS IoT Core konfigurieren | Cloud-Deployment |
| [server/ENV_CONFIGURATION.md](../server/ENV_CONFIGURATION.md) | Environment-Variablen erklärt | Backend-Konfiguration |

### 🎮 Nutzung

| Datei | Zweck | Für wen? |
|-------|-------|----------|
| [DASHBOARD_GUIDE.md](DASHBOARD_GUIDE.md) | Dashboard-Funktionen nutzen | End-User |

### 📝 Templates & Changelog

| Datei | Zweck | Verwendung |
|-------|-------|------------|
| [env.prod.template](env.prod.template) | Template für Produktions-Config | `cp env.prod.template ../.env.prod` |
| [CHANGELOG_MONGODB.md](CHANGELOG_MONGODB.md) | MongoDB-Migration Dokumentation | Migration von Docker → Host MongoDB |
| [INDEX.md](INDEX.md) | Diese Datei - Dokumentations-Übersicht | Navigation |

## 🔍 Schnell-Referenz

### "Ich möchte..."

#### ...lokal entwickeln
1. [README.md](../README.md) - Quick Start
2. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 1

#### ...auf meinem Server deployen
1. [QUICKSTART_MONGODB.md](QUICKSTART_MONGODB.md) - 5-Min Start
2. [MONGODB_CONFIG.md](MONGODB_CONFIG.md) - Wenn Probleme auftreten
3. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 2 für Details

#### ...in der AWS Cloud deployen
1. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 3
2. [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md) - IoT Core einrichten

#### ...ein ESP32-Gerät hinzufügen
1. [DEVICE_CONFIGURATION.md](DEVICE_CONFIGURATION.md) - Hardware-Setup
2. [MQTT_SETUP.md](MQTT_SETUP.md) oder [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md) - Je nach Setup

#### ...MongoDB-Probleme lösen
1. [MONGODB_CONFIG.md](MONGODB_CONFIG.md) - Troubleshooting-Abschnitt
2. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Troubleshooting Lokaler Server

#### ...verstehen was geändert wurde
1. [CHANGELOG_MONGODB.md](CHANGELOG_MONGODB.md) - MongoDB-Migration Details

## 📊 Dokumentations-Hierarchie

```
../README.md (Einstieg)
│
├── DEPLOYMENT_GUIDE.md ⭐ HAUPT-DEPLOYMENT-DOK
│   │
│   ├── Entwicklung (Lokal)
│   │   └── README-DEV.md
│   │
│   ├── Lokaler Server (Produktion)
│   │   ├── QUICKSTART_MONGODB.md ⚡ SCHNELLSTART
│   │   ├── MONGODB_CONFIG.md 🔧 MONGODB-DETAILS
│   │   ├── env.prod.template
│   │   └── CHANGELOG_MONGODB.md
│   │
│   └── AWS Cloud (Produktion)
│       └── AWS_IOT_SETUP.md
│
├── DEVICE_CONFIGURATION.md (Hardware)
│   └── MQTT_SETUP.md (Lokales MQTT)
│       oder
│       AWS_IOT_SETUP.md (Cloud MQTT)
│
└── DASHBOARD_GUIDE.md (Nutzung)
```

## 🎓 Empfohlene Lesereihenfolge

### Für Entwickler (Erste Schritte)
1. ✅ [README.md](../README.md)
2. ✅ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 1 (Development)
3. ✅ [README-DEV.md](README-DEV.md)
4. ⚙️ [server/ENV_CONFIGURATION.md](../server/ENV_CONFIGURATION.md)

### Für Server-Administrator (Produktions-Setup)
1. ✅ [README.md](../README.md)
2. ✅ [QUICKSTART_MONGODB.md](QUICKSTART_MONGODB.md)
3. ✅ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 2
4. 🔧 [MONGODB_CONFIG.md](MONGODB_CONFIG.md)
5. ⚙️ [MQTT_SETUP.md](MQTT_SETUP.md)
6. 🎮 [DASHBOARD_GUIDE.md](DASHBOARD_GUIDE.md)

### Für AWS-Deployment
1. ✅ [README.md](../README.md)
2. ✅ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Abschnitt 3
3. ☁️ [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md)
4. 🎮 [DASHBOARD_GUIDE.md](DASHBOARD_GUIDE.md)

### Für Hardware-Setup
1. 🔧 [DEVICE_CONFIGURATION.md](DEVICE_CONFIGURATION.md)
2. ⚙️ [MQTT_SETUP.md](MQTT_SETUP.md) oder [AWS_IOT_SETUP.md](AWS_IOT_SETUP.md)

## 🔗 Externe Repositories

- **Hardware/Firmware**: [taubenschiesser-hardware](https://github.com/fabianbosch/taubenschiesser-hardware)
- **Legacy Backend**: [taubenschiesser-server](https://github.com/fabianbosch/taubenschiesser-server)

## 💡 Tipps

- 🔖 **Bookmark**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Die wichtigste Datei!
- ⚡ **Schnellstart**: [QUICKSTART_MONGODB.md](QUICKSTART_MONGODB.md) für lokales Setup
- 🆘 **Probleme?**: Jede Hauptdatei hat einen Troubleshooting-Abschnitt
- 📋 **Checklisten**: In [MONGODB_CONFIG.md](MONGODB_CONFIG.md) und [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

## 🔄 Letzte Aktualisierung

**Datum**: 26. Oktober 2024  
**Wichtigste Änderungen**:
- ✨ MongoDB-Konfiguration für lokalen Server (Host statt Docker)
- ✨ Neue Schnellstart-Dokumentation
- ✨ Dieser Dokumentations-Index

---

**Fragen?** Öffne ein Issue auf GitHub oder kontaktiere @fabianbosch

