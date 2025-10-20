const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const { AppError, catchAsync } = require('./errorHandler');
const logger = require('../config/logger');

// Generate JWT token
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// Generate refresh token
const signRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
};

// Create and send token response
const createSendToken = (user, statusCode, res, message = 'Success') => {
  const token = signToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  
  logger.info('🔐 Creating JWT token for user', {
    userId: user._id,
    email: user.email,
    userType: user.userType || user.role,
    model: user.constructor.modelName || 'Unknown',
    tokenLength: token.length,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
  
  const cookieOptions = {
    expires: new Date(
      Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  };

  // Send refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    expires: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    )
  });

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    message,
    token,
    data: {
      user
    }
  });
};

// Middleware to authenticate JWT token (Custom JWT - No Firebase)
const authenticateToken = catchAsync(async (req, res, next) => {
  // 1) Check if token exists (Bearer token or cookie)
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  // Debug logging
  logger.info('Auth middleware check', {
    url: req.originalUrl,
    method: req.method,
    hasAuthHeader: !!req.headers.authorization,
    hasCookie: !!req.cookies?.jwt,
    tokenExists: !!token,
    tokenLength: token ? token.length : 0
  });

  if (!token) {
    logger.security('Unauthorized access attempt - no token', { 
      url: req.originalUrl,
      method: req.method,
      headers: req.headers.authorization ? 'Bearer [hidden]' : 'none',
      cookies: req.cookies ? Object.keys(req.cookies) : 'none'
    }, req);
    
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  // 2) Verify JWT token (Custom JWT only - no Firebase tokens accepted)
  let decoded;
  try {
    logger.debug('🔓 Attempting to verify custom JWT token', {
      tokenLength: token.length,
      tokenStart: token.substring(0, 20),
      jwtSecretExists: !!process.env.JWT_SECRET,
      jwtSecretLength: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0
    });
    
    // Only accept our custom JWT tokens signed with our secret
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    
    logger.info('✅ Token verified successfully', {
      userId: decoded.id,
      url: req.originalUrl,
      issuedAt: new Date(decoded.iat * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    });
  } catch (error) {
    logger.security('❌ Token verification failed', {
      url: req.originalUrl,
      error: error.name,
      message: error.message,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20),
      jwtSecretExists: !!process.env.JWT_SECRET
    }, req);
    return next(new AppError('Invalid token. Please log in again.', 401));
  }

  // 3) Check if user still exists (check both User and Admin models)
  logger.debug('🔍 Looking up user by ID', {
    userId: decoded.id,
    url: req.originalUrl
  });

  // Try User model first, then Admin model
  let currentUser = await User.findById(decoded.id);

  if (!currentUser) {
    const Admin = require('../models/Admin');
    currentUser = await Admin.findById(decoded.id);

    if (currentUser) {
      logger.debug('✅ Admin user found', {
        userId: currentUser._id,
        adminLevel: currentUser.adminLevel
      });
    }
  }

  if (!currentUser) {
    logger.warn('⚠️ Token used for non-existent user', {
      userId: decoded.id,
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }
  
  logger.debug('✅ User found successfully', {
    userId: currentUser._id,
    userType: currentUser.userType || currentUser.role,
    email: currentUser.email,
    active: currentUser.active
  });

  // 4) Check if user is active (handle both new and legacy users)
  const isActive = currentUser.active !== false; // undefined or true = active, false = inactive
  if (!isActive) {
    logger.security('Token used for inactive user', {
      userId: decoded.id,
      activeValue: currentUser.active
    }, req);

    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // 5) Check if user is suspended
  if (currentUser.status === 'suspended') {
    logger.security('Token used for suspended user', {
      userId: decoded.id,
      status: currentUser.status,
      suspensionReason: currentUser.suspensionReason,
      suspendedAt: currentUser.suspendedAt
    }, req);

    return next(new AppError('Your account has been suspended. Please contact support.', 401));
  }

  logger.debug('✅ User is active and not suspended', {
    userId: currentUser._id,
    activeValue: currentUser.active,
    status: currentUser.status,
    isActive
  });

  // 6) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    logger.security('Token used after password change', { 
      userId: decoded.id 
    }, req);
    
    return next(new AppError('User recently changed password! Please log in again.', 401));
  }

  // Grant access to protected route
  req.user = currentUser;
  next();
});

// Middleware to authorize specific roles
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.security('Unauthorized role access attempt', { 
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        url: req.originalUrl 
      }, req);
      
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

// Middleware to authorize resource owner or admin
const authorizeOwnerOrAdmin = (resourceIdField = 'id') => {
  return (req, res, next) => {
    const resourceUserId = req.params[resourceIdField] || req.body.userId;
    
    // Allow if user is admin or owns the resource
    if (req.user.role === 'admin' || req.user.id === resourceUserId) {
      return next();
    }

    logger.security('Unauthorized resource access attempt', { 
      userId: req.user.id,
      userRole: req.user.role,
      resourceUserId,
      url: req.originalUrl 
    }, req);

    return next(new AppError('You can only access your own resources', 403));
  };
};

// Middleware for optional authentication (for public routes that can benefit from user context)
const optionalAuth = catchAsync(async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (token) {
    try {
      // Verify token
      const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
      
      // Check if user still exists (check both new and legacy models)
      const currentUser = await findUserById(decoded.id);
      
      if (currentUser && currentUser.active && !currentUser.changedPasswordAfter(decoded.iat)) {
        req.user = currentUser;
      }
    } catch (err) {
      // Token is invalid, but we continue without user context
      // This is for optional auth, so we don't throw an error
    }
  }

  next();
});

// Middleware to check if user is landlord and owns the parking space
const authorizeLandlordSpace = catchAsync(async (req, res, next) => {
  const ParkingSpace = require('../models/ParkingSpace');
  
  if (req.user.role !== 'landlord' && req.user.role !== 'admin') {
    return next(new AppError('Only landlords can manage parking spaces', 403));
  }

  // For POST requests (creating new space), landlord owns it by default
  if (req.method === 'POST') {
    return next();
  }

  // For other methods, check if landlord owns the space
  const spaceId = req.params.id || req.params.spaceId;
  if (!spaceId) {
    return next(new AppError('Space ID is required', 400));
  }

  const space = await ParkingSpace.findById(spaceId);
  if (!space) {
    return next(new AppError('Parking space not found', 404));
  }

  // Admin can access any space, landlord can only access their own
  if (req.user.role !== 'admin' && space.landlordId.toString() !== req.user.id) {
    logger.security('Unauthorized space access attempt', { 
      userId: req.user.id,
      spaceId,
      spaceLandlordId: space.landlordId 
    }, req);
    
    return next(new AppError('You can only manage your own parking spaces', 403));
  }

  req.parkingSpace = space;
  next();
});

// Middleware to refresh JWT token
const refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.cookies;
  
  if (!refreshToken) {
    return next(new AppError('Refresh token not found', 401));
  }

  // Verify refresh token
  const decoded = await promisify(jwt.verify)(refreshToken, process.env.JWT_REFRESH_SECRET);
  
  // Check if user still exists
  const currentUser = await User.findById(decoded.id);
  
  if (!currentUser) {
    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }

  // Check if user is active
  if (!currentUser.active) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // Generate new access token
  const newToken = signToken(currentUser._id);
  
  res.status(200).json({
    status: 'success',
    message: 'Token refreshed successfully',
    token: newToken
  });
});

// Middleware specifically for admin-only routes
const requireAdmin = (req, res, next) => {
  // Check if user is from Admin model or has role 'admin'
  const isAdmin = req.user.constructor.modelName === 'Admin' ||
                  req.user.__t === 'Admin' ||
                  req.user.role === 'admin';

  if (!isAdmin) {
    logger.security('Non-admin attempted to access admin route', {
      userId: req.user.id,
      userRole: req.user.role,
      userType: req.user.__t,
      modelName: req.user.constructor.modelName,
      url: req.originalUrl
    }, req);

    return next(new AppError('Admin access required', 403));
  }
  next();
};

// Middleware specifically for landlord-only routes
const requireLandlord = (req, res, next) => {
  if (req.user.role !== 'landlord') {
    logger.security('Non-landlord attempted to access landlord route', {
      userId: req.user.id,
      userRole: req.user.role,
      url: req.originalUrl
    }, req);

    return next(new AppError('Landlord access required', 403));
  }
  next();
};

// Middleware to check if admin has specific permission
const requirePermission = (permission) => {
  return async (req, res, next) => {
    const Admin = require('../models/Admin');

    try {
      const admin = await Admin.findById(req.user.id);

      if (!admin) {
        return next(new AppError('Admin not found', 404));
      }

      // Super admin has all permissions
      if (admin.adminLevel === 'super_admin') {
        return next();
      }

      // Check if admin has the required permission
      if (!admin.permissions.includes(permission)) {
        logger.security('Admin lacks required permission', {
          adminId: req.user.id,
          adminLevel: admin.adminLevel,
          requiredPermission: permission,
          userPermissions: admin.permissions,
          url: req.originalUrl
        }, req);

        return next(new AppError(`Permission denied. Required permission: ${permission}`, 403));
      }

      next();
    } catch (error) {
      return next(new AppError('Error checking permissions', 500));
    }
  };
};

// Middleware to check if user is super admin (for system settings and admin user management)
const requireSuperAdmin = async (req, res, next) => {
  const Admin = require('../models/Admin');

  try {
    const admin = await Admin.findById(req.user.id);

    if (!admin) {
      return next(new AppError('Admin not found', 404));
    }

    if (admin.adminLevel !== 'super_admin') {
      logger.security('Non-super-admin attempted to access super admin route', {
        adminId: req.user.id,
        adminLevel: admin.adminLevel,
        url: req.originalUrl
      }, req);

      return next(new AppError('Super admin access required', 403));
    }

    next();
  } catch (error) {
    return next(new AppError('Error checking admin level', 500));
  }
};

module.exports = {
  signToken,
  signRefreshToken,
  createSendToken,
  authenticateToken,
  authorizeRoles,
  authorizeOwnerOrAdmin,
  optionalAuth,
  authorizeLandlordSpace,
  refreshToken,
  requireAdmin,
  requireLandlord,
  requirePermission,
  requireSuperAdmin
}; 