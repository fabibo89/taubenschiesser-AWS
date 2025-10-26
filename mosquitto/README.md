# Mosquitto MQTT Broker - NICHT VERWENDET

Dieser Ordner enthielt ursprünglich die Konfiguration für einen Docker-basierten Mosquitto MQTT Broker.

## Aktueller Status: NICHT AKTIV ❌

Der Docker Mosquitto-Container wurde entfernt, da ein **externer Mosquitto-Server** verwendet wird.

## Konfiguration

MQTT wird konfiguriert über:
- **Dashboard**: Profil → Einstellungen → MQTT
- **Broker**: IP deines Mosquitto-Servers (z.B. 192.168.1.100)
- **Port**: 1883 (Standard)
- **Username/Password**: Optional

## Wenn du den Docker Mosquitto wieder nutzen willst

1. Entkommentiere in `docker-compose.yml`:
```yaml
mosquitto:
  image: eclipse-mosquitto:2.0
  container_name: taubenschiesser-mqtt
  ports:
    - "1883:1883"
    - "9001:9001"
  volumes:
    - ./mosquitto/config:/mosquitto/config
```

2. Starte den Service:
```bash
docker-compose up -d mosquitto
```

3. Im Dashboard als Broker eintragen: `localhost`

## Alternativen

### Lokal entwickeln
- Nutze deinen vorhandenen Mosquitto-Server in der Wohnung
- Konfiguriere die IP im Dashboard

### AWS Produktion
- Nutze AWS IoT Core (siehe AWS_IOT_SETUP.md)
- Keine lokale Mosquitto-Installation nötig


