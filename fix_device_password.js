#!/usr/bin/env node

/**
 * Script to fix device password in database
 * Removes the extra @ symbol from password
 */

const mongoose = require('mongoose');
const Device = require('./server/models/Device');

async function fixDevicePassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/taubenschiesser', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find all devices
    const devices = await Device.find({});
    console.log(`Found ${devices.length} devices`);
    
    for (const device of devices) {
      console.log(`\nProcessing device: ${device.name}`);
      console.log('Current camera config:', device.camera);
      
      if (device.camera.type === 'tapo' && device.camera.tapo.password) {
        const currentPassword = device.camera.tapo.password;
        console.log('Current password:', currentPassword);
        
        // Check if password has double @
        if (currentPassword.includes('@@')) {
          console.log('Found double @ in password, fixing...');
          
          // Remove the extra @
          const fixedPassword = currentPassword.replace('@@', '@');
          console.log('Fixed password:', fixedPassword);
          
          // Update the device
          device.camera.tapo.password = fixedPassword;
          await device.save();
          
          console.log('✅ Device password updated');
          
          // Test the new URL
          try {
            const rtspUrl = device.getRtspUrl();
            console.log('New RTSP URL:', rtspUrl);
          } catch (error) {
            console.log('Error generating RTSP URL:', error.message);
          }
        } else {
          console.log('Password looks correct, no changes needed');
        }
      }
    }
    
    console.log('\n✅ All devices processed');
    process.exit(0);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixDevicePassword();
