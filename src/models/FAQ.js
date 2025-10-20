const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    trim: true,
    default: 'General'
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  helpfulCount: {
    type: Number,
    default: 0
  },
  notHelpfulCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Indexes for better performance
faqSchema.index({ category: 1, order: 1 });
faqSchema.index({ isActive: 1 });
faqSchema.index({ question: 'text', answer: 'text' });

// Instance methods
faqSchema.methods.toJSON = function() {
  const faq = this.toObject();
  return {
    id: faq._id,
    question: faq.question,
    answer: faq.answer,
    category: faq.category,
    order: faq.order,
    isActive: faq.isActive,
    tags: faq.tags,
    helpfulCount: faq.helpfulCount,
    notHelpfulCount: faq.notHelpfulCount,
    createdAt: faq.createdAt,
    updatedAt: faq.updatedAt
  };
};

// Static methods
faqSchema.statics.getActiveByCategory = function(category) {
  const query = { isActive: true };
  if (category && category !== 'all') {
    query.category = category;
  }
  return this.find(query).sort({ order: 1, createdAt: -1 });
};

faqSchema.statics.getCategories = function() {
  return this.distinct('category', { isActive: true });
};

faqSchema.statics.searchFAQs = function(searchTerm) {
  return this.find({
    isActive: true,
    $or: [
      { question: { $regex: searchTerm, $options: 'i' } },
      { answer: { $regex: searchTerm, $options: 'i' } },
      { tags: { $in: [new RegExp(searchTerm, 'i')] } }
    ]
  }).sort({ order: 1, createdAt: -1 });
};

module.exports = mongoose.model('FAQ', faqSchema);