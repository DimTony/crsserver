const mongoose = require("mongoose");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const Transaction = require("../models/transaction");
const Device = require("../models/device");
const Subscription = require("../models/subscription");
const User = require("../models/user");
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
const CustomError = require("../utils/customError");

const SUBSCRIPTION_TYPES = {
  "mobile-v4-basic": 30,
  "mobile-v4-premium": 60,
  "mobile-v4-enterprise": 90,
  "mobile-v5-basic": 30,
  "mobile-v5-premium": 60,
  "full-suite-basic": 60,
  "full-suite-premium": 90,
};

const checkDeviceIsOnboarded = async (req, res, next) => {
  console.log("[checkDeviceIsOnboarded SERVER]:", req.body);
  const { imei } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei) {
      throw new CustomError(400, "Please provide all valid IMEI");
    }

    await session.startTransaction();

    const existingDeviceByImei = await Device.findOne({
      user: userId,
      imei,
    }).session(session);

    return res.status(200).json({
      success: true,
      message: "Onboarding status fetched successfully",
      data: {
        isOnboarded: existingDeviceByImei?.isOnboarded || false,
        deviceExists: !!existingDeviceByImei,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device check error:", err);

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
          "Device check failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const setupDeviceOtp = async (req, res, next) => {
  console.log("[setupDeviceOtp SERVER]:", req.body);
  const { imei, deviceName } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei || !deviceName) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    const secret = speakeasy.generateSecret({
      name: `${req.user.email} (${imei.slice(-4)})`,
      issuer: "CRS",
      length: 20,
    });

    await Device.findOneAndUpdate(
      { user: req.user._id, imei },
      {
        user: req.user._id,
        imei,
        totpSecret: secret.base32,
        deviceName: deviceName || "Mobile Device",
        isOnboarded: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    return res.status(200).json({
      success: true,
      message: "Device Setup Initiated successfully",
      data: {
        qrCode: qrCodeUrl,
        secret: secret.base32,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

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
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const queueSubscription = async (req, res, next) => {
  console.log("[queueSubscription SERVER]:", req.body);
  const { subscriptionId } = req.body;

  const session = await mongoose.startSession();

  try {
    if (!subscriptionId) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    const updatedSubscription = await Subscription.findByIdAndUpdate(
      subscriptionId,
      {
        status: "QUEUED",
        updatedAt: now,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!updatedDevice) {
      throw new CustomError(400, "Device not updated");
    }

    res.json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscription: updatedSubscription,
        duration: `${duration} days`,
        subscriptionType: subscriptionType,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

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
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const activateSubscription = async (req, res, next) => {
  console.log("[activateSubscription SERVER]:", req.body);
  const { subscriptionId, imei, totpCode } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei || !subscriptionId || !totpCode) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    const subscription = await Subscription.findById(subscriptionId).session(
      session
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    console.log("AAA", req.user);
    console.log("GGG", subscription);

    if (subscription.user.toString() !== req.user._id.toString()) {
      throw new CustomError(403, "Unauthorized access to subscription");
    }

    if (subscription.status !== "QUEUED") {
      throw new CustomError(400, "Subscription not queued");
    }

    if (subscription.imei !== imei) {
      throw new CustomError(400, "Invalid IMEI");
    }

    const device = await Device.findOne({
      user: userId,
      imei,
    }).session(session);

    if (!device) {
      throw new CustomError(404, "Device not found");
    }

    const verified = speakeasy.totp.verify({
      secret: device.totpSecret,
      encoding: "base32",
      token: totpCode,
      window: 2, // Allow 2 time steps before/after current time
    });

    if (!verified) {
      throw new CustomError(400, "Invalid OTP");
    }

    const subscriptionType = subscription.plan;
    const durationInDays = SUBSCRIPTION_TYPES[subscriptionType];

    if (!durationInDays) {
      console.warn(
        `Unknown subscription type: ${subscriptionType}, defaulting to 30 days`
      );
    }

    const duration = durationInDays || 30;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + duration);

    const updatedSubscription = await Subscription.findByIdAndUpdate(
      subscriptionId,
      {
        status: "ACTIVE",
        startDate: now,
        endDate: endDate,
        updatedAt: now,
      }
    );

    const updatedDevice = await Device.findByIdAndUpdate(
      device._id,
      {
        isOnboarded: true,
        updatedAt: now,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!updatedDevice) {
      throw new CustomError(400, "Device not updated");
    }

    res.json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscription: updatedSubscription,
        duration: `${duration} days`,
        subscriptionType: subscriptionType,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

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
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const newSubscription = async (req, res, next) => {};

const extractRequestMetadata = (req) => ({
  userAgent: req.get("User-Agent") || "Unknown",
  ipAddress: req.ip || req.connection.remoteAddress || "Unknown",
});

// Helper function to generate random string for TOTP secret
const generateRandomString = (length) => {
  const crypto = require("crypto");
  return crypto.randomBytes(length).toString("hex");
};

// Helper function to calculate next queue position for a device
const calculateNextQueuePosition = async (imei, session) => {
  const queuedCount = await Subscription.countDocuments({
    imei,
    status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
  }).session(session);

  return (queuedCount + 1).toString();
};

// Add new subscription to existing or new device
const addDeviceSubscription = async (req, res, next) => {
  console.log("[ADD DEVICE SUBSCRIPTION]:", req.body);
  console.log("[ADD DEVICE SUBSCRIPTION]:", req.user);

  const {
    deviceName,
    imei,
    plan,
    files,
    // username,
    // email,
    password,
    phoneNumber,
    submissionNotes,
    createNewUser = false, // Flag to determine if we should create a new user
    // userId, // For existing users
  } = req.body;
  const userId = req.user._id;
  const username = req.user.username;
  const email = req.user.email;

  // Extract request metadata for transaction logging
  const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!deviceName || !imei || !phoneNumber || !plan) {
      throw new CustomError(
        400,
        "Please provide all required fields: deviceName, imei, phoneNumber, plan"
      );
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

    // Plan validation
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

    // Phone number validation
    const phoneNumberRegex = /^\+?[\d\s\-()]{10,}$/;
    if (!phoneNumberRegex.test(phoneNumber)) {
      throw new CustomError(400, "Please provide a valid phone number");
    }

    // Start transaction
    await session.startTransaction();

    let targetUser;
    let isNewUser = false;

    // Handle user creation or selection
    if (createNewUser) {
      // Creating new user scenario
      if (!username || !email || !password) {
        throw new CustomError(
          400,
          "Username, email, and password required for new user"
        );
      }

      // Email validation for new users
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new CustomError(400, "Please provide a valid email address");
      }

      if (password.length < 8) {
        throw new CustomError(
          400,
          "Password must be at least 8 characters long"
        );
      }

      // Check if user already exists
      const existingUserByEmail = await User.findOne({ email }).session(
        session
      );
      const existingUserByUsername = await User.findOne({ username }).session(
        session
      );

      if (existingUserByEmail) {
        if (!existingUserByEmail.isEmailVerified) {
          // Send new verification email for unverified user
          try {
            const verificationToken =
              existingUserByEmail.generateVerificationToken();
            await existingUserByEmail.save({ session });

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

      // Create new user
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);
      const verificationToken = generateVerificationToken();

      targetUser = new User({
        username,
        email,
        password: hashedPassword,
        isEmailVerified: false,
        isActive: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
        role: "user",
      });

      await targetUser.save({ session });
      isNewUser = true;
      console.log(`✅ New user created: ${targetUser._id}`);
    } else {
      // Using existing user scenario
      if (!userId) {
        throw new CustomError(400, "User ID is required for existing user");
      }

      targetUser = await User.findById(userId).session(session);
      if (!targetUser) {
        await session.abortTransaction();
        throw new CustomError(404, "User not found");
      }
      console.log(`✅ Using existing user: ${targetUser._id}`);
    }

    // Check for active subscriptions on phone number
    const hasActiveSubscription = await Subscription.findOne({
      phone: phoneNumber,
      status: "ACTIVE",
    }).session(session);

    if (hasActiveSubscription) {
      await session.abortTransaction();
      throw new CustomError(
        400,
        "Phone number already has an active subscription"
      );
    }

    // Handle device creation/retrieval
    let device = await Device.findOne({ imei }).session(session);
    let isNewDevice = false;

    if (device) {
      // Device exists - check ownership
      if (device.user && device.user.toString() !== targetUser._id.toString()) {
        await session.abortTransaction();
        throw new CustomError(
          400,
          "Device is already registered to another user"
        );
      }

      // Update device if not associated with user yet
      if (!device.user) {
        device.user = targetUser._id;
        device.deviceName = deviceName;
        await device.save({ session });
        console.log(`✅ Updated existing device: ${device._id}`);
      } else {
        console.log(`✅ Using existing device: ${device._id}`);
      }
    } else {
      // Create new device
      const totpSecret = generateRandomString(32);
      device = new Device({
        user: targetUser._id,
        imei,
        totpSecret,
        deviceName,
      });

      await device.save({ session });
      isNewDevice = true;
      console.log(`✅ New device created: ${device._id}`);
    }

    // Calculate next queue position for this device
    const queuePosition = await calculateNextQueuePosition(imei, session);

    // Get subscription pricing
    const subscriptionPrice = getSubscriptionPrice(plan);

    // Create new subscription
    const newSubscription = new Subscription({
      user: targetUser._id.toString(),
      imei,
      deviceName,
      phone: phoneNumber,
      email: targetUser.email,
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

    // Create transaction record
    let transaction;
    try {
      transaction = new Transaction({
        user: targetUser._id.toString(),
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
            imei: imei || "",
            deviceName: deviceName || "",
          },
          submissionNotes: submissionNotes || "",
          encryptionCards: files || [],
          phoneNumber: phoneNumber || "",
          email: targetUser.email || "",
          isNewUser,
          isNewDevice,
        },
      });

      await transaction.save({ session });
      console.log(
        `✅ Transaction record created: ${transaction.transactionId}`
      );
    } catch (transactionError) {
      console.error("Failed to create transaction record:", transactionError);
      // Don't fail the subscription creation for transaction logging errors
    }

    // Commit transaction - all operations succeeded
    await session.commitTransaction();
    console.log("✅ Transaction committed successfully");

    // Send verification email for new users (outside transaction)
    let emailSent = false;
    if (isNewUser) {
      try {
        await sendVerificationEmail(
          targetUser.email,
          targetUser.emailVerificationToken,
          targetUser.username
        );
        console.log(`✅ Verification email sent to ${targetUser.email}`);
        emailSent = true;
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
        emailSent = false;
      }
    }

    // Send subscription queued notification email (outside transaction)
    try {
      await sendSubscriptionQueuedEmail(
        targetUser.email,
        targetUser.username,
        plan,
        queuePosition
      );
    } catch (emailError) {
      console.error("Failed to send subscription queued email:", emailError);
    }

    // Populate response data
    await newSubscription.populate([
      { path: "user", select: "username email phoneNumber isEmailVerified" },
    ]);

    // Get device queue information
    const deviceQueueInfo = await Subscription.find({
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).sort({ queuePosition: 1 });

    // Prepare response
    const responseData = {
      user: {
        id: targetUser._id,
        username: targetUser.username,
        email: targetUser.email,
        isEmailVerified: targetUser.isEmailVerified,
        isNewUser,
        requiresVerification: isNewUser && !targetUser.isEmailVerified,
      },
      subscription: {
        id: newSubscription._id,
        plan: newSubscription.plan,
        status: newSubscription.status,
        queuePosition: newSubscription.queuePosition,
        estimatedReviewTime: "2-3 business days",
        price: newSubscription.price,
      },
      device: {
        id: device._id,
        imei: device.imei,
        deviceName: device.deviceName,
        isNewDevice,
        totalInQueue: deviceQueueInfo.length,
        queuePosition: parseInt(queuePosition),
      },
      transaction: transaction
        ? {
            id: transaction._id,
            transactionId: transaction.transactionId,
            amount: transaction.amount,
            status: transaction.status,
          }
        : null,
      queueInfo: {
        position: queuePosition,
        totalInDeviceQueue: deviceQueueInfo.length,
        estimatedWaitTime: `${deviceQueueInfo.length * 2}-${
          deviceQueueInfo.length * 3
        } business days`,
      },
    };

    // Add upload warnings if any
    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    // Success message based on scenario
    let message =
      "Subscription added successfully and queued for admin review.";
    if (isNewUser) {
      message += emailSent
        ? " Please verify your email to complete account setup."
        : " Please contact support to verify your account.";
    }

    res.status(201).json({
      success: true,
      message,
      data: responseData,
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Add subscription error:", err);

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
          "Failed to add subscription due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const addSubscriptionToExtendExistingSubscription = async (req, res, next) => {
  console.log("[addSubscriptionToMyDevice SERVER]:", req.body);

  const {
    imei,
    plan,
    files,
    submissionNotes,
    paymentMethod = "USER_ACTION",
  } = req.body;

  const userId = req.user._id.toString();
  const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!imei || !plan) {
      throw new CustomError(
        400,
        "Please provide all required fields: imei, plan"
      );
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

    // Validate subscription plan
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
      throw new CustomError(400, "Invalid subscription plan");
    }

    // Start transaction
    await session.startTransaction();

    // Get user information
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Check if user's email is verified
    if (!user.isEmailVerified) {
      await session.abortTransaction();
      throw new CustomError(
        403,
        "Please verify your email address before adding a subscription"
      );
    }

    // Verify device exists and belongs to user
    const device = await Device.findOne({
      imei,
      user: userId,
    }).session(session);

    if (!device) {
      await session.abortTransaction();
      throw new CustomError(
        404,
        "Device not found or does not belong to you. Please ensure the device is registered to your account."
      );
    }

    let subscription, queuePosition, subscriptionPrice, newSubscription;

    subscription = await Subscription.findOne({
      user: userId,
      imei,
      // status: "ACTIVE",
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).session(session);

    queuePosition = await calculateNextQueuePosition(imei, session);

    subscriptionPrice = getSubscriptionPrice(plan);

    newSubscription = new Subscription({
      user: userId,
      imei,
      deviceName: device.deviceName,
      phone: subscription.phone || existingPendingSubscription.phone || "",
      email: user.email,
      plan,
      price: subscriptionPrice,
      cards: files,
      queuePosition,
      status: "PENDING",
      originalDuration: getSubscriptionDuration(plan),
      totalPaid: 0,
      // Don't set startDate and endDate until subscription is activated
    });

    await newSubscription.save({ session });
    console.log(
      `✅ User subscription created with PENDING status: ${newSubscription._id}`
    );

    // Create transaction record
    try {
      const transaction = new Transaction({
        user: userId,
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
            imei: imei,
            deviceName: device.deviceName,
          },
          submissionNotes: submissionNotes || "",
          encryptionCards: files || [],
          phoneNumber: user.phoneNumber || "",
          email: user.email,
          userInitiated: true,
          existingDevice: true,
        },
      });

      await transaction.save({ session });
      console.log(
        `✅ Transaction record created: ${transaction.transactionId}`
      );
    } catch (transactionError) {
      console.error("Failed to create transaction record:", transactionError);
      // Don't fail the subscription creation for transaction logging errors
    }

    // Commit transaction - all operations succeeded
    await session.commitTransaction();
    console.log("✅ Transaction committed successfully");

    // await existingActiveSubscription.populate([
    //   { path: "user", select: "username email phoneNumber" },
    // ]);

    // Send notification emails (outside transaction)
    let emailSent = false;
    try {
      await sendSubscriptionQueuedEmail(
        user.email,
        user.username,
        plan,
        queuePosition
      );
      console.log(`✅ Subscription queued email sent to ${user.email}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send subscription queued email:", emailError);
      emailSent = false;
    }
    const subscriptionToReturn = newSubscription || subscription;

    // console.log("SUB TO RETURN", subscriptionToReturn);

    const responseData = {
      subscription: {
        id: subscriptionToReturn._id,
        plan: subscriptionToReturn.plan,
        status: subscriptionToReturn.status,
        queuePosition: subscriptionToReturn.queuePosition,
        estimatedReviewTime: "2-3 business days",
        price: subscriptionToReturn.price,
        createdAt: subscriptionToReturn.createdAt,
      },
      device: {
        id: device._id,
        imei: device.imei,
        deviceName: device.deviceName,
        isOnboarded: device.isOnboarded,
      },
      queueInfo: {
        position: queuePosition,
        deviceHasActive: await Subscription.hasActiveSubscription(imei),
        totalInQueue: await Subscription.countDocuments({
          imei,
          status: { $in: ["QUEUED", "PENDING"] },
        }),
      },
      message: emailSent
        ? "Subscription request submitted successfully! You will receive email updates on the status."
        : "Subscription request submitted successfully! Please contact support for updates.",
    };

    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    res.status(201).json({
      success: true,
      message:
        "Subscription added successfully to your device and queued for review.",
      data: responseData,
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Add subscription to device error:", err);

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
    } else {
      next(
        new CustomError(
          500,
          "Subscription request failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const addSubscriptionToMyDevice = async (req, res, next) => {
  console.log("[addSubscriptionToMyDevice SERVER]:", req.body);

  const {
    imei,
    plan,
    files,
    submissionNotes,
    paymentMethod = "USER_ACTION",
  } = req.body;

  const userId = req.user._id.toString();
  const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!imei || !plan) {
      throw new CustomError(
        400,
        "Please provide all required fields: imei, plan"
      );
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

    // Validate subscription plan
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
      throw new CustomError(400, "Invalid subscription plan");
    }

    // Start transaction
    await session.startTransaction();

    // Get user information
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Check if user's email is verified
    if (!user.isEmailVerified) {
      await session.abortTransaction();
      throw new CustomError(
        403,
        "Please verify your email address before adding a subscription"
      );
    }

    // Verify device exists and belongs to user
    const device = await Device.findOne({
      imei,
      user: userId,
    }).session(session);

    if (!device) {
      await session.abortTransaction();
      throw new CustomError(
        404,
        "Device not found or does not belong to you. Please ensure the device is registered to your account."
      );
    }

    // Check if user already has a pending/queued subscription for this device
    const existingPendingSubscription = await Subscription.findOne({
      user: userId,
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).session(session);

    // if (existingPendingSubscription) {
    //   await session.abortTransaction();
    //   throw new CustomError(
    //     400,
    //     "You already have a pending subscription for this device. Please wait for it to be processed."
    //   );
    // }

    // Calculate queue position for this device
    const queuePosition = await calculateNextQueuePosition(imei, session);

    // Create subscription with PENDING status
    const subscriptionPrice = getSubscriptionPrice(plan);

    const newSubscription = new Subscription({
      user: userId,
      imei,
      deviceName: device.deviceName,
      phone: existingPendingSubscription.phone || "",
      email: user.email,
      plan,
      price: subscriptionPrice,
      cards: files,
      queuePosition,
      status: "PENDING",
      originalDuration: getSubscriptionDuration(plan),
      totalPaid: 0,
      // Don't set startDate and endDate until subscription is activated
    });

    await newSubscription.save({ session });
    console.log(
      `✅ User subscription created with PENDING status: ${newSubscription._id}`
    );

    // Create transaction record
    let transaction;
    try {
      transaction = new Transaction({
        user: userId,
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
            imei: imei,
            deviceName: device.deviceName,
          },
          submissionNotes: submissionNotes || "",
          encryptionCards: files || [],
          phoneNumber: user.phoneNumber || "",
          email: user.email,
          userInitiated: true,
          existingDevice: true,
        },
      });

      await transaction.save({ session });
      console.log(
        `✅ Transaction record created: ${transaction.transactionId}`
      );
    } catch (transactionError) {
      console.error("Failed to create transaction record:", transactionError);
      // Don't fail the subscription creation for transaction logging errors
    }

    // Commit transaction - all operations succeeded
    await session.commitTransaction();
    console.log("✅ Transaction committed successfully");

    // Send notification emails (outside transaction)
    let emailSent = false;
    try {
      await sendSubscriptionQueuedEmail(
        user.email,
        user.username,
        plan,
        queuePosition
      );
      console.log(`✅ Subscription queued email sent to ${user.email}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send subscription queued email:", emailError);
      emailSent = false;
    }

    // Get queue information for this device
    const deviceQueueInfo = await Subscription.find({
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).sort({ queuePosition: 1 });

    const responseData = {
      subscription: {
        id: newSubscription._id,
        plan: newSubscription.plan,
        status: newSubscription.status,
        queuePosition: newSubscription.queuePosition,
        estimatedReviewTime: "2-3 business days",
        price: newSubscription.price,
        createdAt: newSubscription.createdAt,
      },
      device: {
        id: device._id,
        imei: device.imei,
        deviceName: device.deviceName,
        isOnboarded: device.isOnboarded,
      },
      queueInfo: {
        position: queuePosition,
        deviceHasActive: await Subscription.hasActiveSubscription(imei),
        totalInQueue: deviceQueueInfo.length,
        estimatedWaitTime: `${deviceQueueInfo.length * 2}-${
          deviceQueueInfo.length * 3
        } business days`,
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
        ? "Subscription request submitted successfully! You will receive email updates on the status."
        : "Subscription request submitted successfully! Please contact support for updates.",
    };

    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    res.status(201).json({
      success: true,
      message:
        "Subscription request submitted successfully and queued for admin review.",
      data: responseData,
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Add subscription to device error:", err);

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
    } else {
      next(
        new CustomError(
          500,
          "Subscription request failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

// Get user's devices with subscription status
const getMyDevices = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    // Get user's devices
    const devices = await Device.find({ user: userId });

    if (devices.length === 0) {
      return res.json({
        success: true,
        message: "No devices found for your account",
        data: {
          devices: [],
          totalDevices: 0,
        },
      });
    }

    // Get subscription information for each device
    const devicesWithSubscriptions = await Promise.all(
      devices.map(async (device) => {
        const activeSubscription = await Subscription.findOne({
          imei: device.imei,
          status: "ACTIVE",
        });

        const pendingSubscriptions = await Subscription.find({
          imei: device.imei,
          status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
        }).sort({ queuePosition: 1 });

        const expiredSubscriptions = await Subscription.find({
          imei: device.imei,
          status: "EXPIRED",
        })
          .sort({ endDate: -1 })
          .limit(3);

        const totalSubscriptions = await Subscription.countDocuments({
          imei: device.imei,
        });

        return {
          device: {
            id: device._id,
            imei: device.imei,
            deviceName: device.deviceName,
            isOnboarded: device.isOnboarded,
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
          },
          activeSubscription,
          pendingSubscriptions,
          expiredSubscriptions,
          totalSubscriptions,
          canAddSubscription:
            !activeSubscription && pendingSubscriptions.length === 0,
        };
      })
    );

    res.json({
      success: true,
      message: "Devices retrieved successfully",
      data: {
        devices: devicesWithSubscriptions,
        totalDevices: devices.length,
        summary: {
          totalDevices: devices.length,
          devicesWithActiveSubscription: devicesWithSubscriptions.filter(
            (d) => d.activeSubscription
          ).length,
          devicesWithPendingSubscription: devicesWithSubscriptions.filter(
            (d) => d.pendingSubscriptions.length > 0
          ).length,
          devicesAvailableForSubscription: devicesWithSubscriptions.filter(
            (d) => d.canAddSubscription
          ).length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get subscription plans and pricing
const getSubscriptionPlans = async (req, res, next) => {
  try {
    const plans = [
      {
        id: "mobile-v4-basic",
        name: "Mobile V4 Basic",
        price: getSubscriptionPrice("mobile-v4-basic"),
        duration: getSubscriptionDuration("mobile-v4-basic"),
        features: [
          "Basic mobile encryption",
          "30-day subscription",
          "Standard support",
          "Single device",
        ],
        category: "mobile",
        version: "v4",
        tier: "basic",
      },
      {
        id: "mobile-v4-premium",
        name: "Mobile V4 Premium",
        price: getSubscriptionPrice("mobile-v4-premium"),
        duration: getSubscriptionDuration("mobile-v4-premium"),
        features: [
          "Premium mobile encryption",
          "60-day subscription",
          "Priority support",
          "Single device",
          "Advanced security features",
        ],
        category: "mobile",
        version: "v4",
        tier: "premium",
      },
      {
        id: "mobile-v4-enterprise",
        name: "Mobile V4 Enterprise",
        price: getSubscriptionPrice("mobile-v4-enterprise"),
        duration: getSubscriptionDuration("mobile-v4-enterprise"),
        features: [
          "Enterprise mobile encryption",
          "90-day subscription",
          "24/7 support",
          "Single device",
          "Advanced security features",
          "Custom configuration",
        ],
        category: "mobile",
        version: "v4",
        tier: "enterprise",
      },
      {
        id: "mobile-v5-basic",
        name: "Mobile V5 Basic",
        price: getSubscriptionPrice("mobile-v5-basic"),
        duration: getSubscriptionDuration("mobile-v5-basic"),
        features: [
          "Latest mobile encryption",
          "30-day subscription",
          "Standard support",
          "Single device",
          "Enhanced security",
        ],
        category: "mobile",
        version: "v5",
        tier: "basic",
      },
      {
        id: "mobile-v5-premium",
        name: "Mobile V5 Premium",
        price: getSubscriptionPrice("mobile-v5-premium"),
        duration: getSubscriptionDuration("mobile-v5-premium"),
        features: [
          "Latest premium mobile encryption",
          "60-day subscription",
          "Priority support",
          "Single device",
          "Advanced security features",
          "Real-time monitoring",
        ],
        category: "mobile",
        version: "v5",
        tier: "premium",
      },
      {
        id: "full-suite-basic",
        name: "Full Suite Basic",
        price: getSubscriptionPrice("full-suite-basic"),
        duration: getSubscriptionDuration("full-suite-basic"),
        features: [
          "Complete encryption suite",
          "60-day subscription",
          "Standard support",
          "Multi-platform support",
          "Basic analytics",
        ],
        category: "full-suite",
        version: "latest",
        tier: "basic",
      },
      {
        id: "full-suite-premium",
        name: "Full Suite Premium",
        price: getSubscriptionPrice("full-suite-premium"),
        duration: getSubscriptionDuration("full-suite-premium"),
        features: [
          "Complete premium encryption suite",
          "90-day subscription",
          "24/7 priority support",
          "Multi-platform support",
          "Advanced analytics",
          "Custom integrations",
          "Dedicated account manager",
        ],
        category: "full-suite",
        version: "latest",
        tier: "premium",
      },
    ];

    res.json({
      success: true,
      message: "Subscription plans retrieved successfully",
      data: {
        plans,
        categories: {
          mobile: plans.filter((p) => p.category === "mobile"),
          fullSuite: plans.filter((p) => p.category === "full-suite"),
        },
        versions: {
          v4: plans.filter((p) => p.version === "v4"),
          v5: plans.filter((p) => p.version === "v5"),
          latest: plans.filter((p) => p.version === "latest"),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// Add this function to controllers/adminController.js

const addSubscriptionToExistingDevice = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const {
      userId,
      imei,
      plan,
      paymentMethod = "ADMIN_APPROVAL",
      adminNotes = "",
      priority = 0,
      cards = [], // Optional: admin can upload cards or use existing
    } = req.body;

    const adminId = req.user._id;

    // Validation
    if (!userId || !imei || !plan) {
      throw new CustomError(400, "Missing required fields: userId, imei, plan");
    }

    // Validate plan
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
      throw new CustomError(400, "Invalid subscription plan");
    }

    await session.startTransaction();

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Verify device exists and belongs to user
    const device = await Device.findOne({
      imei,
      user: userId,
    }).session(session);

    if (!device) {
      throw new CustomError(
        404,
        "Device not found or does not belong to this user"
      );
    }

    // Check if user already has an active subscription for this device
    const existingActiveSubscription = await Subscription.findOne({
      user: userId,
      imei,
      status: "ACTIVE",
    }).session(session);

    if (existingActiveSubscription) {
      throw new CustomError(
        400,
        "User already has an active subscription for this device"
      );
    }

    // Check if user already has a pending subscription for this device
    const existingPendingSubscription = await Subscription.findOne({
      user: userId,
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).session(session);

    if (existingPendingSubscription) {
      throw new CustomError(
        400,
        "User already has a pending subscription for this device"
      );
    }

    // Calculate subscription price
    const subscriptionPrice = getSubscriptionPrice(plan);

    // Get next queue position for this device
    const queuePosition = await Subscription.getNextQueuePosition(imei);

    // Create new subscription
    const newSubscription = new Subscription({
      user: userId,
      imei,
      deviceName: device.deviceName,
      phone: user.phoneNumber || "",
      email: user.email,
      plan,
      price: subscriptionPrice,
      cards: cards.length > 0 ? cards : [], // Use provided cards or empty array
      queuePosition,
      status: "PENDING",
      queuedBy: adminId,
      queuedAt: new Date(),
      adminNotes,
      priority,
      originalDuration: getSubscriptionDuration(plan),
      totalPaid: 0, // Will be updated when payment is processed
    });

    await newSubscription.save({ session });
    console.log(`✅ New subscription created: ${newSubscription._id}`);

    // Create transaction record
    const transaction = new Transaction({
      user: userId,
      subscription: newSubscription._id,
      device: device._id,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_CREATED",
      amount: subscriptionPrice,
      plan,
      status: "PENDING",
      queuePosition,
      queuedAt: new Date(),
      processedBy: adminId,
      processedAt: new Date(),
      adminNotes: `Admin added subscription: ${adminNotes}`,
      paymentMethod,
      metadata: {
        userAgent: req.get("User-Agent") || "Admin Interface",
        ipAddress: req.ip || "Unknown",
        deviceInfo: {
          imei: imei,
          deviceName: device.deviceName,
        },
        adminAction: true,
        addedByAdmin: adminId,
        priority: priority,
        existingDevice: true,
      },
    });

    await transaction.save({ session });
    console.log(`✅ Transaction created: ${transaction.transactionId}`);

    // Reorder queue to ensure proper positioning based on priority
    await Subscription.reorderDeviceQueue(imei);

    await session.commitTransaction();

    // Send notification email (outside transaction)
    try {
      await sendSubscriptionQueuedEmail(
        user.email,
        user.username,
        plan,
        queuePosition
      );
    } catch (emailError) {
      console.error("Failed to send queue notification email:", emailError);
    }

    // Populate response data
    await newSubscription.populate([
      { path: "user", select: "username email phoneNumber" },
      { path: "queuedBy", select: "username email" },
    ]);

    res.status(201).json({
      success: true,
      message: "Subscription added successfully to existing device",
      data: {
        subscription: newSubscription,
        transaction: {
          id: transaction._id,
          transactionId: transaction.transactionId,
          status: transaction.status,
        },
        queueInfo: {
          position: queuePosition,
          deviceHasActive: await Subscription.hasActiveSubscription(imei),
          totalInQueue: await Subscription.countDocuments({
            imei,
            status: { $in: ["QUEUED", "PENDING"] },
          }),
        },
        device: {
          id: device._id,
          imei: device.imei,
          deviceName: device.deviceName,
          isOnboarded: device.isOnboarded,
        },
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Add subscription to existing device error:", err);
    next(err);
  } finally {
    await session.endSession();
  }
};

// Helper function to get user's devices (useful for frontend)
const getUserDevices = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Verify user exists
    const user = await User.findById(userId).select(
      "username email phoneNumber"
    );
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Get user's devices
    const devices = await Device.find({ user: userId });

    // Get subscription information for each device
    const devicesWithSubscriptions = await Promise.all(
      devices.map(async (device) => {
        const activeSubscription = await Subscription.findOne({
          imei: device.imei,
          status: "ACTIVE",
        });

        const pendingSubscriptions = await Subscription.find({
          imei: device.imei,
          status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
        }).sort({ queuePosition: 1 });

        const totalSubscriptions = await Subscription.countDocuments({
          imei: device.imei,
        });

        return {
          device: device.toObject(),
          activeSubscription,
          pendingSubscriptions,
          totalSubscriptions,
          canAddSubscription:
            !activeSubscription && pendingSubscriptions.length === 0,
        };
      })
    );

    res.json({
      success: true,
      data: {
        user,
        devices: devicesWithSubscriptions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get device subscription queue status
const getDeviceSubscriptionQueue = async (req, res, next) => {
  try {
    const { imei } = req.params;
    const { includeHistory = false } = req.query;

    if (!imei) {
      throw new CustomError(400, "IMEI is required");
    }

    // Get current queue (pending, queued, approved)
    const queuedSubscriptions = await Subscription.find({
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    })
      .populate("user", "username email phoneNumber")
      .populate("queuedBy", "username email")
      .sort({ queuePosition: 1, createdAt: 1 });

    // Get active subscription
    const activeSubscription = await Subscription.findOne({
      imei,
      status: "ACTIVE",
    }).populate("user", "username email phoneNumber");

    // Get device info
    const device = await Device.findOne({ imei }).populate(
      "user",
      "username email"
    );

    // Calculate queue statistics
    const queueStats = {
      totalInQueue: queuedSubscriptions.length,
      hasActiveSubscription: !!activeSubscription,
      nextInQueue: queuedSubscriptions[0] || null,
      estimatedProcessingTime:
        queuedSubscriptions.length > 0
          ? `${queuedSubscriptions.length * 2}-${
              queuedSubscriptions.length * 3
            } business days`
          : "No queue",
      deviceRegistered: !!device,
    };

    // Get history if requested
    let history = [];
    if (includeHistory === "true") {
      history = await Subscription.find({
        imei,
        status: { $in: ["EXPIRED", "CANCELLED"] },
      })
        .populate("user", "username email")
        .sort({ createdAt: -1 })
        .limit(10);
    }

    res.json({
      success: true,
      data: {
        imei,
        device,
        activeSubscription,
        queuedSubscriptions,
        queueStats,
        history: includeHistory === "true" ? history : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get subscription summary for device
const getDeviceSubscriptionSummary = async (req, res, next) => {
  try {
    const { imei } = req.params;

    if (!imei) {
      throw new CustomError(400, "IMEI is required");
    }

    // Get all subscription counts
    const subscriptionCounts = await Subscription.aggregate([
      { $match: { imei } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalValue: { $sum: "$price" },
        },
      },
    ]);

    // Get device info
    const device = await Device.findOne({ imei }).populate(
      "user",
      "username email"
    );

    // Transform counts into a more readable format
    const summary = {
      imei,
      device,
      subscriptions: {
        active: 0,
        pending: 0,
        queued: 0,
        approved: 0,
        expired: 0,
        cancelled: 0,
        total: 0,
      },
      revenue: {
        active: 0,
        pending: 0,
        total: 0,
      },
    };

    subscriptionCounts.forEach((item) => {
      const status = item._id.toLowerCase();
      if (summary.subscriptions.hasOwnProperty(status)) {
        summary.subscriptions[status] = item.count;
        summary.revenue[status] = item.totalValue;
      }
      summary.subscriptions.total += item.count;
      summary.revenue.total += item.totalValue;
    });

    // Calculate queue position if device has pending subscriptions
    const nextInQueue = await Subscription.findOne({
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).sort({ queuePosition: 1 });

    if (nextInQueue) {
      summary.queueInfo = {
        nextPosition: nextInQueue.queuePosition,
        totalInQueue:
          summary.subscriptions.pending +
          summary.subscriptions.queued +
          summary.subscriptions.approved,
      };
    }

    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

// Upgrade subscription
const upgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const oldPrice = subscription.price;
    const newPrice = getSubscriptionPrice(newPlan);

    if (newPrice <= oldPrice) {
      throw new CustomError(400, "New plan must be higher tier");
    }

    // Calculate prorated amount
    const remainingDays = Math.ceil(
      (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
    );
    const proratedAmount = newPrice - oldPrice;

    // Create upgrade transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_UPGRADED",
      amount: proratedAmount,
      plan: newPlan,
      status: "PENDING",
      metadata: {
        oldPlan,
        newPlan,
        proratedDays: remainingDays,
        fullNewPrice: newPrice,
        oldPrice,
      },
    });

    await transaction.save();

    // Update subscription
    subscription.plan = newPlan;
    subscription.price = newPrice;

    // Extend end date based on new plan duration
    const newDuration = getSubscriptionDuration(newPlan);
    subscription.endDate = new Date(
      subscription.startDate.getTime() + newDuration * 24 * 60 * 60 * 1000
    );

    await subscription.save();

    // Mark transaction as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      subscription,
      transaction,
      proratedAmount,
    });
  } catch (err) {
    next(err);
  }
};

// Downgrade subscription
const downgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const newPrice = getSubscriptionPrice(newPlan);

    // Create downgrade transaction (no immediate charge)
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_DOWNGRADED",
      amount: 0, // No immediate charge for downgrade
      plan: newPlan,
      status: "COMPLETED",
      metadata: {
        oldPlan,
        newPlan,
        effectiveDate: subscription.endDate, // Takes effect at next billing cycle
        newPrice,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    // Schedule the downgrade for next billing cycle
    subscription.pendingPlanChange = {
      newPlan,
      newPrice,
      effectiveDate: subscription.endDate,
    };

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription downgrade scheduled for next billing cycle",
      subscription,
      transaction,
      effectiveDate: subscription.endDate,
    });
  } catch (err) {
    next(err);
  }
};

// Cancel subscription
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { reason, immediate = false } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_CANCELLED",
      amount: 0,
      plan: subscription.plan,
      status: "COMPLETED",
      metadata: {
        cancellationReason: reason,
        immediate,
        originalEndDate: subscription.endDate,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    if (immediate) {
      subscription.status = "CANCELLED";
      subscription.endDate = new Date();
    } else {
      subscription.cancelledAt = new Date();
      subscription.cancellationReason = reason;
      // Subscription remains active until end date
    }

    await subscription.save();

    res.json({
      success: true,
      message: immediate
        ? "Subscription cancelled immediately"
        : "Subscription will end at the current billing cycle",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

// Renew expired subscription
const renewSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "EXPIRED",
    });

    if (!subscription) {
      throw new CustomError(404, "Expired subscription not found");
    }

    // Create renewal transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_ACTIVATED",
      amount: subscription.price,
      plan: subscription.plan,
      status: "PENDING",
    });

    await transaction.save();

    // This would typically integrate with payment processing
    // For now, we'll mark as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    // Reactivate subscription
    const duration = getSubscriptionDuration(subscription.plan);
    subscription.status = "ACTIVE";
    subscription.startDate = new Date();
    subscription.endDate = new Date(
      Date.now() + duration * 24 * 60 * 60 * 1000
    );
    subscription.cancelledAt = null;
    subscription.cancellationReason = null;

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription renewed successfully",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

const renewActiveSubscription = async (req, res, next) => {
  console.log("[renewActiveSubscription SERVER]:", req.body);
  const {
    subscriptionId,
    newPlan,
    paymentMethod = "ADMIN_APPROVAL",
  } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!subscriptionId || !newPlan) {
      throw new CustomError(400, "Please provide subscriptionId and newPlan");
    }

    await session.startTransaction();

    // Find the active subscription
    const subscription = await Subscription.findById(subscriptionId).session(
      session
    );

    console.log("HHH", subscription);

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    // Verify ownership
    if (subscription.user.toString() !== userId.toString()) {
      throw new CustomError(403, "Unauthorized access to subscription");
    }

    // Check if subscription is active
    if (subscription.status !== "ACTIVE") {
      throw new CustomError(400, "Only active subscriptions can be renewed");
    }

    // Get current plan details
    const currentPlan = subscription.plan;
    const currentEndDate = subscription.endDate;
    const now = new Date();

    // Calculate remaining days on current subscription
    const remainingMs = currentEndDate.getTime() - now.getTime();
    const remainingDays = Math.max(
      0,
      Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
    );

    // Get new plan duration and price
    const newPlanDuration = getSubscriptionDuration(newPlan);
    const newPlanPrice = getSubscriptionPrice(newPlan);

    // Calculate new end date (current end date + new plan duration)
    const newEndDate = new Date(currentEndDate);
    newEndDate.setDate(newEndDate.getDate() + newPlanDuration);

    // Create renewal transaction
    const renewalTransaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      device: subscription.device || undefined, // Fix: use proper device ObjectId or undefined
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_RENEWAL",
      amount: newPlanPrice,
      plan: newPlan,
      status: "COMPLETED", // Mark as completed for admin approval method
      paymentMethod,
      processedAt: new Date(),
      subscriptionPeriod: {
        startDate: currentEndDate, // Renewal starts when current subscription ends
        endDate: newEndDate,
        duration: newPlanDuration,
      },
      metadata: {
        userAgent: req.get("User-Agent") || "Unknown",
        ipAddress: req.ip || "Unknown",
        previousPlan: currentPlan,
        newPlan: newPlan,
        remainingDaysOnRenewal: remainingDays,
        renewalType: "EXTENSION", // This is an extension, not replacement
        deviceInfo: {
          imei: subscription.imei,
          deviceName: subscription.deviceName,
        },
      },
    });

    await renewalTransaction.save({ session });

    // Update subscription with renewal details
    subscription.endDate = newEndDate;
    subscription.plan = newPlan; // Update to new plan
    subscription.price = newPlanPrice; // Update to new plan price
    subscription.updatedAt = now;

    // Add renewal history to subscription (optional)
    if (!subscription.renewalHistory) {
      subscription.renewalHistory = [];
    }

    subscription.renewalHistory.push({
      renewedAt: now,
      previousPlan: currentPlan,
      newPlan: newPlan,
      addedDuration: newPlanDuration,
      transactionId: renewalTransaction.transactionId,
      remainingDaysAtRenewal: remainingDays,
    });

    await subscription.save({ session });

    await session.commitTransaction();

    // Populate response data
    await subscription.populate([
      { path: "user", select: "username email phoneNumber" },
    ]);

    res.json({
      success: true,
      message: "Subscription renewed successfully",
      data: {
        subscription: {
          id: subscription._id,
          plan: subscription.plan,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          price: subscription.price,
          renewalDetails: {
            renewedAt: now,
            previousPlan: currentPlan,
            newPlan: newPlan,
            addedDuration: newPlanDuration,
            remainingDaysAtRenewal: remainingDays,
            newEndDate: newEndDate,
          },
        },
        transaction: {
          id: renewalTransaction._id,
          transactionId: renewalTransaction.transactionId,
          amount: renewalTransaction.amount,
          status: renewalTransaction.status,
          type: renewalTransaction.type,
        },
        summary: {
          planChanged: currentPlan !== newPlan,
          durationAdded: `${newPlanDuration} days`,
          totalRemainingDays: Math.ceil(
            (newEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          ),
          renewalCost: newPlanPrice,
        },
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Subscription renewal error:", err);

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
    } else {
      next(
        new CustomError(
          500,
          "Subscription renewal failed due to server error. Please try again."
        )
      );
    }
  } finally {
    await session.endSession();
  }
};

// Get subscription renewal options and pricing
const getRenewalOptions = async (req, res, next) => {
  try {
    const subscriptionId = req.params.id;
    const userId = req.user._id;

    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.user.toString() !== userId.toString()) {
      throw new CustomError(403, "Unauthorized access to subscription");
    }

    if (subscription.status !== "ACTIVE") {
      throw new CustomError(400, "Only active subscriptions can be renewed");
    }

    const currentPlan = subscription.plan;
    const currentEndDate = subscription.endDate;
    const now = new Date();

    // Calculate remaining time
    const remainingMs = currentEndDate.getTime() - now.getTime();
    const remainingDays = Math.max(
      0,
      Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
    );

    // Available renewal plans
    const availablePlans = [
      "mobile-v4-basic",
      "mobile-v4-premium",
      "mobile-v4-enterprise",
      "mobile-v5-basic",
      "mobile-v5-premium",
      "full-suite-basic",
      "full-suite-premium",
    ];

    const renewalOptions = availablePlans.map((plan) => {
      const duration = getSubscriptionDuration(plan);
      const price = getSubscriptionPrice(plan);
      const newEndDate = new Date(currentEndDate);
      newEndDate.setDate(newEndDate.getDate() + duration);

      return {
        plan,
        duration: `${duration} days`,
        price,
        newEndDate,
        totalDaysAfterRenewal: Math.ceil(
          (newEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        ),
        isCurrentPlan: plan === currentPlan,
        recommended:
          plan === currentPlan ||
          (plan.includes("premium") && !currentPlan.includes("enterprise")),
      };
    });

    res.json({
      success: true,
      data: {
        currentSubscription: {
          id: subscription._id,
          plan: currentPlan,
          endDate: currentEndDate,
          remainingDays,
          status: subscription.status,
        },
        renewalOptions,
        summary: {
          currentPlanPrice: getSubscriptionPrice(currentPlan),
          currentPlanDuration: getSubscriptionDuration(currentPlan),
          canRenew: true,
          renewalMessage: `Your subscription will be extended from ${currentEndDate.toLocaleDateString()} by the duration of your chosen plan.`,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get subscription renewal history
const getRenewalHistory = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.user.toString() !== userId.toString()) {
      throw new CustomError(403, "Unauthorized access to subscription");
    }

    // Get all renewal transactions for this subscription
    const renewalTransactions = await Transaction.find({
      subscription: subscriptionId,
      type: "SUBSCRIPTION_RENEWED",
    })
      .sort({ createdAt: -1 })
      .limit(20);

    const renewalHistory = renewalTransactions.map((tx) => ({
      transactionId: tx.transactionId,
      renewedAt: tx.createdAt,
      plan: tx.plan,
      amount: tx.amount,
      duration:
        tx.subscriptionPeriod?.duration || getSubscriptionDuration(tx.plan),
      status: tx.status,
      previousPlan: tx.metadata?.previousPlan,
      addedDuration:
        tx.metadata?.addedDuration || getSubscriptionDuration(tx.plan),
    }));

    res.json({
      success: true,
      data: {
        subscription: {
          id: subscription._id,
          currentPlan: subscription.plan,
          status: subscription.status,
          endDate: subscription.endDate,
        },
        renewalHistory,
        summary: {
          totalRenewals: renewalHistory.length,
          totalSpentOnRenewals: renewalHistory.reduce(
            (sum, renewal) => sum + renewal.amount,
            0
          ),
          latestRenewal: renewalHistory[0] || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const checkActiveSubscriptionStatus = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    const activeSubscriptions = await Subscription.find({
      user: userId,
      status: "ACTIVE",
    }).select("plan imei deviceName startDate endDate");

    const hasActive = activeSubscriptions.length > 0;

    res.json({
      success: true,
      data: {
        hasActiveSubscription: hasActive,
        activeCount: activeSubscriptions.length,
        activeSubscriptions: activeSubscriptions,
        message: hasActive
          ? `User has ${activeSubscriptions.length} active subscription(s)`
          : "User has no active subscriptions",
      },
    });
  } catch (err) {
    next(err);
  }
};

// models/subscription.js - Add this to the existing subscription schema

// Add these fields to the SubscriptionSchema:
/*
    // Renewal tracking fields (add these to existing schema)
    renewalHistory: [{
      renewedAt: {
        type: Date,
        default: Date.now,
      },
      previousPlan: {
        type: String,
        required: true,
      },
      newPlan: {
        type: String,
        required: true,
      },
      addedDuration: {
        type: Number, // days
        required: true,
      },
      transactionId: {
        type: String,
        required: true,
      },
      remainingDaysAtRenewal: {
        type: Number,
        default: 0,
      },
    }],
    
    // Track last renewal
    lastRenewalDate: {
      type: Date,
    },
    
    // Count of renewals
    renewalCount: {
      type: Number,
      default: 0,
    },
*/

// routes/subscription.js - Add these routes to the existing router

/*
// Add these routes to your existing subscription routes:

// Renewal management
router.get("/:id/renewal-options", getRenewalOptions);
router.post("/:id/renew", renewActiveSubscription);
router.get("/:id/renewal-history", getRenewalHistory);
*/

module.exports = {
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  renewSubscription,
  checkDeviceIsOnboarded,
  setupDeviceOtp,
  activateSubscription,
  newSubscription,
  addDeviceSubscription,
  addSubscriptionToMyDevice,
  getDeviceSubscriptionQueue,
  getDeviceSubscriptionSummary,
  addSubscriptionToExistingDevice,
  getUserDevices,
  checkActiveSubscriptionStatus,
  renewActiveSubscription,
  getRenewalOptions,
  getRenewalHistory,
};
