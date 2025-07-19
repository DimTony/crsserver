// controllers/authController.js - Updated with Transaction Logging
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user");
const Device = require("../models/device");
const Subscription = require("../models/subscription");
const Transaction = require("../models/transaction"); // Add this import
const CustomError = require("../utils/customError");
const {
  getSubscriptionPrice,
  getSubscriptionDuration,
} = require("../utils/helpers");
const {
  generateVerificationToken,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendSubscriptionQueuedEmail,
} = require("../config/emailService");

// Helper function to extract request metadata
const extractRequestMetadata = (req) => ({
  userAgent: req.get("User-Agent") || "Unknown",
  ipAddress: req.ip || req.connection.remoteAddress || "Unknown",
});

// Helper function to generate random string for TOTP secret
const generateRandomString = (length) => {
  return crypto.randomBytes(length).toString("hex");
};

// Helper function to calculate queue position
const calculateQueuePosition = async (imei, session) => {
  const pendingCount = await Subscription.countDocuments({
    imei,
    status: "PENDING",
  }).session(session);

  return (pendingCount + 1).toString();
};

const register = async (req, res, next) => {
  console.log("[REGISTER SERVER]:", req.body);
  const {
    username,
    email,
    password,
    deviceName,
    imei,
    phoneNumber,
    plan,
    files,
    submissionNotes,
  } = req.body;

  // Extract request metadata for transaction logging
  const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (
      !username ||
      !email ||
      !password ||
      !deviceName ||
      !imei ||
      !phoneNumber ||
      !plan
    ) {
      throw new CustomError(400, "Please provide all required fields");
    }

    // File validation
    if (!files || files.length === 0) {
      if (req.body.uploadErrors && req.body.uploadErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "File upload failed. Please try uploading your files again.",
          error: "FILE_UPLOAD_REQUIRED",
          uploadErrors: req.body.uploadErrors,
        });
      }
      throw new CustomError(
        400,
        "Please upload at least one encryption card file"
      );
    }

    // Validation checks
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneNumberRegex = /^\+?[\d\s\-()]{10,}$/;

    if (!emailRegex.test(email)) {
      throw new CustomError(400, "Please provide a valid email address");
    }

    if (!phoneNumberRegex.test(phoneNumber)) {
      throw new CustomError(400, "Please provide a valid phone number");
    }

    if (password.length < 8) {
      throw new CustomError(400, "Password must be at least 8 characters long");
    }

    const validSubscriptionTypes = [
      "mobile-v4-basic",
      "mobile-v4-premium",
      "mobile-v4-enterprise",
      "mobile-v5-basic",
      "mobile-v5-premium",
      "full-suite-basic",
      "full-suite-premium",
    ];

    if (!validSubscriptionTypes.includes(plan)) {
      throw new CustomError(400, "Invalid encryption plan");
    }

    // Start transaction
    await session.startTransaction();

    // Check existing users within transaction
    const existingUserByEmail = await User.findOne({ email }).session(session);
    const existingUserByUsername = await User.findOne({ username }).session(
      session
    );

    if (existingUserByEmail) {
      if (!existingUserByEmail.isEmailVerified) {
        try {
          const verificationToken =
            existingUserByEmail.generateVerificationToken();
          await existingUserByEmail.save({ session });

          // Commit transaction before sending email
          await session.commitTransaction();

          try {
            await sendVerificationEmail(email, verificationToken, username);
          } catch (emailError) {
            console.error("Failed to send verification email:", emailError);
          }

          return res.status(200).json({
            success: true,
            message:
              "Account already exists but email not verified. New verification email sent.",
            data: {
              requiresVerification: true,
              email: existingUserByEmail.email,
            },
          });
        } catch (dbError) {
          await session.abortTransaction();
          console.error("Database error during re-registration:", dbError);
          throw new CustomError(
            500,
            "Failed to process registration. Please try again."
          );
        }
      }
      await session.abortTransaction();
      throw new CustomError(
        400,
        "User with this email already exists and is verified"
      );
    }

    if (existingUserByUsername) {
      await session.abortTransaction();
      throw new CustomError(400, "Username already taken");
    }

    // Check for active subscriptions on phone number
    const hasActiveSubscription = await Subscription.findOne({
      // phone: phoneNumber,
      imei,
      status: "ACTIVE",
    }).session(session);

    if (hasActiveSubscription) {
      await session.abortTransaction();
      throw new CustomError(
        400,
        "Device already has an active subscription"
      );
    }

    // Check for existing device
    const existingDevice = await Device.findOne({ imei }).session(session);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate email verification token
    const verificationToken = generateVerificationToken();

    let newUser, device, newSubscription, transaction;

    // Create new user within transaction
    newUser = new User({
      username,
      email,
      password: hashedPassword,
      isEmailVerified: false,
      isActive: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      role: "user",
    });

    await newUser.save({ session });
    console.log(`✅ User created: ${newUser._id}`);

    // Handle device creation/retrieval within transaction
    if (existingDevice) {
      // Check if device is already associated with another user
      if (
        existingDevice.user &&
        existingDevice.user.toString() !== newUser._id.toString()
      ) {
        await session.abortTransaction();
        throw new CustomError(
          400,
          "Device is already registered to another user"
        );
      }

      // Update existing device with new user if not already set
      if (!existingDevice.user) {
        existingDevice.user = newUser._id;
        existingDevice.deviceName = deviceName; // Update device name if needed
        await existingDevice.save({ session });
        device = existingDevice;
        console.log(`✅ Existing device updated: ${device._id}`);
      } else {
        device = existingDevice;
        console.log(`✅ Using existing device: ${device._id}`);
      }
    } else {
      // Create new device
      const totpSecret = generateRandomString(32);
      device = new Device({
        user: newUser._id,
        imei,
        totpSecret,
        deviceName,
      });

      await device.save({ session });
      console.log(`✅ New device created: ${device._id}`);
    }

    // Calculate queue position for this device
    const queuePosition = await calculateQueuePosition(imei, session);

    // Create subscription with PENDING status within transaction
    const subscriptionPrice = getSubscriptionPrice(plan);

    newSubscription = new Subscription({
      user: newUser._id.toString(),
      imei,
      deviceName,
      phone: phoneNumber,
      email,
      plan,
      price: subscriptionPrice,
      cards: files,
      queuePosition,
      status: "PENDING",
      // startDate and endDate will be set when subscription is activated
    });

    await newSubscription.save({ session });
    console.log(
      `✅ Subscription created with PENDING status: ${newSubscription._id}`
    );

    try {
      transaction = new Transaction({
        user: newUser._id.toString(),
        subscription: newSubscription._id,
        device: device._id,
        transactionId: Transaction.generateTransactionId(),
        type: "SUBSCRIPTION_CREATED",
        amount: subscriptionPrice,
        plan,
        status: "PENDING",
        queuePosition,
        queuedAt: new Date(),
        metadata: {
          userAgent: requestMetadata.userAgent || "Unknown",
          ipAddress: requestMetadata.ipAddress || "Unknown",
          deviceInfo: {
            // ✅ Always provide as proper object
            imei: imei || "",
            deviceName: deviceName || "",
          },
          submissionNotes: submissionNotes || "",
          encryptionCards: files || [],
          phoneNumber: phoneNumber || "",
          email: email || "",
        },
      });

      await transaction.save({ session });
      console.log(
        `✅ Transaction record created: ${transaction.transactionId}`
      );
    } catch (transactionError) {
      console.error("Failed to create transaction record:", transactionError);
      // Don't fail the registration for transaction logging errors
    }

    // Commit transaction - all operations succeeded
    await session.commitTransaction();
    console.log("✅ Transaction committed successfully");

    // Send verification email (outside transaction since it's not critical for data consistency)
    let emailSent = false;
    try {
      await sendVerificationEmail(email, verificationToken, username);
      console.log(`✅ Verification email sent to ${email}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      emailSent = false;
    }

    // Send subscription queued notification email (outside transaction)
    try {
      await sendSubscriptionQueuedEmail(email, username, plan, queuePosition);
    } catch (emailError) {
      console.error("Failed to send subscription queued email:", emailError);
    }

    // Prepare response
    const responseData = {
      requiresVerification: true,
      email: newUser.email,
      username: newUser.username,
      subscription: {
        id: newSubscription._id,
        plan: newSubscription.plan,
        status: newSubscription.status,
        queuePosition: newSubscription.queuePosition,
        estimatedReviewTime: "2-3 business days",
      },
      device: {
        id: device._id,
        imei: device.imei,
        deviceName: device.deviceName,
        isExisting: !!existingDevice,
      },
      transaction: transaction
        ? {
            id: transaction._id,
            transactionId: transaction.transactionId,
            amount: transaction.amount,
            status: transaction.status,
          }
        : null,
      message: emailSent
        ? "Registration successful! Please verify your email and your subscription request has been queued for admin review."
        : "Registration successful! Please contact support to verify your account. Your subscription request has been queued for admin review.",
    };

    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    res.status(201).json({
      success: true,
      message:
        "User registered successfully. Device registered and subscription queued for admin review.",
      data: responseData,
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Registration error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      next(
        new CustomError(
          500,
          "Registration failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

// Helper function to log transaction status updates
const logTransactionUpdate = async (
  subscriptionId,
  type,
  status,
  adminId = null,
  additionalData = {}
) => {
  try {
    // Find existing transaction for this subscription
    const existingTransaction = await Transaction.findOne({
      subscription: subscriptionId,
      type: "SUBSCRIPTION_CREATED",
    });

    if (existingTransaction) {
      // Update existing transaction
      const updateData = {
        type: type,
        status: status,
        ...additionalData,
      };

      if (adminId) {
        await existingTransaction.processedByAdmin(
          adminId,
          additionalData.adminNotes || ""
        );
      }

      await existingTransaction.updateStatus(status, updateData);
      console.log(
        `✅ Transaction updated: ${existingTransaction.transactionId}`
      );
      return existingTransaction;
    } else {
      console.warn(
        `⚠️ No transaction found for subscription: ${subscriptionId}`
      );
      return null;
    }
  } catch (error) {
    console.error("Failed to log transaction update:", error);
    return null;
  }
};

// Updated subscription status update method (for admin actions)
const updateSubscriptionStatus = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { status, adminNotes } = req.body;
    const adminId = req.user._id;
    const requestMetadata = extractRequestMetadata(req);

    // Validate status
    const validStatuses = ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      throw new CustomError(400, "Invalid status");
    }

    const subscription = await Subscription.findById(subscriptionId).populate(
      "user",
      "email username"
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    const session = await mongoose.startSession();
    await session.startTransaction();

    try {
      // Update subscription status
      const oldStatus = subscription.status;
      subscription.status = status;

      if (status === "ACTIVE") {
        // Set start and end dates when activating
        const subscriptionDuration = getSubscriptionDuration(subscription.plan);
        subscription.startDate = new Date();
        subscription.endDate = new Date(
          Date.now() + subscriptionDuration * 24 * 60 * 60 * 1000
        );

        // Check if there's already an active subscription for this device
        const existingActive = await Subscription.findOne({
          imei: subscription.imei,
          status: "ACTIVE",
          _id: { $ne: subscriptionId },
        }).session(session);

        if (existingActive) {
          await session.abortTransaction();
          throw new CustomError(
            400,
            "Device already has an active subscription"
          );
        }
      } else if (status === "CANCELLED" || status === "EXPIRED") {
        // Clear dates when cancelling or expiring
        if (status === "EXPIRED" && !subscription.endDate) {
          subscription.endDate = new Date();
        }
      }

      // Add admin notes and tracking
      if (adminNotes) {
        subscription.adminNotes = adminNotes;
      }
      subscription.reviewedBy = adminId;
      subscription.reviewedAt = new Date();

      await subscription.save({ session });

      // **NEW: Log transaction update**
      let transactionType = "SUBSCRIPTION_ACTIVATED";
      let transactionStatus = "COMPLETED";

      if (status === "ACTIVE") {
        transactionType = "SUBSCRIPTION_ACTIVATED";
        transactionStatus = "COMPLETED";
      } else if (status === "CANCELLED") {
        transactionType = "SUBSCRIPTION_CANCELLED";
        transactionStatus = "CANCELLED";
      } else if (status === "EXPIRED") {
        transactionType = "SUBSCRIPTION_EXPIRED";
        transactionStatus = "COMPLETED";
      }

      await logTransactionUpdate(
        subscriptionId,
        transactionType,
        transactionStatus,
        adminId,
        {
          adminNotes,
          subscriptionPeriod: {
            startDate: subscription.startDate,
            endDate: subscription.endDate,
          },
          metadata: {
            ...requestMetadata,
            statusChange: {
              from: oldStatus,
              to: status,
              changedAt: new Date(),
            },
          },
        }
      );

      // If activating, recalculate queue positions for remaining pending subscriptions
      if (status === "ACTIVE") {
        const pendingSubscriptions = await Subscription.find({
          imei: subscription.imei,
          status: "PENDING",
          _id: { $ne: subscriptionId },
        })
          .sort({ queuePosition: 1, createdAt: 1 })
          .session(session);

        // Update queue positions
        for (let i = 0; i < pendingSubscriptions.length; i++) {
          pendingSubscriptions[i].queuePosition = (i + 1).toString();
          await pendingSubscriptions[i].save({ session });
        }
      }

      await session.commitTransaction();

      res.json({
        success: true,
        message: `Subscription ${status.toLowerCase()} successfully`,
        data: {
          subscriptionId: subscription._id,
          status: subscription.status,
          user: subscription.user,
          imei: subscription.imei,
          plan: subscription.plan,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  } catch (err) {
    next(err);
  }
};




// Get user's subscription status
const getSubscriptionStatus = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    // Get all user's subscriptions
    const subscriptions = await Subscription.find({ user: userId }).sort({
      createdAt: -1,
    });

    // Separate by status
    const activeSubscriptions = subscriptions.filter(
      (sub) => sub.status === "ACTIVE"
    );
    const pendingSubscriptions = subscriptions.filter(
      (sub) => sub.status === "PENDING"
    );
    const expiredSubscriptions = subscriptions.filter(
      (sub) => sub.status === "EXPIRED"
    );
    const cancelledSubscriptions = subscriptions.filter(
      (sub) => sub.status === "CANCELLED"
    );

    res.json({
      success: true,
      data: {
        activeSubscriptions,
        pendingSubscriptions,
        expiredSubscriptions,
        cancelledSubscriptions,
        totalSubscriptions: subscriptions.length,
        hasActiveSubscription: activeSubscriptions.length > 0,
        pendingApproval: pendingSubscriptions.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get device queue status (shows all subscriptions for a specific device)
const getDeviceQueueStatus = async (req, res, next) => {
  try {
    const { imei } = req.params;

    // Get all subscriptions for this device, ordered by queue position
    const deviceSubscriptions = await Subscription.find({ imei })
      .populate("user", "username email")
      .sort({ queuePosition: 1, createdAt: 1 });

    const queueStats = {
      totalInQueue: deviceSubscriptions.filter(
        (sub) => sub.status === "PENDING"
      ).length,
      activeSubscriptions: deviceSubscriptions.filter(
        (sub) => sub.status === "ACTIVE"
      ).length,
      expiredSubscriptions: deviceSubscriptions.filter(
        (sub) => sub.status === "EXPIRED"
      ).length,
      cancelledSubscriptions: deviceSubscriptions.filter(
        (sub) => sub.status === "CANCELLED"
      ).length,
    };

    res.json({
      success: true,
      data: {
        imei,
        subscriptions: deviceSubscriptions,
        queueStats,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Cancel user's own subscription
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user._id.toString();

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: { $in: ["PENDING", "ACTIVE"] },
    });

    if (!subscription) {
      throw new CustomError(
        404,
        "Subscription not found or cannot be cancelled"
      );
    }

    subscription.status = "CANCELLED";
    subscription.cancelledAt = new Date();
    subscription.cancelledBy = userId;

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription cancelled successfully",
      data: {
        subscriptionId: subscription._id,
        status: subscription.status,
        cancelledAt: subscription.cancelledAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Helper method to check for active subscriptions
const hasActiveSubscription = async (phoneNumber, options = {}) => {
  return await Subscription.findOne(
    {
      phone: phoneNumber,
      status: "ACTIVE",
    },
    null,
    options
  );
};

// Activate approved subscription with authenticator
const activateSubscription = async (req, res, next) => {
  try {
    const {
      queueId,
      activationToken,
      authenticatorProvider,
      authenticatorCode,
    } = req.body;
    const userId = req.user._id;

    if (
      !queueId ||
      !activationToken ||
      !authenticatorProvider ||
      !authenticatorCode
    ) {
      throw new CustomError(400, "Missing required activation parameters");
    }

    // Find the queued subscription
    const queuedSub = await SubscriptionQueue.findOne({
      _id: queueId,
      user: userId,
      activationToken,
      status: "APPROVED",
      activationExpires: { $gt: new Date() },
    }).populate("device");

    if (!queuedSub) {
      throw new CustomError(
        400,
        "Invalid activation token or subscription not found"
      );
    }

    // Check if user already has an active subscription
    const existingActive = await Subscription.hasActiveSubscription(userId);
    if (existingActive) {
      throw new CustomError(
        400,
        "You already have an active subscription. Please cancel it first."
      );
    }

    // Verify authenticator (implement based on your authenticator integration)
    const isAuthenticatorValid = await verifyAuthenticator(
      authenticatorProvider,
      authenticatorCode,
      req.user.email
    );

    if (!isAuthenticatorValid) {
      throw new CustomError(400, "Invalid authenticator code");
    }

    // Create active subscription
    const endDate = new Date(
      Date.now() + queuedSub.duration * 24 * 60 * 60 * 1000
    );

    const activeSubscription = new Subscription({
      user: userId,
      device: queuedSub.device._id,
      queuedSubscription: queuedSub._id,
      plan: queuedSub.plan,
      price: queuedSub.price,
      encryptionCards: queuedSub.encryptionCards,
      phoneNumber: queuedSub.phoneNumber,
      startDate: new Date(),
      endDate,
      status: "ACTIVE",
      authenticator: {
        provider: authenticatorProvider,
        providerId: authenticatorCode, // Store the authenticator ID
        lastVerified: new Date(),
      },
      activatedBy: userId,
    });

    await activeSubscription.save();

    // Update queued subscription status
    queuedSub.status = "ACTIVATED";
    queuedSub.authenticatorSetup.setupCompleted = true;
    queuedSub.authenticatorSetup.provider = authenticatorProvider;
    await queuedSub.save();

    res.json({
      success: true,
      message: "Subscription activated successfully!",
      data: {
        subscription: activeSubscription,
        activatedAt: activeSubscription.activatedAt,
        expiresAt: activeSubscription.endDate,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Placeholder for authenticator verification - implement based on your chosen providers
const verifyAuthenticator = async (provider, code, userEmail) => {
  // Implement verification logic for Google, Microsoft, or Entrust
  // This would involve API calls to the respective authenticator services

  switch (provider) {
    case "google":
      // Implement Google Authenticator verification
      return true; // Placeholder
    case "microsoft":
      // Implement Microsoft Authenticator verification
      return true; // Placeholder
    case "entrust":
      // Implement Entrust verification
      return true; // Placeholder
    default:
      return false;
  }
};

// Keep other methods the same but add similar error handling
const login = async (req, res, next) => {
  const { username, password } = req.body;

  try {
    // Find user by username or email
    let user = await User.findOne({
      $or: [{ email: username }, { username: username }],
    });

    if (!user) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email address before logging in. Check your inbox for the verification link.",
        data: {
          requiresVerification: true,
          email: user.email,
        },
      });
    }

    // Check if account is active
    if (!user.isActive) {
      throw new CustomError(
        403,
        "Account is not active. Please contact support."
      );
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Update login tracking (don't fail login if this fails)
    try {
      user.lastLoginAt = new Date();
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
    } catch (updateError) {
      console.error("Failed to update login tracking:", updateError);
      // Continue with login
    }

    // Create payload for JWT
    const payload = {
      user: {
        id: user.id,
      },
    };

    // Sign tokens
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
      expiresIn: "30d",
    });

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationToken;
    delete userResponse.emailVerificationExpires;

    // Send response with token and user info
    res.json({
      success: true,
      message: "Login successful",
      data: {
        ...userResponse,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error("Login error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else {
      next(new CustomError(500, "Login failed. Please try again."));
    }
  }
};

// Email verification endpoint with better error handling
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new CustomError(400, "Verification token is required");
    }

    // Find user by valid verification token
    const user = await User.findByValidVerificationToken(token);

    if (!user) {
      throw new CustomError(400, "Invalid or expired verification token");
    }

    // Activate user account
    await user.activateAccount();

    // Send welcome email (don't fail verification if email fails)
    try {
      await sendWelcomeEmail(user.email, user.username);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
      // Don't fail the verification
    }

    res.json({
      success: true,
      message: "Email verified successfully! Your account is now active.",
      data: {
        verified: true,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("Email verification error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else {
      next(new CustomError(500, "Verification failed. Please try again."));
    }
  }
};

// Resend verification email with error handling
const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new CustomError(400, "Email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
      throw new CustomError(404, "User not found");
    }

    if (user.isEmailVerified) {
      throw new CustomError(400, "Email is already verified");
    }

    // Generate new verification token
    const verificationToken = user.generateVerificationToken();
    await user.save();

    // Send verification email
    try {
      await sendVerificationEmail(email, verificationToken, user.username);

      res.json({
        success: true,
        message: "Verification email sent successfully",
        data: {
          email: user.email,
        },
      });
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      res.status(500).json({
        success: false,
        message:
          "Failed to send verification email. Please try again later or contact support.",
        error: "EMAIL_SEND_FAILED",
      });
    }
  } catch (err) {
    next(err);
  }
};

// Updated getUser function
const getUserOld = async (req, res, next) => {
  try {
    let user = await User.findById(req.user._id).select(
      "-password -emailVerificationToken -encryptionCards"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get user's devices
    const devices = await Device.find({ user: req.user._id });
    
    // Get user's subscriptions
    const subscriptions = await Subscription.find({
      user: req.user._id,
    }).select("-cards");

    // Get user's transaction history with pagination (latest first)
    const transactionHistory = await Transaction.find({
      user: req.user._id
    })
    .populate("subscription", "plan status imei deviceName")
    .populate("device", "deviceName imei")
    .populate("processedBy", "username email")
    .sort({ createdAt: -1 }) // Latest transactions first
    .limit(50) // Limit to last 50 transactions to avoid large responses
    .select("-metadata.userAgent -metadata.ipAddress"); // Exclude sensitive metadata

    // Get transaction summary statistics
    const transactionStats = await Transaction.aggregate([
      { $match: { user: req.user._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" }
        }
      }
    ]);

    // Calculate total spent and transaction counts
    const totalSpent = await Transaction.aggregate([
      { 
        $match: { 
          user: req.user._id, 
          status: "COMPLETED" 
        } 
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          completedTransactions: { $sum: 1 }
        }
      }
    ]);

    // Convert Mongoose document to plain object
    user = user.toObject();

    // Attach related data
    user.devices = devices;
    user.subscriptions = subscriptions;
    user.transactionHistory = transactionHistory;
    user.transactionStats = transactionStats;
    user.totalSpent = totalSpent[0]?.totalAmount || 0;
    user.completedTransactions = totalSpent[0]?.completedTransactions || 0;

    res.json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (err) {
    next(err);
  }
};

const getUser = async (req, res, next) => {
  try {
    let user = await User.findById(req.user._id).select(
      "-password -emailVerificationToken -encryptionCards"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get user's devices
    const devices = await Device.find({ user: req.user._id });

    // Get user's subscriptions with custom sorting
    // Priority order: ACTIVE → QUEUED → PENDING, then by queue position within each status
    const subscriptions = await Subscription.find({
      user: req.user._id,
    })
      .select("-cards")
      .sort({
        // Custom sort: ACTIVE first, then QUEUED, then PENDING
        status: 1, // This will be overridden by our custom sorting logic
        queuePosition: 1, // Within same status, sort by queue position
      });

    // Custom sort subscriptions according to your requirements
    const sortedSubscriptions = subscriptions.sort((a, b) => {
      // Define status priority (lower number = higher priority)
      const statusPriority = {
        ACTIVE: 1,
        QUEUED: 2,
        PENDING: 3,
        APPROVED: 4,
        EXPIRED: 5,
        CANCELLED: 6,
      };

      // First, sort by status priority
      const statusDiff =
        (statusPriority[a.status] || 999) - (statusPriority[b.status] || 999);
      if (statusDiff !== 0) {
        return statusDiff;
      }

      // If same status, sort by queue position (convert to number for proper sorting)
      const aPos = parseInt(a.queuePosition) || 0;
      const bPos = parseInt(b.queuePosition) || 0;

      return aPos - bPos;
    });

    // Get user's transaction history with pagination (latest first)
    const transactionHistory = await Transaction.find({
      user: req.user._id,
    })
      .populate("subscription", "plan status imei deviceName")
      .populate("device", "deviceName imei")
      .populate("processedBy", "username email")
      .sort({ createdAt: -1 }) // Latest transactions first
      .limit(50) // Limit to last 50 transactions to avoid large responses
      .select("-metadata.userAgent -metadata.ipAddress"); // Exclude sensitive metadata

    // Get transaction summary statistics
    const transactionStats = await Transaction.aggregate([
      { $match: { user: req.user._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    // Calculate total spent and transaction counts
    const totalSpent = await Transaction.aggregate([
      {
        $match: {
          user: req.user._id,
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          completedTransactions: { $sum: 1 },
        },
      },
    ]);

    // Convert Mongoose document to plain object
    user = user.toObject();

    // Attach related data with sorted subscriptions
    user.devices = devices;
    user.subscriptions = sortedSubscriptions; // Use sorted subscriptions
    user.transactionHistory = transactionHistory;
    user.transactionStats = transactionStats;
    user.totalSpent = totalSpent[0]?.totalAmount || 0;
    user.completedTransactions = totalSpent[0]?.completedTransactions || 0;

    res.json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (err) {
    next(err);
  }
};

const passUser = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const payload = {
      user: {
        id: req.user._id.toString(),
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) throw err;

        res.json({
          message: "Authentication successful",
          token,
          user,
        });
      }
    );
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    // Update user status if user is authenticated (don't fail logout if this fails)
    if (req.user) {
      try {
        await User.findByIdAndUpdate(req.user._id, {
          isOnline: false,
          lastSeen: new Date(),
        });
      } catch (updateError) {
        console.error("Failed to update logout status:", updateError);
        // Continue with logout
      }
    }

    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  register,
  updateSubscriptionStatus,
  logTransactionUpdate,
  getSubscriptionStatus,
  activateSubscription,
  verifyEmail,
  resendVerificationEmail,
  getUser,
  passUser,
  logout,
  getDeviceQueueStatus,
  updateSubscriptionStatus,
  cancelSubscription,
  hasActiveSubscription,
};
