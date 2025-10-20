const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston about the colors
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack } = info;
    
    // If there's a stack trace, include it
    if (stack) {
      return `${timestamp} [${level}]: ${message}\n${stack}`;
    }
    
    // For regular messages
    return `${timestamp} [${level}]: ${message}`;
  })
);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
    format: format,
    handleExceptions: true,
    handleRejections: true
  })
];

// Add file transports in non-test environments
if (process.env.NODE_ENV !== 'test') {
  // Create logs directory if it doesn't exist
  const fs = require('fs');
  const logsDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // File transport for all logs
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    })
  );

  // File transport for error logs only
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  exitOnError: false,
});

// Add request logging middleware
logger.requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      ...(req.user && { userId: req.user.id }),
      ...(req.body && Object.keys(req.body).length > 0 && { 
        body: JSON.stringify(req.body).substring(0, 1000) // Limit body log size
      })
    };

    const level = res.statusCode >= 400 ? 'error' : 'info';
    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`, logData);
  });

  next();
};

// Add custom logging methods for different scenarios
logger.apiError = (message, error, req = null) => {
  const logData = {
    error: error.message,
    stack: error.stack,
    ...(req && {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      ...(req.user && { userId: req.user.id })
    })
  };
  
  logger.error(message, logData);
};

logger.booking = (action, bookingData, userId = null) => {
  logger.info(`Booking ${action}`, {
    action,
    bookingId: bookingData.id || bookingData._id,
    userId,
    status: bookingData.status,
    parkingSpaceId: bookingData.parkingSpaceId,
    timestamp: new Date().toISOString()
  });
};

logger.payment = (action, paymentData, userId = null) => {
  logger.info(`Payment ${action}`, {
    action,
    transactionId: paymentData.id || paymentData._id,
    userId,
    amount: paymentData.amount,
    method: paymentData.method,
    status: paymentData.status,
    timestamp: new Date().toISOString()
  });
};

logger.security = (event, details, req = null) => {
  logger.warn(`Security Event: ${event}`, {
    event,
    details,
    ...(req && {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl,
      method: req.method
    }),
    timestamp: new Date().toISOString()
  });
};

// Override console methods in development for better logging
if (process.env.NODE_ENV === 'development') {
  console.log = (...args) => logger.info(args.join(' '));
  console.error = (...args) => logger.error(args.join(' '));
  console.warn = (...args) => logger.warn(args.join(' '));
  console.info = (...args) => logger.info(args.join(' '));
}

module.exports = logger; 