// scripts/create-admin.js
const mongoose = require('mongoose');
const User = require('./Models/User');
require('dotenv').config();

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });
    if (adminExists) {
      console.log('Admin user already exists');
      process.exit(0);
    }
    
    const admin = new User({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      name: 'Admin',
      role: 'admin'
    });
    
    await admin.save();
    console.log('Admin user created successfully');
    console.log(`Email: ${process.env.ADMIN_EMAIL}`);
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();