#!/usr/bin/env node

/**
 * Script to create a user account in the Taubenschiesser system
 * Usage: node create_user.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// User model (copied from server/models/User.js)
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  devices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

const User = mongoose.model('User', userSchema);

async function createUser() {
  try {
    // Connect to MongoDB
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect('mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Check if user already exists
    const existingUser = await User.findOne({ 
      email: 'fabian.bosch@gmx.de' 
    });

    if (existingUser) {
      console.log('⚠️  User with email fabian.bosch@gmx.de already exists');
      console.log('📧 Email:', existingUser.email);
      console.log('👤 Username:', existingUser.username);
      console.log('🔑 Role:', existingUser.role);
      console.log('✅ Active:', existingUser.isActive);
      console.log('📅 Created:', existingUser.createdAt);
      
      // Test password
      console.log('\n🔐 Testing password...');
      const isMatch = await existingUser.comparePassword('rotwand');
      if (isMatch) {
        console.log('✅ Password is correct!');
        console.log('\n🎉 You can now login with:');
        console.log('   Email: fabian.bosch@gmx.de');
        console.log('   Password: rotwand');
      } else {
        console.log('❌ Password is incorrect!');
        console.log('\n💡 You can reset the password by running this script again with a new password');
      }
    } else {
      // Create new user
      console.log('👤 Creating new user...');
      const user = new User({
        username: 'fabian',
        email: 'fabian.bosch@gmx.de',
        password: 'rotwand',
        role: 'admin',
        isActive: true
      });

      await user.save();
      console.log('✅ User created successfully!');
      console.log('📧 Email:', user.email);
      console.log('👤 Username:', user.username);
      console.log('🔑 Role:', user.role);
      console.log('✅ Active:', user.isActive);
      
      console.log('\n🎉 You can now login with:');
      console.log('   Email: fabian.bosch@gmx.de');
      console.log('   Password: rotwand');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 11000) {
      console.log('\n💡 This email is already registered. The user might exist but with a different password.');
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the script
createUser();
