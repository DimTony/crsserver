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

const sendSubscriptionQueuedEmail = async (
  email,
  username,
  plan,
  queuePosition
) => {
  try {
    console.log(`📧 Preparing subscription queued email for ${email}...`);

    const transporter = createTransporter();
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;

    const emailContent = `
        <h2>Hi ${username}! 📋</h2>
        <div class="alert alert-success">
          <p><strong>✅ Subscription Request Submitted Successfully!</strong></p>
        </div>
        <p>Thank you for submitting your <strong>${plan}</strong> subscription request. Your application has been received and is now in our review queue.</p>
        
        <div class="alert">
          <p><strong>📍 Your Queue Position:</strong> #${queuePosition}</p>
          <p><strong>⏱️ Estimated Review Time:</strong> 2-3 business days</p>
        </div>
        
        <h3 style="color: #333; margin-bottom: 15px;">📋 What Happens Next?</h3>
        <ul class="feature-list">
          <li><strong>Document Review</strong> - Our team will review your uploaded encryption cards</li>
          <li><strong>Verification Process</strong> - We'll verify your account details and subscription requirements</li>
          <li><strong>Approval Notification</strong> - You'll receive an email when your subscription is approved</li>
          <li><strong>Activation Setup</strong> - Set up your authenticator and activate your subscription</li>
        </ul>
        
        <div class="divider"></div>
        
        <h3 style="color: #333; margin-bottom: 15px;">📱 Required for Activation</h3>
        <p>Once approved, you'll need to set up one of these authenticators to activate your subscription:</p>
        <ul class="feature-list">
          <li><strong>Google Authenticator</strong> - Free mobile app</li>
          <li><strong>Microsoft Authenticator</strong> - Enterprise-grade security</li>
          <li><strong>Entrust IdentityGuard</strong> - Professional authentication</li>
        </ul>
        
        <p><strong>Important:</strong> Please ensure your email address is verified before your subscription is approved. Check your inbox for the email verification link if you haven't already confirmed your email.</p>
        
        <p>You can check the status of your subscription request anytime in your dashboard.</p>
      `;

    const htmlContent = createEmailTemplate(
      "Subscription Request Queued - CRS Platform",
      emailContent,
      dashboardUrl,
      "View Dashboard"
    );

    const textContent = `
  Subscription Request Submitted - CRS Platform
  
  Hi ${username},
  
  Thank you for submitting your ${plan} subscription request. Your application has been received and is now in our review queue.
  
  Queue Position: #${queuePosition}
  Estimated Review Time: 2-3 business days
  
  What Happens Next:
  • Document Review - Our team will review your uploaded encryption cards
  • Verification Process - We'll verify your account details and subscription requirements  
  • Approval Notification - You'll receive an email when your subscription is approved
  • Activation Setup - Set up your authenticator and activate your subscription
  
  Required for Activation:
  Once approved, you'll need to set up one of these authenticators:
  • Google Authenticator - Free mobile app
  • Microsoft Authenticator - Enterprise-grade security
  • Entrust IdentityGuard - Professional authentication
  
  Important: Please ensure your email address is verified before your subscription is approved.
  
  You can check the status of your subscription request anytime in your dashboard: ${dashboardUrl}
  
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
      subject: "Subscription Request Received - CRS Platform",
      html: htmlContent,
      text: textContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Subscription queued email sent successfully to ${email}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending subscription queued email:", error);
    throw new Error(
      `Failed to send subscription queued email: ${error.message}`
    );
  }
};

// Send subscription approved email
const sendSubscriptionApprovedEmail = async (
  email,
  username,
  plan,
  activationToken
) => {
  try {
    console.log(`🎉 Preparing subscription approved email for ${email}...`);

    const transporter = createTransporter();
    const activationUrl = `${process.env.FRONTEND_URL}/activate-subscription?token=${activationToken}`;

    const emailContent = `
        <h2>Hi ${username}! 🎉</h2>
        <div class="alert alert-success">
          <p><strong>✅ Subscription Approved!</strong> Your ${plan} subscription has been approved by our admin team.</p>
        </div>
        <p>Great news! Your subscription request has been reviewed and approved. You can now activate your subscription to start using CRS Platform's secure communication features.</p>
        
        <div class="alert">
          <p><strong>⏰ Important:</strong> You have 7 days to activate your subscription using the link below.</p>
        </div>
        
        <h3 style="color: #333; margin-bottom: 15px;">🔐 Activation Requirements</h3>
        <p>Before clicking the activation link, please ensure you have one of these authenticators ready:</p>
        <ul class="feature-list">
          <li><strong>Google Authenticator</strong> - Download from App Store/Google Play</li>
          <li><strong>Microsoft Authenticator</strong> - Enterprise authentication app</li>
          <li><strong>Entrust IdentityGuard</strong> - Professional security solution</li>
        </ul>
        
        <div class="divider"></div>
        
        <h3 style="color: #333; margin-bottom: 15px;">📱 Activation Steps</h3>
        <ul class="feature-list">
          <li><strong>Step 1:</strong> Set up your chosen authenticator app</li>
          <li><strong>Step 2:</strong> Click the activation link below</li>
          <li><strong>Step 3:</strong> Select your authenticator provider</li>
          <li><strong>Step 4:</strong> Enter the authentication code</li>
          <li><strong>Step 5:</strong> Start using your secure subscription!</li>
        </ul>
        
        <p>If you encounter any issues during activation, please contact our support team immediately.</p>
        
        <p>Thank you for choosing CRS Platform for your secure communication needs!</p>
      `;

    const htmlContent = createEmailTemplate(
      "Subscription Approved - Ready to Activate!",
      emailContent,
      activationUrl,
      "Activate Subscription"
    );

    const textContent = `
  Subscription Approved - CRS Platform
  
  Hi ${username}!
  
  Great news! Your ${plan} subscription request has been reviewed and approved. You can now activate your subscription to start using CRS Platform's secure communication features.
  
  Important: You have 7 days to activate your subscription using the link below.
  
  Activation Requirements:
  Before activating, please ensure you have one of these authenticators ready:
  • Google Authenticator - Download from App Store/Google Play
  • Microsoft Authenticator - Enterprise authentication app
  • Entrust IdentityGuard - Professional security solution
  
  Activation Steps:
  1. Set up your chosen authenticator app
  2. Click the activation link: ${activationUrl}
  3. Select your authenticator provider
  4. Enter the authentication code
  5. Start using your secure subscription!
  
  If you encounter any issues during activation, please contact our support team immediately.
  
  Thank you for choosing CRS Platform for your secure communication needs!
  
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
      subject: "🎉 Subscription Approved - Ready to Activate!",
      html: htmlContent,
      text: textContent,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Subscription approved email sent successfully to ${email}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending subscription approved email:", error);
    throw new Error(
      `Failed to send subscription approved email: ${error.message}`
    );
  }
};

// Send subscription rejected email
const sendSubscriptionRejectedEmail = async (
  email,
  username,
  plan,
  reason,
  comments
) => {
  try {
    console.log(`📧 Preparing subscription rejected email for ${email}...`);

    const transporter = createTransporter();
    const supportUrl = `${process.env.FRONTEND_URL}/support`;
    const resubmitUrl = `${process.env.FRONTEND_URL}/register`;

    const emailContent = `
        <h2>Hi ${username},</h2>
        <div class="alert">
          <p><strong>⚠️ Subscription Request Update</strong></p>
        </div>
        <p>We have reviewed your <strong>${plan}</strong> subscription request and unfortunately cannot approve it at this time.</p>
        
        <div class="alert">
          <p><strong>Reason for rejection:</strong> ${reason}</p>
          ${
            comments
              ? `<p><strong>Additional comments:</strong> ${comments}</p>`
              : ""
          }
        </div>
        
        <h3 style="color: #333; margin-bottom: 15px;">📋 Next Steps</h3>
        <ul class="feature-list">
          <li><strong>Review the feedback</strong> - Please review the reason provided above</li>
          <li><strong>Address the issues</strong> - Make necessary corrections to your documentation</li>
          <li><strong>Resubmit if appropriate</strong> - You can submit a new application once issues are resolved</li>
          <li><strong>Contact support</strong> - Reach out if you need clarification on the rejection</li>
        </ul>
        
        <div class="divider"></div>
        
        <h3 style="color: #333; margin-bottom: 15px;">🔄 Resubmission Guidelines</h3>
        <p>If you choose to resubmit your application, please ensure:</p>
        <ul class="feature-list">
          <li>All encryption cards are clear and readable</li>
          <li>Documents meet our security requirements</li>
          <li>All required information is complete and accurate</li>
          <li>Any specific issues mentioned above are addressed</li>
        </ul>
        
        <p>We apologize for any inconvenience and appreciate your understanding. Our security standards help ensure the safety and reliability of the CRS Platform for all users.</p>
        
        <p>If you have questions about this decision or need assistance with resubmission, please don't hesitate to contact our support team.</p>
      `;

    const htmlContent = createEmailTemplate(
      "Subscription Request Update - CRS Platform",
      emailContent,
      supportUrl,
      "Contact Support"
    );

    const textContent = `
  Subscription Request Update - CRS Platform
  
  Hi ${username},
  
  We have reviewed your ${plan} subscription request and unfortunately cannot approve it at this time.
  
  Reason for rejection: ${reason}
  ${comments ? `Additional comments: ${comments}` : ""}
  
  Next Steps:
  • Review the feedback - Please review the reason provided above
  • Address the issues - Make necessary corrections to your documentation
  • Resubmit if appropriate - You can submit a new application once issues are resolved
  • Contact support - Reach out if you need clarification on the rejection
  
  Resubmission Guidelines:
  If you choose to resubmit your application, please ensure:
  • All encryption cards are clear and readable
  • Documents meet our security requirements
  • All required information is complete and accurate
  • Any specific issues mentioned above are addressed
  
  We apologize for any inconvenience and appreciate your understanding. Our security standards help ensure the safety and reliability of the CRS Platform for all users.
  
  Support: ${supportUrl}
  Resubmit: ${resubmitUrl}
  
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
      subject: "Subscription Request Update - CRS Platform",
      html: htmlContent,
      text: textContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Subscription rejected email sent successfully to ${email}`);

    return {
      success: true,
      messageId: info.messageId,
      email: email,
    };
  } catch (error) {
    console.error("❌ Error sending subscription rejected email:", error);
    throw new Error(
      `Failed to send subscription rejected email: ${error.message}`
    );
  }
};

module.exports = {
  generateVerificationToken,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  testEmailConfiguration,
  createTransporter,
  sendSubscriptionQueuedEmail,
  sendSubscriptionApprovedEmail,
  sendSubscriptionRejectedEmail,
};
