const mongoose = require("mongoose");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const Transaction = require("../models/transaction");
const Device = require("../models/device");
const Subscription = require("../models/subscription");
const {
  getSubscriptionPrice,
  getSubscriptionDuration,
} = require("../utils/helpers");
const CustomError = require("../utils/customError");
const crypto = require("crypto");
const User = require("../models/user");
const { sendSubscriptionQueuedEmail } = require("../config/emailService");

// Helper function to extract request metadata
const extractRequestMetadata = (req) => ({
  userAgent: req.get("User-Agent") || "Unknown",
  ipAddress: req.ip || req.connection.remoteAddress || "Unknown",
});

// Helper function to generate random string for TOTP secret
const generateRandomString = (length) => {
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

const searchDevices = async (req, res, next) => {
  console.log("[searchDevices SERVER]:", req.query);

  const query = req.query.q;
  const userId = req.user._id;

    const session = await mongoose.startSession();
  
  try {
    if (!query || typeof query !== "string") {
      throw new CustomError(400, "Missing or invalid query parameter `q`");
    }

    await session.startTransaction();


    
    const regex = new RegExp(query, "i");

    const results = await Device.find({
      $or: [{ imei: regex }, { deviceName: regex }],
    }).select("-totpSecret"); // Optional: hide sensitive field

    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("searchDevices error:", err);

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

// Add new subscription to existing or new device
const addNewDeviceToExisitingUser = async (req, res, next) => {
  console.log("[ADD DEVICE SUBSCRIPTION]:", req.body);
  console.log("[ADD DEVICE SUBSCRIPTION]:", req.user);

  const { deviceName, imei, plan, files } = req.body;
  const userId = req.user._id;
  const { username, email } = req.user;

  // Extract request metadata for transaction logging
  const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!deviceName || !imei || !plan) {
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


    // Start transaction
    await session.startTransaction();

    // let targetUser;


      // Using existing user scenario
      if (!userId) {
        throw new CustomError(400, "User ID is required for existing user");
      }

      const targetUser = await User.findById(userId).session(session);
      if (!targetUser) {
        await session.abortTransaction();
        throw new CustomError(404, "User not found");
      }
      console.log(`✅ Using existing user: ${targetUser._id}`);
    

    // Check for active subscriptions on phone number
    const hasActiveSubscription = await Subscription.findOne({
      imei,
      user: userId,
      status: "ACTIVE",
    }).session(session);

    if (hasActiveSubscription) {
      await session.abortTransaction();
      throw new CustomError(
        400,
        "Device already has an active subscription"
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

const addNewDeviceForUser = async (req, res, next) => {
  console.log("[ADD NEW DEVICE FOR USER]:", req.body);
  console.log("[USER INFO]:", req.user);

  const { deviceName, imei, phoneNumber, plan, files, submissionNotes } =
    req.body;

  const userId = req.user._id.toString();
  const userEmail = req.user.email;
  const username = req.user.username;

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

    // Verify user is still active and email verified
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      throw new CustomError(404, "User not found");
    }

    if (!user.isEmailVerified) {
      await session.abortTransaction();
      throw new CustomError(
        403,
        "Please verify your email address before adding a device"
      );
    }

    if (!user.isActive) {
      await session.abortTransaction();
      throw new CustomError(
        403,
        "Account is not active. Please contact support."
      );
    }

    // Check if device with this IMEI already exists
    const existingDevice = await Device.findOne({ imei }).session(session);

    if (existingDevice) {
      // Check if device belongs to another user
      if (existingDevice.user && existingDevice.user.toString() !== userId) {
        await session.abortTransaction();
        throw new CustomError(
          400,
          "Device is already registered to another user"
        );
      }

      // Check if user already has this device
      if (existingDevice.user && existingDevice.user.toString() === userId) {
        await session.abortTransaction();
        throw new CustomError(
          400,
          "You have already registered this device. Please check your devices list."
        );
      }
    }

    // Check for active subscriptions on this phone number
    const hasActiveSubscription = await Subscription.findOne({
      phone: phoneNumber,
      status: "ACTIVE",
    }).session(session);

    if (hasActiveSubscription) {
      await session.abortTransaction();
      throw new CustomError(
        400,
        "This phone number already has an active subscription"
      );
    }

    // Check for active subscriptions on this IMEI
    const hasActiveDeviceSubscription = await Subscription.findOne({
      imei,
      status: "ACTIVE",
    }).session(session);

    if (hasActiveDeviceSubscription) {
      await session.abortTransaction();
      throw new CustomError(
        400,
        "This device already has an active subscription"
      );
    }

    // Create or update device
    let device;
    let isNewDevice = false;

    if (existingDevice && !existingDevice.user) {
      // Update existing unassigned device
      existingDevice.user = userId;
      existingDevice.deviceName = deviceName;
      await existingDevice.save({ session });
      device = existingDevice;
      console.log(`✅ Updated existing device: ${device._id}`);
    } else {
      // Create new device
      const totpSecret = generateRandomString(32);
      device = new Device({
        user: userId,
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
      user: userId,
      imei,
      deviceName,
      phone: phoneNumber,
      email: userEmail,
      plan,
      price: subscriptionPrice,
      cards: files,
      queuePosition,
      status: "PENDING",
      originalDuration: getSubscriptionDuration(plan),
      totalPaid: 0,
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
            imei: imei || "",
            deviceName: deviceName || "",
          },
          submissionNotes: submissionNotes || "",
          encryptionCards: files || [],
          phoneNumber: phoneNumber || "",
          email: userEmail || "",
          existingUser: true,
          isNewDevice,
          addedByUser: true,
        },
      });

      await transaction.save({ session });
      console.log(
        `✅ Transaction record created: ${transaction.transactionId}`
      );
    } catch (transactionError) {
      console.error("Failed to create transaction record:", transactionError);
      // Don't fail the device addition for transaction logging errors
    }

    // Commit transaction - all operations succeeded
    await session.commitTransaction();
    console.log("✅ Transaction committed successfully");

    // Send subscription queued notification email (outside transaction)
    let emailSent = false;
    try {
      await sendSubscriptionQueuedEmail(
        userEmail,
        username,
        plan,
        queuePosition
      );
      console.log(`✅ Subscription queued email sent to ${userEmail}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send subscription queued email:", emailError);
      emailSent = false;
    }

    // Get device queue information
    const deviceQueueInfo = await Subscription.find({
      imei,
      status: { $in: ["PENDING", "QUEUED", "APPROVED"] },
    }).sort({ queuePosition: 1 });

    // Get user's total devices
    const userDevicesCount = await Device.countDocuments({ user: userId });

    // Prepare response
    const responseData = {
      device: {
        id: device._id,
        imei: device.imei,
        deviceName: device.deviceName,
        isNewDevice,
        isOnboarded: device.isOnboarded,
        createdAt: device.createdAt,
      },
      subscription: {
        id: newSubscription._id,
        plan: newSubscription.plan,
        status: newSubscription.status,
        queuePosition: newSubscription.queuePosition,
        estimatedReviewTime: "2-3 business days",
        price: newSubscription.price,
        createdAt: newSubscription.createdAt,
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
      userInfo: {
        totalDevices: userDevicesCount,
        email: userEmail,
        username: username,
      },
      notifications: {
        emailSent,
        message: emailSent
          ? "Device added successfully! You will receive email updates about your subscription status."
          : "Device added successfully! Please contact support for subscription status updates.",
      },
    };

    // Add upload warnings if any
    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    res.status(201).json({
      success: true,
      message:
        "Device and subscription added successfully and queued for admin review.",
      data: responseData,
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Add device error:", err);

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
          "Failed to add device due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

// Get user's devices with subscription information
const getUserDevices = async (req, res, next) => {
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

module.exports = {
  searchDevices,
  addNewDeviceForUser,
  getUserDevices,
};
