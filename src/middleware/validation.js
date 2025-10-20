const { validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

const validateRequest = (req, res, next) => {
  console.log('🔍 DEBUG: Validating request body:', JSON.stringify(req.body, null, 2));
  
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    console.log('❌ DEBUG: Validation errors:', JSON.stringify(errors.array(), null, 2));
    const errorMessages = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));
    
    const firstError = errors.array()[0];
    return next(new AppError(`Validation Error: ${firstError.msg}`, 400, errorMessages));
  }
  
  next();
};

module.exports = {
  validateRequest
}; 