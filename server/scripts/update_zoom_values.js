const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Load Device model
const Device = require('../models/Device');

// MongoDB connection string (same as in config/database.js)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';

async function updateZoomValues() {
  try {
    console.log('Connecting to MongoDB...');
    console.log('MongoDB URI:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all devices
    const devices = await Device.find({});
    console.log(`Found ${devices.length} devices`);

    let totalUpdates = 0;
    let devicesUpdated = 0;

    for (const device of devices) {
      let deviceModified = false;

      // Check if device has actions.route.coordinates
      if (device.actions && device.actions.route && device.actions.route.coordinates) {
        const coordinates = device.actions.route.coordinates;
        
        for (let i = 0; i < coordinates.length; i++) {
          const coord = coordinates[i];
          
          // If zoom is greater than 2, set it to 2
          if (coord.zoom && coord.zoom > 2) {
            console.log(`  Device: ${device.name} - Coordinate #${i}: Zoom ${coord.zoom} -> 2`);
            coord.zoom = 2;
            deviceModified = true;
            totalUpdates++;
          }
        }
        
        if (deviceModified) {
          await device.save();
          devicesUpdated++;
          console.log(`✓ Updated device: ${device.name}`);
        }
      }
    }

    console.log('\n=== Update Summary ===');
    console.log(`Total coordinates updated: ${totalUpdates}`);
    console.log(`Total devices updated: ${devicesUpdated}`);
    console.log('Update completed successfully!');

  } catch (error) {
    console.error('Error updating zoom values:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the update
updateZoomValues();

