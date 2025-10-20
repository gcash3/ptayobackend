const BaseUser = require('./BaseUser');
const Client = require('./Client');
const Landlord = require('./Landlord');
const Admin = require('./Admin');

/**
 * Normalized User Models Export
 * 
 * This module provides the new discriminator-based user models.
 * All users are stored in the BaseUser collection with userType discriminator.
 */

// Helper function to get the appropriate model based on userType/role
const getUserModel = (userType) => {
  const type = (userType || 'client').toLowerCase();
  switch (type) {
    case 'client':
      return Client;
    case 'landlord':
      return Landlord;
    case 'admin':
      return Admin;
    default:
      return Client; // Default to Client model
  }
};

// Helper function to create user with appropriate model
const createUser = async (userData) => {
  const { role, userType } = userData;
  const type = userType || role || 'client';
  const Model = getUserModel(type);
  
  // Ensure userType is set correctly for discriminator
  const finalUserType = type.toLowerCase() === 'client' ? 'Client' :
                        type.toLowerCase() === 'landlord' ? 'Landlord' :
                        type.toLowerCase() === 'admin' ? 'Admin' : 'Client';
  
  return new Model({
    ...userData,
    userType: finalUserType
  });
};

// Helper function to find user by ID (only from BaseUser collection)
const findUserById = async (userId, selectFields = '') => {
  if (selectFields) {
    return await BaseUser.findById(userId).select(selectFields);
  }
  return await BaseUser.findById(userId);
};

// Helper function to find user by email (only from BaseUser collection)
const findUserByEmail = async (email, selectFields = '') => {
  if (selectFields) {
    return await BaseUser.findOne({ email }).select(selectFields);
  }
  return await BaseUser.findOne({ email });
};

// Helper function to find users by type
const findUsersByType = async (userType, query = {}) => {
  const Model = getUserModel(userType);
  return await Model.find(query);
};

// Helper function to get user count by type
const getUserCountByType = async () => {
  const counts = await BaseUser.aggregate([
    {
      $group: {
        _id: '$userType',
        count: { $sum: 1 }
      }
    }
  ]);
  
  return counts.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
};

module.exports = {
  // Discriminator models (all use BaseUser collection)
  BaseUser,
  Client,
  Landlord,
  Admin,
  
  // Helper functions
  getUserModel,
  createUser,
  findUserById,
  findUserByEmail,
  findUsersByType,
  getUserCountByType,
  
  // Direct exports for convenience
  models: {
    BaseUser,
    Client,
    Landlord,
    Admin
  }
};
