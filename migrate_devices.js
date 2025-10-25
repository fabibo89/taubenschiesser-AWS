#!/usr/bin/env node

/**
 * Migrations-Script für bestehende Geräte
 * Konvertiert alte Geräte-Struktur zur neuen Struktur
 */

const mongoose = require('mongoose');
const Device = require('./server/models/Device');
require('dotenv').config();

async function migrateDevices() {
  try {
    // Verbindung zur Datenbank
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/taubenschiesser');
    console.log('✅ Verbunden zur Datenbank');

    // Finde alle bestehenden Geräte
    const devices = await Device.find({});
    console.log(`📊 Gefunden: ${devices.length} Geräte zum Migrieren`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const device of devices) {
      console.log(`\n🔄 Migriere Gerät: ${device.name} (${device.deviceId})`);

      let needsUpdate = false;
      const updateData = {};

      // 1. Taubenschiesser-Konfiguration hinzufügen
      if (device.type === 'taubenschiesser' && !device.taubenschiesser) {
        // Versuche IP aus RTSP URL zu extrahieren oder setze Standard
        let taubenschiesserIp = '192.168.1.100'; // Standard IP
        
        if (device.camera && device.camera.rtspUrl) {
          // Versuche IP aus RTSP URL zu extrahieren
          const rtspMatch = device.camera.rtspUrl.match(/@([^:]+):/);
          if (rtspMatch) {
            taubenschiesserIp = rtspMatch[1];
          }
        }

        updateData.taubenschiesser = {
          ip: taubenschiesserIp,
          mqttPort: 1883
        };
        needsUpdate = true;
        console.log(`   ➕ Taubenschiesser IP gesetzt: ${taubenschiesserIp}`);
      }

      // 2. Kamera-Konfiguration erweitern
      if (device.camera) {
        const cameraUpdate = { ...device.camera };

        // Setze Kamera-Typ basierend auf vorhandenen Daten
        if (!cameraUpdate.type) {
          if (cameraUpdate.rtspUrl && cameraUpdate.rtspUrl.includes('@')) {
            // Hat Credentials -> wahrscheinlich TP-Link
            cameraUpdate.type = 'tp-link';
            
            // Versuche TP-Link Konfiguration zu extrahieren
            const rtspMatch = cameraUpdate.rtspUrl.match(/rtsp:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
            if (rtspMatch) {
              const [, username, password, ip, port, stream] = rtspMatch;
              cameraUpdate.tpLink = {
                ip: ip,
                username: username,
                password: password,
                stream: stream
              };
              console.log(`   ➕ TP-Link Konfiguration extrahiert: ${ip}`);
            }
          } else {
            // Direkter RTSP-Link
            cameraUpdate.type = 'direct-rtsp';
            cameraUpdate.directUrl = cameraUpdate.rtspUrl;
            console.log(`   ➕ Direkter RTSP-Link gesetzt`);
          }
        }

        // Setze Standardwerte für fehlende Felder
        if (!cameraUpdate.tpLink) {
          cameraUpdate.tpLink = {
            ip: '',
            username: '',
            password: '',
            stream: 'stream1'
          };
        }

        updateData.camera = cameraUpdate;
        needsUpdate = true;
      }

      // 3. Update durchführen
      if (needsUpdate) {
        try {
          await Device.findByIdAndUpdate(device._id, updateData);
          migratedCount++;
          console.log(`   ✅ Gerät erfolgreich migriert`);
        } catch (error) {
          console.log(`   ❌ Fehler beim Migrieren: ${error.message}`);
        }
      } else {
        skippedCount++;
        console.log(`   ⏭️  Keine Migration erforderlich`);
      }
    }

    console.log(`\n📈 Migration abgeschlossen:`);
    console.log(`   ✅ Migriert: ${migratedCount} Geräte`);
    console.log(`   ⏭️  Übersprungen: ${skippedCount} Geräte`);

    // Teste die neuen Methoden
    console.log(`\n🧪 Teste neue Geräte-Methoden:`);
    const testDevices = await Device.find({ type: 'taubenschiesser' }).limit(3);
    
    for (const device of testDevices) {
      console.log(`\n   Gerät: ${device.name}`);
      try {
        const rtspUrl = device.getRtspUrl();
        const taubenschiesserIp = device.getTaubenschiesserIp();
        console.log(`   - RTSP URL: ${rtspUrl}`);
        console.log(`   - Taubenschiesser IP: ${taubenschiesserIp}`);
      } catch (error) {
        console.log(`   - Fehler: ${error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Fehler bei der Migration:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Datenbankverbindung geschlossen');
  }
}

// Migration ausführen
if (require.main === module) {
  migrateDevices()
    .then(() => {
      console.log('\n🎉 Migration erfolgreich abgeschlossen!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration fehlgeschlagen:', error);
      process.exit(1);
    });
}

module.exports = { migrateDevices };
