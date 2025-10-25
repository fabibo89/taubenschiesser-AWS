const mongoose = require('mongoose');
const Device = require('./server/models/Device');

async function fixCameraConfig() {
  try {
    await mongoose.connect('mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin');
    
    const device = await Device.findOne({ 'taubenschiesser.ip': '192.168.10.87' });
    
    if (device) {
      console.log('Found device:', device.name);
      console.log('Current camera config:', JSON.stringify(device.camera, null, 2));
      
      // Set useLocalImage to false and clear localImagePath
      device.camera.useLocalImage = false;
      device.camera.localImagePath = '';
      
      await device.save();
      console.log('✅ Updated camera config - useLocalImage set to false');
    } else {
      console.log('Device not found');
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixCameraConfig();
