const mongoose = require('mongoose');

const contentPageSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['about', 'terms', 'privacy', 'help'],
    unique: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  version: {
    type: String,
    default: '1.0'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  publishedAt: {
    type: Date,
    default: Date.now
  },
  seoTitle: {
    type: String,
    trim: true
  },
  seoDescription: {
    type: String,
    trim: true
  },
  slug: {
    type: String,
    trim: true,
    lowercase: true
  }
}, {
  timestamps: true
});

// Create slug from type if not provided
contentPageSchema.pre('save', function(next) {
  if (!this.slug) {
    this.slug = this.type.toLowerCase().replace(/\s+/g, '-');
  }
  next();
});

// Instance methods
contentPageSchema.methods.toJSON = function() {
  const content = this.toObject();
  return {
    id: content._id,
    type: content.type,
    title: content.title,
    content: content.content,
    version: content.version,
    isActive: content.isActive,
    lastUpdated: content.updatedAt,
    publishedAt: content.publishedAt,
    seoTitle: content.seoTitle,
    seoDescription: content.seoDescription,
    slug: content.slug
  };
};

// Static methods
contentPageSchema.statics.getActiveContent = function(type) {
  return this.findOne({ type, isActive: true });
};

module.exports = mongoose.model('ContentPage', contentPageSchema);