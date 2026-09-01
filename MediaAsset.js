const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  type: {
    type: String,
    enum: ['photo', 'audio', 'video'],
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  views: {
    type: Number,
    default: 0
  },
  downloads: {
    type: Number,
    default: 0
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    artist: String,
    album: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
mediaAssetSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for search
mediaAssetSchema.index({
  title: 'text',
  description: 'text',
  tags: 'text'
});

// ToJSON transform
mediaAssetSchema.set('toJSON', {
  transform: function(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const memoryAssets = [];
let memoryAssetCounter = 1;

class MemoryMediaQuery {
  constructor(items = []) {
    this.items = [...items];
    this.sortOptions = null;
    this.skipCount = 0;
    this.limitCount = null;
  }

  sort(sortOptions = {}) {
    this.sortOptions = sortOptions;
    return this;
  }

  skip(count = 0) {
    this.skipCount = count;
    return this;
  }

  limit(count = 0) {
    this.limitCount = count;
    return this;
  }

  populate() {
    return this;
  }

  getResult() {
    let items = [...this.items];
    if (this.sortOptions && this.sortOptions.createdAt === 1) {
      items = items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (this.sortOptions && this.sortOptions.createdAt === -1) {
      items = items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    if (this.skipCount > 0) {
      items = items.slice(this.skipCount);
    }
    if (this.limitCount > 0) {
      items = items.slice(0, this.limitCount);
    }

    return items;
  }

  then(resolve) {
    return Promise.resolve(this.getResult()).then(resolve);
  }
}

class MemoryMediaAsset {
  constructor(data = {}) {
    this._id = data._id || `memory-asset-${memoryAssetCounter++}`;
    this.id = this._id;
    this.title = data.title;
    this.description = data.description || '';
    this.type = data.type;
    this.fileName = data.fileName;
    this.filePath = data.filePath;
    this.fileSize = data.fileSize;
    this.mimeType = data.mimeType;
    this.tags = data.tags || [];
    this.uploadedBy = data.uploadedBy;
    this.views = data.views || 0;
    this.downloads = data.downloads || 0;
    this.isPublic = data.isPublic !== false;
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  async save() {
    const existingIndex = memoryAssets.findIndex((asset) => asset._id === this._id);
    if (existingIndex >= 0) {
      memoryAssets[existingIndex] = this;
    } else {
      memoryAssets.push(this);
    }
    this.updatedAt = new Date();
    return this;
  }

  async populate() {
    return this;
  }

  async deleteOne() {
    const existingIndex = memoryAssets.findIndex((asset) => asset._id === this._id);
    if (existingIndex >= 0) {
      memoryAssets.splice(existingIndex, 1);
    }
    return this;
  }

  toJSON() {
    return { ...this };
  }

  static find(query = {}) {
    let items = memoryAssets.filter((asset) => {
      if (query.isPublic !== undefined && asset.isPublic !== query.isPublic) {
        return false;
      }
      if (query.type && asset.type !== query.type) {
        return false;
      }
      if (query.$text && query.$text.$search) {
        const search = query.$text.$search.toLowerCase();
        const haystack = `${asset.title} ${asset.description} ${asset.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });

    return new MemoryMediaQuery(items);
  }

  static async countDocuments(query = {}) {
    return MemoryMediaAsset.find(query).getResult().length;
  }

  static async findById(id) {
    return memoryAssets.find((asset) => asset._id === id) || null;
  }

  static async aggregate(pipeline = []) {
    if (pipeline.length === 0) {
      return [];
    }

    const groupStage = pipeline.find((stage) => stage.$group);
    if (!groupStage) {
      return [];
    }

    const totalSize = memoryAssets.reduce((sum, asset) => sum + (asset.fileSize || 0), 0);
    const byType = memoryAssets.reduce((acc, asset) => {
      acc[asset.type] = (acc[asset.type] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(byType).map(([type, count]) => ({
      _id: type,
      count,
      totalSize: memoryAssets.filter((asset) => asset.type === type).reduce((sum, asset) => sum + (asset.fileSize || 0), 0)
    }));
  }
}

const MediaAssetModel = mongoose.connection.readyState === 1
  ? (mongoose.models.MediaAsset || mongoose.model('MediaAsset', mediaAssetSchema))
  : MemoryMediaAsset;

module.exports = MediaAssetModel;