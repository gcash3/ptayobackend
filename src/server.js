// Initialize environment configuration first
const { initializeEnvironment } = require('./config/environment');
const env = initializeEnvironment();

// Set server timezone to Hong Kong
process.env.TZ = 'Asia/Hong_Kong';

require('express-async-errors');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Import configurations and utilities
const { connectDB } = require('./config/database');
const logger = require('./config/logger');
const { globalErrorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');
const scheduledJobService = require('./services/scheduledJobService');
const noShowSchedulerService = require('./services/noShowSchedulerService');
const systemHealthService = require('./services/systemHealthService');
const realTimeDashboardService = require('./services/realTimeDashboardService');
const errorTrackingService = require('./services/errorTrackingService');
const queryOptimizationService = require('./services/queryOptimizationService');
const queryMonitor = require('./middleware/queryMonitor');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const parkingSpaceRoutes = require('./routes/parkingSpaces');
const bookingRoutes = require('./routes/bookings');
const transactionRoutes = require('./routes/transactions');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const landlordRoutes = require('./routes/landlord');
const emailVerificationRoutes = require('./routes/emailVerification');
const vehicleRoutes = require('./routes/vehicles');
const walletRoutes = require('./routes/wallet');
const suggestedParkingRoutes = require('./routes/suggestedParkingRoutes');
const recentLocationsRoutes = require('./routes/recentLocations');
const ratingsRoutes = require('./routes/ratings');
const smsRoutes = require('./routes/sms');
const phoneVerificationRoutes = require('./routes/phoneVerification');
const idVerificationRoutes = require('./routes/idVerification');
const passwordResetRoutes = require('./routes/passwordReset');
const passwordResetWebRoutes = require('./routes/passwordResetWeb');
const serviceFeeRoutes = require('./routes/serviceFee');
const receiptRoutes = require('./routes/receipts');

// Import notification service to initialize Socket.IO
const { setIO } = require('./services/notificationService');
const realTimeTrackingService = require('./services/realTimeTrackingService');

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO for real-time features
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for Socket.IO
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },
  // Increase max listeners to prevent memory leak warnings
  maxHttpBufferSize: 1e6, // 1MB
  pingTimeout: 60000,
  pingInterval: 25000
});

// Increase max listeners for Socket.IO
io.engine.setMaxListeners(20);

// Initialize Socket.IO in notification service
setIO(io);

// Initialize real-time tracking service with Socket.IO
realTimeTrackingService.initialize(io);

// Store io instance in app for access in routes
app.set('io', io);

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for specific booking routes
  skip: (req, res) => {
    const path = req.path;
    const method = req.method;
    
    // Skip rate limiting for PUT requests to /api/v1/bookings/* 
    if (method === 'PUT' && path.match(/^\/api\/v1\/bookings\/[^\/]+\/?$/)) {
      console.log(`🚀 Rate limiting SKIPPED for: ${method} ${path}`);
      return true;
    }
    
    // Skip rate limiting for any method to /api/v1/bookings/*/location
    if (path.match(/^\/api\/v1\/bookings\/[^\/]+\/location\/?$/)) {
      console.log(`🚀 Rate limiting SKIPPED for: ${method} ${path}`);
      return true;
    }
    
    return false;
  }
});

// Apply rate limiting to all requests (except skipped routes)
app.use(limiter);

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// System health monitoring middleware (must be early in the middleware stack)
app.use(systemHealthService.createMetricsMiddleware());

// Performance monitoring middleware
app.use(errorTrackingService.createPerformanceMiddleware());

// System settings middleware - check maintenance mode
const { checkMaintenanceMode } = require('./middleware/systemSettings');
app.use(checkMaintenanceMode);

// CORS configuration - Wildcard policy for maximum compatibility
app.use(cors({
  origin: '*', // Allow all origins
  credentials: false, // Must be false when using wildcard origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use((req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    });
  }
  next();
});

// Prevent parameter pollution
app.use(hpp());

// HTTP request logger
if (env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Add detailed request logging for debugging
app.use((req, res, next) => {
  logger.info(`🌐 [REQUEST] ${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Serve static files (for password reset page)
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'ParkTayo API is running',
    timestamp: new Date().toISOString(),
    version: env.API_VERSION,
    environment: env.NODE_ENV
  });
});

// Public version check endpoint (no auth required)
const adminController = require('./controllers/adminController');
app.post(`/api/${env.API_VERSION}/admin/app-version`, adminController.checkAppVersion);

// New public version endpoint (GET, no auth required)
const publicVersionRoutes = require('./routes/publicVersion');
app.use(`/api/${env.API_VERSION}/public`, publicVersionRoutes);

// Booking expiration management routes
const bookingExpirationRoutes = require('./routes/bookingExpiration');
app.use(`/api/${env.API_VERSION}/booking-expiration`, bookingExpirationRoutes);

// API Routes
app.use(`/api/${env.API_VERSION}/auth`, authRoutes);
app.use(`/api/${env.API_VERSION}/users`, authenticateToken, userRoutes);
app.use(`/api/${env.API_VERSION}/parking-spaces`, parkingSpaceRoutes);
app.use(`/api/${env.API_VERSION}/bookings`, authenticateToken, bookingRoutes);
app.use(`/api/${env.API_VERSION}/smart-booking`, require('./routes/smartBooking'));
app.use(`/api/${env.API_VERSION}/landlord-pricing`, require('./routes/landlordPricing'));
app.use(`/api/${env.API_VERSION}/auto-selection`, require('./routes/autoSelection'));
app.use(`/api/${env.API_VERSION}/transactions`, authenticateToken, transactionRoutes);
app.use(`/api/${env.API_VERSION}/notifications`, authenticateToken, notificationRoutes);
app.use(`/api/${env.API_VERSION}/admin`, authenticateToken, adminRoutes);
app.use(`/api/${env.API_VERSION}/landlord`, authenticateToken, landlordRoutes);
app.use(`/api/${env.API_VERSION}/vehicles`, vehicleRoutes);
app.use(`/api/${env.API_VERSION}/wallet`, authenticateToken, walletRoutes);
app.use(`/api/${env.API_VERSION}/receipts`, receiptRoutes);
app.use(`/api/${env.API_VERSION}/booking-receipts`, require('./routes/bookingReceiptRoutes'));
app.use(`/api/${env.API_VERSION}/suggested-parking`, authenticateToken, suggestedParkingRoutes);
app.use(`/api/${env.API_VERSION}/recent-locations`, authenticateToken, recentLocationsRoutes);
app.use(`/api/${env.API_VERSION}/location-bookmark`, authenticateToken, require('./routes/locationBookmark'));
app.use(`/api/${env.API_VERSION}/ratings`, authenticateToken, ratingsRoutes);
app.use(`/api/${env.API_VERSION}/sms`, smsRoutes);
app.use(`/api/${env.API_VERSION}/phone-verification`, phoneVerificationRoutes);
app.use(`/api/${env.API_VERSION}/email-verification`, emailVerificationRoutes);
app.use(`/api/${env.API_VERSION}/id-verification`, idVerificationRoutes);
app.use(`/api/${env.API_VERSION}/password-reset`, passwordResetRoutes);
app.use('/', passwordResetWebRoutes); // Web-based password reset (no API prefix)
app.use(`/api/${env.API_VERSION}/service-fees`, serviceFeeRoutes);
app.use(`/api/${env.API_VERSION}/qr`, require('./routes/qrCheckout'));
app.use(`/api/${env.API_VERSION}/debug`, require('./routes/debug'));
app.use(`/api/${env.API_VERSION}/analytics`, require('./routes/analytics'));
app.use(`/api/${env.API_VERSION}/suggestions`, require('./routes/aiSuggestions'));
app.use(`/api/${env.API_VERSION}/ai`, require('./routes/aiRoutes'));
app.use(`/api/${env.API_VERSION}/admin/dynamic-pricing`, require('./routes/dynamicPricingRoutes'));
app.use(`/api/${env.API_VERSION}/places`, require('./routes/places'));
app.use(`/api/${env.API_VERSION}/legal`, require('./routes/legal'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);

  // Join user-specific room for notifications
  socket.on('join_user_room', (userId) => {
    socket.join(`user_${userId}`);
    logger.info(`User ${userId} joined their room`);
  });

  // Join landlord-specific room for booking notifications
  socket.on('join_landlord_room', (landlordId) => {
    socket.join(`landlord_${landlordId}`);
    logger.info(`Landlord ${landlordId} joined their room`);
  });

  // Join admin room for admin panel real-time updates
  socket.on('join_admin_room', () => {
    socket.join('admin_room');
    logger.info(`Admin joined admin room: ${socket.id}`);

    // Register admin client with real-time dashboard service
    realTimeDashboardService.addClient(socket);
  });

  // Handle real-time booking updates
  socket.on('booking_update', (data) => {
    // Broadcast to relevant parties
    if (data.landlordId) {
      socket.to(`landlord_${data.landlordId}`).emit('booking_notification', data);
    }
    if (data.clientId) {
      socket.to(`user_${data.clientId}`).emit('booking_status_update', data);
    }
  });

  // Handle space updates from landlords
  socket.on('space_update', (data) => {
    logger.info('Space update received:', data);
    // Notify admin room about space updates
    socket.to('admin_room').emit('space_status_update', data);
  });

  // Mark notification as read
  socket.on('mark_notification_read', (data) => {
    logger.info('Notification marked as read:', data);
    // You can add database update logic here if needed
  });

  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// 404 handler for unmatched routes
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use(globalErrorHandler);

// Database connection and server startup
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start query monitoring for performance tracking
    queryMonitor.startMonitoring();
    
    // Start server
    server.listen(env.PORT, '0.0.0.0', async () => {
      logger.info(`🚀 ParkTayo API Server running on port ${env.PORT}`);
      logger.info(`📍 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://192.168.100.154:${env.PORT}/health`);
      logger.info(`📚 API Base URL: http://192.168.100.154:${env.PORT}/api/${env.API_VERSION}`);
      
      // Start scheduled jobs
      try {
        await scheduledJobService.startAllJobs();
      } catch (error) {
        logger.error('❌ Failed to start scheduled jobs:', error);
      }

      try {
        await noShowSchedulerService.initialize();
      } catch (error) {
        logger.error('❌ Failed to initialize no-show scheduler:', error);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      scheduledJobService.stopAllJobs();
      server.close(() => {
        logger.info('Process terminated');
        // mongoose.connection.close();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received. Shutting down gracefully...');
      scheduledJobService.stopAllJobs();
      server.close(() => {
        logger.info('Process terminated');
        // mongoose.connection.close();
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = { app, server, io }; 