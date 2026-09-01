const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { auth, adminAuth } = require('../Middleware/Auth');
const MediaAsset = require('../Models/MediaAsset');

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);
const STORAGE_LIMIT_BYTES = Number(process.env.STORAGE_LIMIT_BYTES || 1024 * 1024 * 1024);
const uploadRootDir = path.join(__dirname, '../uploads');

function getDirectorySize(targetDir) {
  if (!fs.existsSync(targetDir)) return 0;

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else {
      total += fs.statSync(fullPath).size || 0;
    }
  }

  return total;
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extensions = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
      'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'video/mp4': '.mp4', 'video/webm': '.webm'
    };
    const ext = extensions[file.mimetype] || '';
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/webm'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 100 * 1024
  },
  fileFilter: fileFilter
});

// Get media type from mimetype
function getMediaType(mimetype) {
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'photo';
}

function getAssetUrl(filePath, req) {
  if (!filePath) return '';
  const fileName = filePath.split(/[/\\]/).pop();
  const host = req ? `${req.protocol}://${req.get('host')}` : '';
  return `${host}/uploads/${encodeURIComponent(fileName)}`;
}

function normalizeAsset(asset, req) {
  const raw = asset.toJSON ? asset.toJSON() : { ...asset };
  raw.id = raw._id || raw.id;
  raw.assetUrl = getAssetUrl(raw.filePath, req);
  return raw;
}

// @route   GET /api/media
// @desc    Get all media assets with filtering
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { type, search, sort, page = 1, limit = 20 } = req.query;
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ success: false, message: 'Invalid pagination values' });
    }
    
    const query = { isPublic: true };
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (search) {
      query.$text = { $search: search };
    }
    
    const skip = (parsedPage - 1) * parsedLimit;
    const sortOptions = sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
    
    const [assets, total] = await Promise.all([
      MediaAsset.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(parsedLimit),
      MediaAsset.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: assets.map((asset) => normalizeAsset(asset, req)),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching media'
    });
  }
});

// @route   POST /api/media
// @desc    Upload new media asset
// @access  Private
router.post('/', 
  auth,
  upload.single('file'),
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').optional().trim(),
    body('tags').optional().isArray()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const { title, description, tags, isPublic = true, metadata } = req.body;
      const file = req.file;
      const usedBytes = getDirectorySize(uploadRootDir);

      if (usedBytes + file.size > STORAGE_LIMIT_BYTES) {
        fs.unlinkSync(file.path);
        return res.status(413).json({
          success: false,
          message: 'Storage limit reached. This project has a 1TB media capacity and no space remains for this upload.'
        });
      }
      
      const mediaType = getMediaType(file.mimetype);
      
      const asset = new MediaAsset({
        title,
        description: description || '',
        type: mediaType,
        fileName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        tags: tags || [],
        uploadedBy: req.user._id,
        isPublic: isPublic === 'true' || isPublic === true,
        metadata: metadata ? JSON.parse(metadata) : {}
      });

      await asset.save();

      // Populate uploader info
      await asset.populate('uploadedBy', 'name email');

      res.status(201).json({
        success: true,
        data: normalizeAsset(asset, req),
        message: 'File uploaded successfully'
      });
    } catch (error) {
      console.error('Upload error:', error);
      // Clean up uploaded file if error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        success: false,
        message: 'Server error during upload'
      });
    }
  }
);

// @route   GET /api/media/:id
// @desc    Get single media asset
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const asset = await MediaAsset.findOne({ _id: req.params.id, isPublic: true });
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Increment view count
    asset.views += 1;
    await asset.save();

    res.json({
      success: true,
      data: normalizeAsset(asset, req)
    });
  } catch (error) {
    console.error('Get asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching asset'
    });
  }
});

// @route   PUT /api/media/:id
// @desc    Update media asset
// @access  Private
router.put('/:id',
  auth,
  [
    body('title').optional().trim(),
    body('description').optional().trim(),
    body('tags').optional().isArray(),
    body('isPublic').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const asset = await MediaAsset.findById(req.params.id);
      
      if (!asset) {
        return res.status(404).json({
          success: false,
          message: 'Asset not found'
        });
      }

      // Check permissions
      if ((!asset.uploadedBy || asset.uploadedBy.toString() !== req.user._id.toString()) && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this asset'
        });
      }

      const { title, description, tags, isPublic, metadata } = req.body;
      
      if (title) asset.title = title;
      if (description !== undefined) asset.description = description;
      if (tags) asset.tags = tags;
      if (isPublic !== undefined) asset.isPublic = isPublic;
      if (metadata) asset.metadata = { ...asset.metadata, ...metadata };
      
      asset.updatedAt = new Date();
      await asset.save();
      
      await asset.populate('uploadedBy', 'name email');

      res.json({
        success: true,
        data: asset,
        message: 'Asset updated successfully'
      });
    } catch (error) {
      console.error('Update asset error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error updating asset'
      });
    }
  }
);

// @route   DELETE /api/media/:id
// @desc    Delete media asset
// @access  Private/Admin
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const asset = await MediaAsset.findById(req.params.id);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check permissions
    if ((!asset.uploadedBy || asset.uploadedBy.toString() !== req.user._id.toString()) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this asset'
      });
    }

    // Delete file from disk
    if (fs.existsSync(asset.filePath)) {
      fs.unlinkSync(asset.filePath);
    }

    // Remove from database
    await asset.deleteOne();

    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting asset'
    });
  }
});

// @route   GET /api/media/stats
// @desc    Get media statistics
// @access  Private/Admin
router.get('/stats/all', adminAuth, async (req, res) => {
  try {
    const stats = await MediaAsset.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      }
    ]);

    const total = await MediaAsset.countDocuments();
    const totalSize = await MediaAsset.aggregate([
      { $group: { _id: null, total: { $sum: '$fileSize' } } }
    ]);

    res.json({
      success: true,
      data: {
        total,
        totalSize: totalSize.length > 0 ? totalSize[0].total : 0,
        breakdown: stats
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error getting stats'
    });
  }
});

module.exports = router;