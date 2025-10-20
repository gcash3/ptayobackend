const nodemailer = require('nodemailer');
const logger = require('../config/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialize();
  }

  initialize() {
    try {
      // Use SMTP credentials from .env.test
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'jdevoto.cl',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER || 'manager@jdevoto.cl',
          pass: process.env.SMTP_PASS || 'l!KaPp9--^/b=',
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      logger.info('📧 Email service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
    }
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const mailOptions = {
        from: `"ParkTayo" <${process.env.SMTP_USER || 'manager@jdevoto.cl'}>`,
        to,
        subject,
        html,
        text
      };

      logger.info('📧 Sending email', {
        to,
        subject,
        timestamp: new Date().toISOString()
      });

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info('✅ Email sent successfully', {
        to,
        messageId: result.messageId,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        messageId: result.messageId,
        message: 'Email sent successfully'
      };
    } catch (error) {
      logger.error('📧 Email sending failed:', {
        to,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        error: error.message,
        message: 'Failed to send email'
      };
    }
  }

  async sendEmailVerification(email, verificationCode, firstName) {
    const subject = 'ParkTayo - Email Verification';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification - ParkTayo</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 0;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, #5523C6, #7B4AE2);
            color: white;
            padding: 40px 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 800;
          }
          .content {
            padding: 40px 30px;
            text-align: center;
          }
          .verification-code {
            background: linear-gradient(135deg, #B794F4, #8B5CF6);
            color: white;
            font-size: 32px;
            font-weight: bold;
            padding: 20px;
            border-radius: 12px;
            margin: 30px 0;
            letter-spacing: 8px;
            display: inline-block;
            min-width: 200px;
          }
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #666;
          }
          .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            border-radius: 0 0 8px 8px;
            font-size: 14px;
            color: #666;
          }
          @media (max-width: 600px) {
            .container {
              margin: 10px;
              border-radius: 0;
            }
            .header, .content, .footer {
              padding-left: 20px;
              padding-right: 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🅿️ ParkTayo</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px;">Email Verification</p>
          </div>
          
          <div class="content">
            <h2>Hello ${firstName}! 👋</h2>
            <p class="message">
              To complete your account verification and enhance security, please enter the following 6-digit code in the ParkTayo app:
            </p>
            
            <div class="verification-code">
              ${verificationCode}
            </div>
            
            <p class="message">
              This code will expire in <strong>10 minutes</strong> for security purposes.
            </p>
            
            <div class="warning">
              <strong>🔒 Security Notice:</strong> Never share this code with anyone. ParkTayo will never ask for this code via phone or email.
            </div>
          </div>
          
          <div class="footer">
            <p>If you didn't request this verification, please ignore this email.</p>
            <p>© 2024 ParkTayo. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
ParkTayo - Email Verification

Hello ${firstName}!

To complete your account verification, please enter the following 6-digit code in the ParkTayo app:

${verificationCode}

This code will expire in 10 minutes for security purposes.

If you didn't request this verification, please ignore this email.

© 2024 ParkTayo. All rights reserved.
    `;

    return await this.sendEmail({
      to: email,
      subject,
      html,
      text
    });
  }

  async sendClientPasswordReset(email, resetToken, firstName) {
    const backendUrl = process.env.BACKEND_URL || 'https://api.parktayo.com';
    const resetUrl = `${backendUrl}/reset-password?token=${resetToken}`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your ParkTayo Password</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #5E35B1, #7E57C2);
                margin: 0;
                padding: 20px;
                color: #333;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #5E35B1, #7E57C2);
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
                text-align: center;
            }
            .title {
                font-size: 24px;
                font-weight: bold;
                color: #5E35B1;
                margin-bottom: 20px;
            }
            .message {
                font-size: 16px;
                line-height: 1.6;
                color: #666;
                margin-bottom: 30px;
            }
            .reset-button {
                display: inline-block;
                background: linear-gradient(135deg, #5E35B1, #7E57C2);
                color: white;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 25px;
                font-size: 16px;
                font-weight: bold;
                margin: 20px 0;
                box-shadow: 0 4px 15px rgba(94, 53, 177, 0.3);
                transition: transform 0.2s;
            }
            .reset-button:hover {
                transform: translateY(-2px);
            }
            .warning {
                background: #FFF3E0;
                border-left: 4px solid #FF9800;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
                text-align: left;
            }
            .footer {
                background: #f8f9fa;
                padding: 20px 30px;
                text-align: center;
                color: #666;
                font-size: 14px;
                border-top: 1px solid #eee;
            }
            .alternative-link {
                word-break: break-all;
                background: #f5f5f5;
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                font-family: monospace;
                font-size: 12px;
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
                <h2 class="title">Hello ${firstName}!</h2>
                
                <p class="message">
                    We received a request to reset your ParkTayo password. No worries, it happens to the best of us!
                </p>
                
                <p class="message">
                    Click the button below to securely reset your password:
                </p>
                
                <a href="${resetUrl}" class="reset-button">
                    🔐 Reset My Password
                </a>
                
                <div class="warning">
                    <strong>⚠️ Important Security Information:</strong>
                    <ul style="margin: 10px 0 0; padding-left: 20px;">
                        <li>This link will expire in <strong>10 minutes</strong> for your security</li>
                        <li>If you didn't request this reset, please ignore this email</li>
                        <li>Never share this link with anyone</li>
                    </ul>
                </div>
                
                <p style="color: #999; font-size: 14px; margin-top: 30px;">
                    If the button doesn't work, copy and paste this link into your browser:
                </p>
                <div class="alternative-link">
                    ${resetUrl}
                </div>
            </div>
            
            <div class="footer">
                <p><strong>ParkTayo</strong> - Your Trusted Parking Solution</p>
                <p>University Belt, Manila, Philippines</p>
                <p>If you have any questions, contact our support team.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const text = `
    Reset Your ParkTayo Password
    
    Hello ${firstName}!
    
    We received a request to reset your ParkTayo password.
    
    Please click the following link to reset your password:
    ${resetUrl}
    
    This link will expire in 10 minutes for your security.
    
    If you didn't request this password reset, please ignore this email.
    
    Best regards,
    The ParkTayo Team
    `;

    return await this.sendEmail({
      to: email,
      subject: '🔐 Reset Your ParkTayo Password',
      html,
      text
    });
  }

  async sendPasswordResetCode(email, resetCode, firstName) {
    const subject = 'ParkTayo - Password Reset Code';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - ParkTayo</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 0;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, #5523C6, #7B4AE2);
            color: white;
            padding: 40px 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 800;
          }
          .content {
            padding: 40px 30px;
            text-align: center;
          }
          .reset-code {
            background: linear-gradient(135deg, #EF4444, #F87171);
            color: white;
            font-size: 32px;
            font-weight: bold;
            padding: 20px;
            border-radius: 12px;
            margin: 30px 0;
            letter-spacing: 8px;
            display: inline-block;
            min-width: 200px;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
          }
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #666;
          }
          .warning {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
            color: #dc2626;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            border-radius: 0 0 8px 8px;
            font-size: 14px;
            color: #666;
          }
          .security-notice {
            background-color: #f0f9ff;
            border: 1px solid #7dd3fc;
            color: #0369a1;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
          }
          @media (max-width: 600px) {
            .container {
              margin: 10px;
              border-radius: 0;
            }
            .header, .content, .footer {
              padding-left: 20px;
              padding-right: 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🅿️ ParkTayo</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px;">🔐 Password Reset</p>
          </div>
          
          <div class="content">
            <h2>Hello ${firstName}! 👋</h2>
            <p class="message">
              We received a request to reset your password for your ParkTayo landlord account. Use the following 6-digit code to reset your password:
            </p>
            
            <div class="reset-code">
              ${resetCode}
            </div>
            
            <p class="message">
              This code will expire in <strong>10 minutes</strong> for security purposes.
            </p>
            
            <div class="security-notice">
              <strong>🔒 Security Notice:</strong> 
              <ul style="text-align: left; margin: 10px 0;">
                <li>Never share this code with anyone</li>
                <li>ParkTayo will never ask for this code via phone or email</li>
                <li>If you didn't request this reset, your account is still secure</li>
              </ul>
            </div>
            
            <div class="warning">
              <strong>⚠️ Important:</strong> If you didn't request this password reset, please ignore this email and consider changing your password for added security.
            </div>
          </div>
          
          <div class="footer">
            <p>This reset code was requested from your ParkTayo landlord account.</p>
            <p>© 2024 ParkTayo. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
ParkTayo - Password Reset Code

Hello ${firstName}!

We received a request to reset your password for your ParkTayo landlord account. Use the following 6-digit code to reset your password:

${resetCode}

This code will expire in 10 minutes for security purposes.

Security Notice:
- Never share this code with anyone
- ParkTayo will never ask for this code via phone or email
- If you didn't request this reset, your account is still secure

If you didn't request this password reset, please ignore this email and consider changing your password for added security.

© 2024 ParkTayo. All rights reserved.
    `;

    return await this.sendEmail({
      to: email,
      subject,
      html,
      text
    });
  }

  /**
   * Send receipt email with HTML content
   */
  async sendReceiptEmail({ to, subject, customerName, receiptHTML, receiptData }) {
    try {
      const textContent = `
ParkTayo Parking Receipt

Receipt Number: ${receiptData.receiptNumber}
Date: ${receiptData.receiptDate}

Dear ${customerName},

Thank you for using ParkTayo! Your parking session has been completed.

Booking Details:
- Booking ID: ${receiptData.bookingId}
- Parking Space: ${receiptData.parkingSpaceName}
- Duration: ${receiptData.duration} hours
- Total Amount: ₱${receiptData.totalAmount}

Payment Information:
- Payment Method: ${receiptData.paymentMethod}
- Payment Status: ${receiptData.paymentStatus}
- Transaction ID: ${receiptData.transactionId}

This is an automated receipt. Please keep this for your records.

Thank you for choosing ParkTayo!

For support: support@parktayo.com
Visit: www.parktayo.com
      `;

      return await this.sendEmail({
        to,
        subject,
        html: receiptHTML,
        text: textContent
      });

    } catch (error) {
      logger.error('❌ Failed to send receipt email:', error);
      return { success: false, error: error.message };
    }
  }

  // Test email connectivity
  async testConnection() {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      await this.transporter.verify();
      logger.info('✅ Email service connection verified');
      return { success: true, message: 'Email service connection verified' };
    } catch (error) {
      logger.error('❌ Email service connection failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
