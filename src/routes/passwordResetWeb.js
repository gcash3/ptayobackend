const express = require('express');
const router = express.Router();
const User = require('../models/User');
const crypto = require('crypto');
const logger = require('../config/logger');
const { catchAsync, AppError } = require('../middleware/errorHandler');

// GET route to display reset password form
router.get('/reset-password', catchAsync(async (req, res, next) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invalid Reset Link - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Invalid Reset Link</h1>
          <p>The password reset link is invalid or missing. Please request a new password reset from the ParkTayo app.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Verify token is valid
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Expired Reset Link - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⏰ Reset Link Expired</h1>
          <p>This password reset link has expired. Please request a new password reset from the ParkTayo app.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Show password reset form
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Reset Your ParkTayo Password</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #4527A0, #7E57C2);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                max-width: 500px;
                width: 100%;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #4527A0, #7E57C2);
                padding: 40px 30px;
                text-align: center;
                color: white;
            }
            .logo {
                width: 80px;
                height: 80px;
                background: rgba(255,255,255,0.2);
                border-radius: 50%;
                margin: 0 auto 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 36px;
                font-weight: bold;
            }
            .content {
                padding: 40px 30px;
            }
            .title {
                font-size: 24px;
                font-weight: bold;
                color: #4527A0;
                margin-bottom: 10px;
                text-align: center;
            }
            .subtitle {
                color: #666;
                text-align: center;
                margin-bottom: 30px;
                line-height: 1.4;
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #333;
                font-weight: 500;
            }
            .form-group input {
                width: 100%;
                padding: 15px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                font-size: 16px;
                transition: border-color 0.3s;
            }
            .form-group input:focus {
                outline: none;
                border-color: #7E57C2;
            }
            .reset-button {
                width: 100%;
                background: linear-gradient(135deg, #4527A0, #7E57C2);
                color: white;
                border: none;
                padding: 16px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: transform 0.2s;
            }
            .reset-button:hover {
                transform: translateY(-2px);
            }
            .footer {
                padding: 20px 30px;
                text-align: center;
                background: #f8f9fa;
                border-top: 1px solid #eee;
                color: #666;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🅿️</div>
                <h1 style="margin: 0; font-size: 28px;">ParkTayo</h1>
                <p style="margin: 10px 0 0; opacity: 0.9;">Reset Your Password</p>
            </div>
            
            <div class="content">
                <h2 class="title">Create New Password</h2>
                <p class="subtitle">Please enter your new password below. Password must be at least 8 characters long.</p>
                
                <form method="POST" action="/reset-password" accept-charset="UTF-8" enctype="application/x-www-form-urlencoded">
                    <input type="hidden" name="token" value="${token}">
                    
                    <div class="form-group">
                        <label for="password">New Password (min 8 characters)</label>
                        <input type="password" id="password" name="password" required minlength="8">
                    </div>
                    
                    <div class="form-group">
                        <label for="confirmPassword">Confirm New Password</label>
                        <input type="password" id="confirmPassword" name="confirmPassword" required minlength="8">
                    </div>
                    
                    <button type="submit" class="reset-button">
                        Reset Password
                    </button>
                </form>
            </div>
            
            <div class="footer">
                <p><strong>ParkTayo</strong> - Your Trusted Parking Solution</p>
                <p>University Belt, Manila, Philippines</p>
            </div>
        </div>
    </body>
    </html>
  `);
}));

// POST route to handle password reset form submission
router.post('/reset-password', catchAsync(async (req, res, next) => {
  const { token, password, confirmPassword } = req.body;

  // Basic validation
  if (!token || !password || !confirmPassword) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password Error - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
          .back-button { margin-top: 20px; padding: 10px 20px; background: #4527A0; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Invalid Request</h1>
          <p>All fields are required. Please try again.</p>
          <a href="/reset-password?token=${token}" class="back-button">Go Back</a>
        </div>
      </body>
      </html>
    `);
  }

  if (password !== confirmPassword) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password Error - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
          .back-button { margin-top: 20px; padding: 10px 20px; background: #4527A0; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Passwords Don't Match</h1>
          <p>The passwords you entered do not match. Please try again.</p>
          <a href="/reset-password?token=${token}" class="back-button">Go Back</a>
        </div>
      </body>
      </html>
    `);
  }

  if (password.length < 8) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password Error - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
          .back-button { margin-top: 20px; padding: 10px 20px; background: #4527A0; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Password Too Short</h1>
          <p>Password must be at least 8 characters long.</p>
          <a href="/reset-password?token=${token}" class="back-button">Go Back</a>
        </div>
      </body>
      </html>
    `);
  }

  // Hash the token to find user
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password Error - ParkTayo</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #4527A0, #7E57C2); color: white; }
          .container { background: white; color: black; padding: 40px; border-radius: 16px; max-width: 500px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⏰ Token Expired</h1>
          <p>This password reset token has expired or is invalid. Please request a new password reset from the ParkTayo app.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Update user password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  logger.info('Password reset successful via web form', {
    userId: user._id,
    email: user.email
  });

  // Show success page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Password Reset Successful - ParkTayo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #4527A0, #7E57C2);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                max-width: 500px;
                width: 100%;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                overflow: hidden;
                text-align: center;
            }
            .header {
                background: linear-gradient(135deg, #4527A0, #7E57C2);
                padding: 40px 30px;
                color: white;
            }
            .content {
                padding: 40px 30px;
            }
            .success-icon {
                font-size: 64px;
                color: #4CAF50;
                margin-bottom: 20px;
            }
            .title {
                font-size: 24px;
                font-weight: bold;
                color: #4527A0;
                margin-bottom: 15px;
            }
            .message {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
            }
            .footer {
                padding: 20px 30px;
                background: #f8f9fa;
                border-top: 1px solid #eee;
                color: #666;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin: 0; font-size: 28px;">🅿️ ParkTayo</h1>
                <p style="margin: 10px 0 0; opacity: 0.9;">Password Reset</p>
            </div>
            
            <div class="content">
                <div class="success-icon">✅</div>
                <h2 class="title">Password Reset Successful!</h2>
                <p class="message">
                    Your password has been successfully updated. You can now sign in to the ParkTayo app with your new password.
                </p>
                <p class="message">
                    <strong>You can now close this page and return to the ParkTayo app.</strong>
                </p>
            </div>
            
            <div class="footer">
                <p><strong>ParkTayo</strong> - Your Trusted Parking Solution</p>
                <p>University Belt, Manila, Philippines</p>
            </div>
        </div>
    </body>
    </html>
  `);
}));

module.exports = router;
