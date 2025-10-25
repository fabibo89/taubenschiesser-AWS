#!/usr/bin/env python3
"""
Beispiel-Script für die neue Geräte-Konfiguration
Zeigt, wie die API verwendet wird, um Geräte-Konfigurationen abzurufen
"""

import requests
import json
import cv2
from datetime import datetime

# API Base URL
API_BASE = 'http://localhost:3001/api'

def get_device_config(device_id):
    """
    Holt die Konfiguration für ein spezifisches Gerät
    """
    try:
        response = requests.get(f'{API_BASE}/devices/{device_id}/config')
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Fehler beim Abrufen der Geräte-Konfiguration: {response.status_code}")
            return None
    except Exception as e:
        print(f"Fehler bei der API-Anfrage: {e}")
        return None

def get_all_devices_config():
    """
    Holt die Konfiguration für alle aktiven Taubenschiesser-Geräte
    """
    try:
        response = requests.get(f'{API_BASE}/devices/config/all')
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Fehler beim Abrufen aller Geräte-Konfigurationen: {response.status_code}")
            return None
    except Exception as e:
        print(f"Fehler bei der API-Anfrage: {e}")
        return None

def create_taubenschiesser_device():
    """
    Beispiel: Erstellt ein neues Taubenschiesser-Gerät mit TP-Link Kamera
    """
    device_data = {
        "name": "Taubenschiesser Garten",
        "deviceId": "taubenschiesser_001",
        "type": "taubenschiesser",
        "location": {
            "name": "Garten",
            "coordinates": {
                "lat": 52.5200,
                "lng": 13.4050
            }
        },
        "taubenschiesser": {
            "ip": "192.168.1.100",
            "mqttPort": 1883
        },
        "camera": {
            "type": "tp-link",
            "tpLink": {
                "ip": "192.168.1.101",
                "username": "admin",
                "password": "password123",
                "stream": "stream1"
            }
        }
    }
    
    try:
        response = requests.post(f'{API_BASE}/devices', json=device_data)
        if response.status_code == 201:
            print("Gerät erfolgreich erstellt!")
            return response.json()
        else:
            print(f"Fehler beim Erstellen des Geräts: {response.status_code}")
            print(response.text)
            return None
    except Exception as e:
        print(f"Fehler bei der API-Anfrage: {e}")
        return None

def create_direct_rtsp_device():
    """
    Beispiel: Erstellt ein Taubenschiesser-Gerät mit direktem RTSP-Link
    """
    device_data = {
        "name": "Taubenschiesser Balkon",
        "deviceId": "taubenschiesser_002",
        "type": "taubenschiesser",
        "location": {
            "name": "Balkon",
            "coordinates": {
                "lat": 52.5200,
                "lng": 13.4050
            }
        },
        "taubenschiesser": {
            "ip": "192.168.1.102",
            "mqttPort": 1883
        },
        "camera": {
            "type": "direct-rtsp",
            "directUrl": "rtsp://admin:password@192.168.1.103:554/stream1"
        }
    }
    
    try:
        response = requests.post(f'{API_BASE}/devices', json=device_data)
        if response.status_code == 201:
            print("Gerät mit direktem RTSP-Link erfolgreich erstellt!")
            return response.json()
        else:
            print(f"Fehler beim Erstellen des Geräts: {response.status_code}")
            print(response.text)
            return None
    except Exception as e:
        print(f"Fehler bei der API-Anfrage: {e}")
        return None

def test_camera_connection(rtsp_url):
    """
    Testet die Verbindung zur Kamera
    """
    try:
        cap = cv2.VideoCapture(rtsp_url)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                print(f"✅ Kamera-Verbindung erfolgreich: {rtsp_url}")
                print(f"   Bildgröße: {frame.shape}")
                return True
            else:
                print(f"❌ Kamera-Verbindung fehlgeschlagen: {rtsp_url}")
                return False
        else:
            print(f"❌ Kamera-Verbindung fehlgeschlagen: {rtsp_url}")
            return False
    except Exception as e:
        print(f"❌ Fehler bei der Kamera-Verbindung: {e}")
        return False
    finally:
        if 'cap' in locals():
            cap.release()

def main():
    """
    Hauptfunktion - zeigt die Verwendung der neuen Geräte-Konfiguration
    """
    print("=== Taubenschiesser Geräte-Konfiguration Test ===\n")
    
    # 1. Alle Geräte-Konfigurationen abrufen
    print("1. Lade alle Geräte-Konfigurationen...")
    devices = get_all_devices_config()
    if devices:
        print(f"   Gefunden: {len(devices)} Geräte")
        for device in devices:
            print(f"   - {device['id']}: {device['ip']} -> {device['rtspUrl']}")
    else:
        print("   Keine Geräte gefunden")
    
    print("\n" + "="*50 + "\n")
    
    # 2. Beispiel-Geräte erstellen
    print("2. Erstelle Beispiel-Geräte...")
    
    # TP-Link Kamera Beispiel
    print("   Erstelle Taubenschiesser mit TP-Link Kamera...")
    tp_link_device = create_taubenschiesser_device()
    
    # Direkter RTSP-Link Beispiel
    print("   Erstelle Taubenschiesser mit direktem RTSP-Link...")
    direct_rtsp_device = create_direct_rtsp_device()
    
    print("\n" + "="*50 + "\n")
    
    # 3. Geräte-Konfigurationen testen
    print("3. Teste Geräte-Konfigurationen...")
    devices = get_all_devices_config()
    if devices:
        for device in devices:
            print(f"\n   Teste Gerät {device['id']}:")
            print(f"   - Taubenschiesser IP: {device['ip']}")
            print(f"   - RTSP URL: {device['rtspUrl']}")
            
            # Teste Kamera-Verbindung (nur wenn RTSP URL verfügbar)
            if device['rtspUrl']:
                test_camera_connection(device['rtspUrl'])
    
    print("\n" + "="*50 + "\n")
    print("Test abgeschlossen!")

if __name__ == "__main__":
    main()
