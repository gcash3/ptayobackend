const ContentPage = require('../models/ContentPage');
const FAQ = require('../models/FAQ');
const Feedback = require('../models/Feedback');

// =============================================
// FAQ Management
// =============================================

// Get all FAQs (Public)
exports.getFAQs = async (req, res) => {
  try {
    const { category, search } = req.query;
    
    let faqs;
    if (search) {
      faqs = await FAQ.searchFAQs(search);
    } else {
      faqs = await FAQ.getActiveByCategory(category);
    }
    
    const categories = await FAQ.getCategories();
    
    res.status(200).json({
      status: 'success',
      data: {
        faqs,
        categories
      }
    });
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch FAQs',
      error: error.message
    });
  }
};

// Get all FAQs for admin (includes inactive)
exports.getAllFAQsAdmin = async (req, res) => {
  try {
    const { category, status, search, page = 1, limit = 20 } = req.query;
    
    let query = {};
    
    if (category && category !== 'all') {
      query.category = category;
    }
    
    if (status && status !== 'all') {
      query.isActive = status === 'active';
    }
    
    if (search) {
      query.$or = [
        { question: { $regex: search, $options: 'i' } },
        { answer: { $regex: search, $options: 'i' } }
      ];
    }
    
    const faqs = await FAQ.find(query)
      .sort({ order: 1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('createdBy', 'name email')
      .populate('lastUpdatedBy', 'name email');
    
    const total = await FAQ.countDocuments(query);
    const categories = await FAQ.getCategories();
    
    res.status(200).json({
      status: 'success',
      data: {
        faqs,
        categories,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching FAQs for admin:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch FAQs',
      error: error.message
    });
  }
};

// Create FAQ
exports.createFAQ = async (req, res) => {
  try {
    const { question, answer, category, order, tags } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({
        status: 'error',
        message: 'Question and answer are required'
      });
    }
    
    const faq = new FAQ({
      question,
      answer,
      category: category || 'General',
      order: order || 0,
      tags: tags || [],
      createdBy: req.user.id
    });
    
    await faq.save();
    
    res.status(201).json({
      status: 'success',
      message: 'FAQ created successfully',
      data: faq
    });
  } catch (error) {
    console.error('Error creating FAQ:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create FAQ',
      error: error.message
    });
  }
};

// Update FAQ
exports.updateFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, order, tags, isActive } = req.body;
    
    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found'
      });
    }
    
    faq.question = question || faq.question;
    faq.answer = answer || faq.answer;
    faq.category = category || faq.category;
    faq.order = order !== undefined ? order : faq.order;
    faq.tags = tags || faq.tags;
    faq.isActive = isActive !== undefined ? isActive : faq.isActive;
    faq.lastUpdatedBy = req.user.id;
    
    await faq.save();
    
    res.status(200).json({
      status: 'success',
      message: 'FAQ updated successfully',
      data: faq
    });
  } catch (error) {
    console.error('Error updating FAQ:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update FAQ',
      error: error.message
    });
  }
};

// Delete FAQ
exports.deleteFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    
    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found'
      });
    }
    
    await FAQ.findByIdAndDelete(id);
    
    res.status(200).json({
      status: 'success',
      message: 'FAQ deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting FAQ:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete FAQ',
      error: error.message
    });
  }
};

// =============================================
// Content Pages Management
// =============================================

// Get content page (Public)
exports.getContentPage = async (req, res) => {
  try {
    const { type } = req.params;
    
    const content = await ContentPage.getActiveContent(type);
    if (!content) {
      return res.status(404).json({
        status: 'error',
        message: 'Content not found'
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: content
    });
  } catch (error) {
    console.error('Error fetching content page:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch content',
      error: error.message
    });
  }
};

// Get all content pages (Admin)
exports.getAllContentPages = async (req, res) => {
  try {
    const content = await ContentPage.find()
      .sort({ type: 1 })
      .populate('lastUpdatedBy', 'name email');
    
    res.status(200).json({
      status: 'success',
      data: content
    });
  } catch (error) {
    console.error('Error fetching content pages:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch content pages',
      error: error.message
    });
  }
};

// Update content page
exports.updateContentPage = async (req, res) => {
  try {
    const { type } = req.params;
    const { title, content, version, seoTitle, seoDescription } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and content are required'
      });
    }
    
    let contentPage = await ContentPage.findOne({ type });
    
    if (!contentPage) {
      // Create new content page
      contentPage = new ContentPage({
        type,
        title,
        content,
        version: version || '1.0',
        seoTitle,
        seoDescription,
        lastUpdatedBy: req.user.id
      });
    } else {
      // Update existing content page
      contentPage.title = title;
      contentPage.content = content;
      contentPage.version = version || contentPage.version;
      contentPage.seoTitle = seoTitle;
      contentPage.seoDescription = seoDescription;
      contentPage.lastUpdatedBy = req.user.id;
    }
    
    await contentPage.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Content updated successfully',
      data: contentPage
    });
  } catch (error) {
    console.error('Error updating content page:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update content',
      error: error.message
    });
  }
};

// =============================================
// Feedback Management
// =============================================

// Submit feedback (Public)
exports.submitFeedback = async (req, res) => {
  try {
    const { name, email, subject, message, category, rating, platform, appVersion, deviceInfo } = req.body;
    
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, email, subject, and message are required'
      });
    }
    
    const feedback = new Feedback({
      name,
      email,
      subject,
      message,
      category: category || 'General',
      rating: rating || 5,
      platform: platform || 'unknown',
      appVersion,
      deviceInfo,
      userId: req.user ? req.user.id : null,
      userType: req.user ? (req.user.role || 'user') : 'anonymous'
    });
    
    await feedback.save();
    
    res.status(201).json({
      status: 'success',
      message: 'Feedback submitted successfully',
      data: { feedbackId: feedback._id }
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit feedback',
      error: error.message
    });
  }
};

// Get all feedback (Admin)
exports.getAllFeedback = async (req, res) => {
  try {
    const { 
      status, 
      category, 
      rating, 
      search, 
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    let query = {};
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (category && category !== 'all') {
      query.category = category;
    }
    
    if (rating) {
      query.rating = parseInt(rating);
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    const feedback = await Feedback.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('assignedTo', 'name email')
      .populate('resolvedBy', 'name email');
    
    const total = await Feedback.countDocuments(query);
    
    // Get analytics
    const analytics = await Feedback.getAnalytics();
    
    res.status(200).json({
      status: 'success',
      data: {
        feedback,
        analytics: analytics[0] || {},
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch feedback',
      error: error.message
    });
  }
};

// Update feedback status
exports.updateFeedbackStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, adminNotes, responseMessage } = req.body;
    
    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({
        status: 'error',
        message: 'Feedback not found'
      });
    }
    
    if (status) feedback.status = status;
    if (priority) feedback.priority = priority;
    if (adminNotes) feedback.adminNotes = adminNotes;
    if (responseMessage) feedback.responseMessage = responseMessage;
    
    if (status === 'resolved') {
      feedback.resolvedAt = new Date();
      feedback.resolvedBy = req.user.id;
    }
    
    await feedback.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Feedback updated successfully',
      data: feedback
    });
  } catch (error) {
    console.error('Error updating feedback:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update feedback',
      error: error.message
    });
  }
};

// Assign feedback to admin
exports.assignFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId } = req.body;
    
    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({
        status: 'error',
        message: 'Feedback not found'
      });
    }
    
    await feedback.assignTo(adminId);
    
    res.status(200).json({
      status: 'success',
      message: 'Feedback assigned successfully',
      data: feedback
    });
  } catch (error) {
    console.error('Error assigning feedback:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to assign feedback',
      error: error.message
    });
  }
};

// Get contact support info (Public)
exports.getContactInfo = async (req, res) => {
  try {
    // This would typically come from a settings collection or config
    const contactInfo = {
      email: process.env.SUPPORT_EMAIL || 'support@parktayo.com',
      phone: process.env.SUPPORT_PHONE || '+63 912 345 6789',
      address: process.env.SUPPORT_ADDRESS || 'University Belt, Manila, Philippines',
      businessHours: process.env.BUSINESS_HOURS || 'Monday - Friday: 8:00 AM - 6:00 PM',
      supportChannels: ['Email', 'Phone', 'In-App Chat'],
      emergencyContact: process.env.EMERGENCY_CONTACT || '+63 917 123 4567'
    };
    
    res.status(200).json({
      status: 'success',
      data: contactInfo
    });
  } catch (error) {
    console.error('Error fetching contact info:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch contact information',
      error: error.message
    });
  }
};