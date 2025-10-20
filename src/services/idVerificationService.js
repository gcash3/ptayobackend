const User = require('../models/User');
const { imageUploadService } = require('./imageUploadService');
const logger = require('../config/logger');
const { AppError } = require('../middleware/errorHandler');

class IdVerificationService {
  
  /**
   * Upload ID verification photos to Cloudinary
   */
  async uploadVerificationPhotos(files) {
    try {
      const uploadResults = {};
      const errors = [];

      // Validate files parameter
      if (!files || typeof files !== 'object') {
        logger.error('❌ Invalid files parameter:', { files, typeof: typeof files });
        return {
          success: false,
          error: 'Invalid files parameter - expected object with photo files'
        };
      }

      // Upload each photo type
      for (const [photoType, file] of Object.entries(files)) {
        if (file) {
          const result = await imageUploadService.uploadSingleImage(file, {
            folder: 'parktayo/id-verification',
            transformation: [
              { width: 1200, height: 800, crop: 'limit', quality: 'auto' },
              { fetch_format: 'auto' }
            ],
            public_id: `id-${photoType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          });

          if (result.success) {
            uploadResults[photoType] = {
              url: result.data.url,
              publicId: result.data.publicId
            };
            logger.info(`✅ Successfully uploaded ${photoType} ID photo`, {
              publicId: result.data.publicId,
              url: result.data.url
            });
          } else {
            errors.push(`Failed to upload ${photoType}: ${result.error}`);
            logger.error(`❌ Failed to upload ${photoType} ID photo:`, result.error);
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Upload errors: ${errors.join(', ')}`);
      }

      return {
        success: true,
        data: uploadResults
      };

    } catch (error) {
      logger.error('❌ ID verification photo upload failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Submit ID verification for a landlord
   */
  async submitIdVerification(userId, verificationData, files) {
    try {
      // Find the user
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (user.role !== 'landlord') {
        throw new AppError('ID verification is only available for landlords', 403);
      }

      // Debug: Log what we're about to upload
      logger.info('🔍 Service - uploading photos:', {
        files: files ? Object.keys(files) : null,
        hasFiles: !!files
      });

      // Upload photos to Cloudinary
      const uploadResult = await this.uploadVerificationPhotos(files);
      if (!uploadResult.success) {
        throw new AppError(`Photo upload failed: ${uploadResult.error}`, 400);
      }

      const { front, back, selfie } = uploadResult.data;

      // Update user's ID verification data
      user.idVerification = {
        idType: verificationData.idType,
        idFrontUrl: front?.url || null,
        idBackUrl: back?.url || null,
        selfieUrl: selfie?.url || null,
        verificationStatus: 'under_review',
        submittedAt: new Date(),
        cloudinaryIds: {
          frontId: front?.publicId || null,
          backId: back?.publicId || null,
          selfieId: selfie?.publicId || null
        }
      };

      await user.save();

      logger.info(`📋 ID verification submitted for landlord ${userId}`, {
        userId,
        idType: verificationData.idType,
        hasPhotos: {
          front: !!front,
          back: !!back,
          selfie: !!selfie
        }
      });

      // Remove sensitive Cloudinary IDs from response
      const responseData = { ...user.idVerification.toObject() };
      delete responseData.cloudinaryIds;

      return {
        success: true,
        message: 'ID verification submitted successfully. Your documents are now under review.',
        data: responseData
      };

    } catch (error) {
      logger.error('❌ ID verification submission failed:', error);
      throw error;
    }
  }

  /**
   * Get ID verification status for a user
   */
  async getVerificationStatus(userId) {
    try {
      const user = await User.findById(userId).select('idVerification role');
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (user.role !== 'landlord') {
        throw new AppError('ID verification is only available for landlords', 403);
      }

      // Return verification status without sensitive data
      if (!user.idVerification) {
        // User hasn't submitted ID verification yet
        return {
          success: true,
          data: {
            verificationStatus: 'incomplete'
          }
        };
      }

      const responseData = { ...user.idVerification.toObject() };
      delete responseData.cloudinaryIds;

      return {
        success: true,
        data: responseData
      };

    } catch (error) {
      logger.error('❌ Get verification status failed:', error);
      throw error;
    }
  }

  /**
   * Review ID verification (Admin only)
   */
  async reviewIdVerification(userId, reviewData, reviewerId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (!user.idVerification) {
        throw new AppError('No ID verification found for this user', 404);
      }

      const { status, rejectionReason } = reviewData;

      user.idVerification.verificationStatus = status;
      user.idVerification.reviewedAt = new Date();
      user.idVerification.reviewedBy = reviewerId;

      if (status === 'rejected' && rejectionReason) {
        user.idVerification.rejectionReason = rejectionReason;
      } else {
        user.idVerification.rejectionReason = null;
      }

      // If approved, mark landlord as verified
      if (status === 'approved') {
        user.isVerifiedLandlord = true;
      }

      await user.save();

      logger.info(`🔍 ID verification reviewed for user ${userId}`, {
        userId,
        status,
        reviewerId,
        rejectionReason: rejectionReason || null
      });

      // TODO: Send SMS notification to user about verification result
      
      return {
        success: true,
        message: `ID verification ${status} successfully`,
        data: {
          userId,
          status,
          reviewedAt: user.idVerification.reviewedAt
        }
      };

    } catch (error) {
      logger.error('❌ ID verification review failed:', error);
      throw error;
    }
  }

  /**
   * Delete verification photos from Cloudinary
   */
  async deleteVerificationPhotos(userId) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.idVerification || !user.idVerification.cloudinaryIds) {
        return { success: true, message: 'No photos to delete' };
      }

      const { frontId, backId, selfieId } = user.idVerification.cloudinaryIds;
      const idsToDelete = [frontId, backId, selfieId].filter(Boolean);

      if (idsToDelete.length > 0) {
        const deleteResult = await imageUploadService.deleteMultipleImages(idsToDelete);
        logger.info(`🗑️ Deleted verification photos for user ${userId}`, {
          deletedCount: deleteResult.data?.successful || 0,
          totalIds: idsToDelete.length
        });
      }

      return {
        success: true,
        message: 'Verification photos deleted successfully'
      };

    } catch (error) {
      logger.error('❌ Delete verification photos failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all pending verifications (Admin only)
   */
  async getPendingVerifications(page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;

      const users = await User.find({
        role: 'landlord',
        'idVerification.verificationStatus': 'under_review'
      })
      .select('firstName lastName email phoneNumber idVerification createdAt')
      .sort({ 'idVerification.submittedAt': -1 })
      .skip(skip)
      .limit(limit);

      const total = await User.countDocuments({
        role: 'landlord',
        'idVerification.verificationStatus': 'under_review'
      });

      // Remove sensitive data from response
      const sanitizedUsers = users.map(user => ({
        ...user.toObject(),
        idVerification: {
          ...user.idVerification.toObject(),
          cloudinaryIds: undefined // Remove cloudinary IDs
        }
      }));

      return {
        success: true,
        data: {
          users: sanitizedUsers,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };

    } catch (error) {
      logger.error('❌ Get pending verifications failed:', error);
      throw error;
    }
  }

  /**
   * Get verification statistics (Admin only)
   */
  async getVerificationStats() {
    try {
      const stats = await User.aggregate([
        {
          $match: { role: 'landlord' }
        },
        {
          $group: {
            _id: '$idVerification.verificationStatus',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        incomplete: 0,
        under_review: 0,
        approved: 0,
        rejected: 0,
        pending: 0
      };

      stats.forEach(stat => {
        if (stat._id && result.hasOwnProperty(stat._id)) {
          result[stat._id] = stat.count;
        } else if (!stat._id) {
          // Users without idVerification field
          result.incomplete += stat.count;
        }
      });

      return {
        success: true,
        data: result
      };

    } catch (error) {
      logger.error('❌ Get verification stats failed:', error);
      throw error;
    }
  }
}

module.exports = new IdVerificationService();
