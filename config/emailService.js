// config/emailService.js
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Create transporter based on environment configuration
const createTransporter = () => {
  // Check if custom SMTP settings are provided
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Gmail configuration (default)
  if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });
  }

  // Outlook/Hotmail configuration
  if (
    (process.env.EMAIL_USER && process.env.EMAIL_USER.includes("outlook")) ||
    process.env.EMAIL_USER.includes("hotmail")
  ) {
    return nodemailer.createTransport({
      service: "hotmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_APP_PASSWORD,
      },
    });
  }

  throw new Error(
    "Email configuration not found. Please set EMAIL_USER and EMAIL_APP_PASSWORD or SMTP settings in your environment variables."
  );
};

// Generate secure verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// Email template wrapper
const createEmailTemplate = (title, content, buttonUrl, buttonText) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333333;
          background-color: #f8f9fa;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 {
          font-size: 28px;
          font-weight: 600;
          margin: 0;
        }
        .content {
          padding: 40px 30px;
        }
        .content h2 {
          color: #333333;
          font-size: 24px;
          margin-bottom: 20px;
          font-weight: 600;
        }
        .content p {
          margin-bottom: 20px;
          font-size: 16px;
          line-height: 1.8;
          color: #555555;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 16px 32px;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s ease;
        }
        .button:hover {
          transform: translateY(-2px);
        }
        .link-box {
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          padding: 20px;
          margin: 25px 0;
          word-break: break-all;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          color: #495057;
        }
        .alert {
          background: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 8px;
          padding: 20px;
          margin: 25px 0;
          border-left: 4px solid #f39c12;
        }
        .alert-success {
          background: #d4edda;
          border: 1px solid #c3e6cb;
          border-left: 4px solid #28a745;
        }
        .alert p {
          margin: 0;
          color: #856404;
        }
        .alert-success p {
          color: #155724;
        }
        .footer {
          background: #f8f9fa;
          padding: 30px;
          text-align: center;
          border-top: 1px solid #e9ecef;
        }
        .footer p {
          font-size: 14px;
          color: #6c757d;
          margin: 0;
        }
        .divider {
          height: 1px;
          background: #e9ecef;
          margin: 30px 0;
          border: none;
        }
        .feature-list {
          margin: 25px 0;
        }
        .feature-list li {
          margin-bottom: 10px;
          padding-left: 25px;
          position: relative;
          color: #555555;
        }
        .feature-list li:before {
          content: "✓";
          position: absolute;
          left: 0;
          color: #28a745;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div style="padding: 20px;">
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
          </div>
          <div class="content">
            ${content}
            ${
              buttonUrl && buttonText
                ? `
              <div class="button-container">
                <a href="${buttonUrl}" class="button">${buttonText}</a>
              </div>
            `
                : ""
            }
          </div>
          <div class="footer">
            <p>
              This email was sent by CRS Platform. If you have any questions, please contact our support team.
              <br>
              <strong>CRS Platform</strong> - Secure Communication Solutions
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Send verification email
const sendVerificationEmail = async (email, verificationToken, username) => {
  try {
    console.log(`📧 Preparing verification email for ${email}...`);

    const transporter = createTransporter();
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const emailContent = `
      <h2>Hi ${username}!</h2>
      <p>Welcome to CRS Platform! We're excited to have you join our secure communication platform.</p>
      <p>To complete your registration and start using your account, please verify your email address by clicking the button below:</p>
      <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
      <div class="link-box">${verificationUrl}</div>
      <div class="alert">
        <p><strong>⏰ Important:</strong> This verification link will expire in 24 hours for security reasons.</p>
      </div>
      <p>If you didn't create an account with CRS Platform, please ignore this email and no further action is required.</p>
      <div class="divider"></div>
      <p><strong>What's next after verification?</strong></p>
      <ul class="feature-list">
        <li>Complete your profile setup</li>
        <li>Upload your encryption cards</li>
        <li>Configure your device settings</li>
        <li>Start using secure messaging</li>
      </ul>
    `;

    const htmlContent = createEmailTemplate(
      "Verify Your Email - CRS Platform",
      emailContent,
      verificationUrl,
      "Verify Email Address"
    );

    const textContent = `
Welcome to CRS Platform!

Hi ${username},

Thank you for registering with CRS Platform. To complete your registration and start using your account, please verify your email address by visiting this link:

${verificationUrl}

Important: This verification link will expire in 24 hours for security reasons.

If you didn't create an account with CRS Platform, please ignore this email.

What's next after verification?
• Complete your profile setup
• Upload your encryption cards  
• Configure your device settings
• Start using secure messaging

Best regards,
The CRS Platform Team

---
CRS Platform - Secure Communication Solutions
    `;

    const mailOptions = {
      from: {
        name: "CRS Platform",
        address: process.env.EMAIL_USER,
      },
      to: email,
      subject: "Welcome to CRS Platform - Verify Your Email Address",
      html: htmlContent,
      text: textContent,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Verification email sent successfully to ${email}`);
    console.log(`📬 Message ID: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending verification email:", error);

    // Provide specific error messages for common issues
    if (error.code === "EAUTH") {
      throw new Error(
        "Email authentication failed. Please check your email credentials."
      );
    } else if (error.code === "ENOTFOUND") {
      throw new Error(
        "Email server not found. Please check your SMTP settings."
      );
    } else if (error.code === "ECONNECTION") {
      throw new Error(
        "Failed to connect to email server. Please check your internet connection."
      );
    } else {
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }
};

// Send welcome email after successful verification
const sendWelcomeEmail = async (email, username) => {
  try {
    console.log(`🎉 Preparing welcome email for ${email}...`);

    const transporter = createTransporter();
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;

    const emailContent = `
      <h2>Hi ${username}! 🎉</h2>
      <div class="alert alert-success">
        <p><strong>✅ Email Verified Successfully!</strong> Your account is now active and ready to use.</p>
      </div>
      <p>Welcome to CRS Platform! Your email has been verified and your account is now fully activated. You can now access all features of our secure communication platform.</p>
      
      <div class="divider"></div>
      
      <h3 style="color: #333; margin-bottom: 15px;">🚀 Getting Started Guide</h3>
      <ul class="feature-list">
        <li><strong>Login to your account</strong> - Use your credentials to access the platform</li>
        <li><strong>Complete your profile</strong> - Add additional information to personalize your experience</li>
        <li><strong>Upload encryption cards</strong> - Secure your communications with your encryption files</li>
        <li><strong>Configure device settings</strong> - Set up your devices for optimal security</li>
        <li><strong>Explore features</strong> - Discover secure messaging and other platform capabilities</li>
      </ul>
      
      <div class="divider"></div>
      
      <p><strong>Need help getting started?</strong></p>
      <p>Our support team is here to help! Feel free to reach out if you have any questions about using CRS Platform.</p>
      
      <p>Thank you for choosing CRS Platform for your secure communication needs. We're excited to have you as part of our community!</p>
    `;

    const htmlContent = createEmailTemplate(
      "Welcome to CRS Platform! 🎉",
      emailContent,
      loginUrl,
      "Login to Your Account"
    );

    const textContent = `
Welcome to CRS Platform!

Hi ${username}!

✅ Email Verified Successfully! Your account is now active and ready to use.

Welcome to CRS Platform! Your email has been verified and your account is now fully activated. You can now access all features of our secure communication platform.

🚀 Getting Started Guide:
• Login to your account - Use your credentials to access the platform
• Complete your profile - Add additional information to personalize your experience  
• Upload encryption cards - Secure your communications with your encryption files
• Configure device settings - Set up your devices for optimal security
• Explore features - Discover secure messaging and other platform capabilities

Login here: ${loginUrl}

Need help getting started?
Our support team is here to help! Feel free to reach out if you have any questions about using CRS Platform.

Thank you for choosing CRS Platform for your secure communication needs. We're excited to have you as part of our community!

Best regards,
The CRS Platform Team

---
CRS Platform - Secure Communication Solutions
    `;

    const mailOptions = {
      from: {
        name: "CRS Platform",
        address: process.env.EMAIL_USER,
      },
      to: email,
      subject: "🎉 Welcome to CRS Platform - Account Activated!",
      html: htmlContent,
      text: textContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent successfully to ${email}`);
    console.log(`📬 Message ID: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending welcome email:", error);
    // Don't throw error for welcome email as it's not critical for the flow
    return {
      success: false,
      error: error.message,
      email: email,
    };
  }
};

// Send password reset email (bonus feature)
const sendPasswordResetEmail = async (email, resetToken, username) => {
  try {
    console.log(`🔐 Preparing password reset email for ${email}...`);

    const transporter = createTransporter();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const emailContent = `
      <h2>Hi ${username},</h2>
      <p>We received a request to reset your password for your CRS Platform account.</p>
      <p>If you requested this password reset, click the button below to set a new password:</p>
      <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
      <div class="link-box">${resetUrl}</div>
      <div class="alert">
        <p><strong>⏰ Important:</strong> This password reset link will expire in 1 hour for security reasons.</p>
      </div>
      <p><strong>If you didn't request this password reset:</strong></p>
      <p>Please ignore this email. Your password will remain unchanged. If you're concerned about your account security, please contact our support team.</p>
      <div class="divider"></div>
      <p><strong>Security Tip:</strong> Always use a strong, unique password for your CRS Platform account.</p>
    `;

    const htmlContent = createEmailTemplate(
      "Reset Your Password - CRS Platform",
      emailContent,
      resetUrl,
      "Reset Password"
    );

    const textContent = `
Password Reset Request - CRS Platform

Hi ${username},

We received a request to reset your password for your CRS Platform account.

If you requested this password reset, visit this link to set a new password:
${resetUrl}

Important: This password reset link will expire in 1 hour for security reasons.

If you didn't request this password reset:
Please ignore this email. Your password will remain unchanged. If you're concerned about your account security, please contact our support team.

Security Tip: Always use a strong, unique password for your CRS Platform account.

Best regards,
The CRS Platform Team

---
CRS Platform - Secure Communication Solutions
    `;

    const mailOptions = {
      from: {
        name: "CRS Platform",
        address: process.env.EMAIL_USER,
      },
      to: email,
      subject: "Reset Your Password - CRS Platform",
      html: htmlContent,
      text: textContent,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent successfully to ${email}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending password reset email:", error);
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
};

// Test email configuration
const testEmailConfiguration = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log("✅ Email configuration is valid");
    return true;
  } catch (error) {
    console.error("❌ Email configuration test failed:", error);
    return false;
  }
};

module.exports = {
  generateVerificationToken,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  testEmailConfiguration,
  createTransporter,
};
