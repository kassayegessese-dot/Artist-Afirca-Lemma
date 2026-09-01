const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['admin', 'editor', 'viewer'],
    default: 'viewer'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
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

// ToJSON transform
userSchema.set('toJSON', {
  transform: function(doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

const memoryUsers = [];
let memoryUserCounter = 1;

class MemoryUser {
  constructor(data = {}) {
    this._id = data._id || `memory-user-${memoryUserCounter++}`;
    this.email = data.email;
    this.password = data.password;
    this.name = data.name;
    this.role = data.role || 'viewer';
    this.isActive = data.isActive !== false;
    this.lastLogin = data.lastLogin || null;
    this.createdAt = data.createdAt || new Date();
  }

  async save() {
    if (this.password && !this.password.startsWith('$2')) {
      this.password = await bcrypt.hash(this.password, 10);
    }

    const existingIndex = memoryUsers.findIndex((user) => user._id === this._id);
    if (existingIndex >= 0) {
      memoryUsers[existingIndex] = this;
    } else {
      memoryUsers.push(this);
    }

    return this;
  }

  async comparePassword(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
  }

  toJSON() {
    const copy = { ...this };
    delete copy.password;
    return copy;
  }

  static async findOne(filter = {}) {
    if (!filter) return null;
    if (filter.email) {
      return memoryUsers.find((user) => user.email === filter.email) || null;
    }
    if (filter._id) {
      return memoryUsers.find((user) => user._id === filter._id) || null;
    }
    return null;
  }

  static async findById(id) {
    return memoryUsers.find((user) => user._id === id) || null;
  }
}

const UserModel = mongoose.connection.readyState === 1
  ? (mongoose.models.User || mongoose.model('User', userSchema))
  : MemoryUser;

module.exports = UserModel;