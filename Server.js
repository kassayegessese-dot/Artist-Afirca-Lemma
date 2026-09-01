const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const { adminAuth } = require('./Middleware/Auth');

dotenv.config();

const requiredEnvironment = ['JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

const STORAGE_LIMIT_BYTES = Number(process.env.STORAGE_LIMIT_BYTES || 1024 * 1024 * 1024 * 1024);

function getDirectorySize(targetDir) {
  if (!fs.existsSync(targetDir)) return 0;

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else {
      const stat = fs.statSync(fullPath);
      total += stat.size || 0;
    }
  }

  return total;
}

// Routes
const authRoutes = require('./Router/Auth');
const mediaRoutes = require('./Router/Media');
const contactRoutes = require('./Router/contact');
const User = require('./Models/User');

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

// Security middleware
app.use(helmet());
app.use(compression({ level: 6, threshold: 1024 }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      process.env.FRONTEND_ORIGIN
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('CORS policy does not allow access from this origin'));
  },
  credentials: true
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  if (/\/(?:\.env|package(?:-lock)?\.json|Server\.js|Admin\.js|Backend|Middleware|Models|Router|node_modules)(?:\/|$)/i.test(req.path)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
});

// Serve frontend and asset files statically
app.use(express.static(path.join(__dirname), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1h',
  etag: true,
  redirect: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'");
  }
}));

const seedDefaultAdmin = async () => {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return;
    }

    const adminUser = new User({
      email,
      password,
      name: 'Admin',
      role: 'admin'
    });

    await adminUser.save();
    console.log('✅ Seeded default admin user');
  } catch (error) {
    console.error('❌ Failed to seed default admin user:', error);
  }
};

// MongoDB connection (optional)
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    return seedDefaultAdmin();
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    return seedDefaultAdmin();
  });
} else {
  console.warn('⚠️ MONGODB_URI not set — running without database (memory fallback active)');
  // Still attempt to seed default admin into memory-backed user store
  seedDefaultAdmin();
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/contact', contactRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/storage', adminAuth, (req, res) => {
  const usedBytes = getDirectorySize(uploadsDir);
  const limitBytes = STORAGE_LIMIT_BYTES;
  const availableBytes = Math.max(limitBytes - usedBytes, 0);
  const usedPercent = limitBytes > 0 ? Math.min((usedBytes / limitBytes) * 100, 100) : 0;

  res.json({
    success: true,
    data: {
      limitBytes,
      usedBytes,
      availableBytes,
      usedPercent: Number(usedPercent.toFixed(2)),
      limitGb: Number((limitBytes / (1024 ** 3)).toFixed(2)),
      usedGb: Number((usedBytes / (1024 ** 3)).toFixed(2)),
      availableGb: Number((availableBytes / (1024 ** 3)).toFixed(2)),
      path: uploadsDir,
      status: availableBytes > 0 ? 'available' : 'full'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API URL: http://localhost:${PORT}/api`);
});