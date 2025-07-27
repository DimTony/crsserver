// controllers/authController.js - Updated with Transaction Logging
const axios = require("axios");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user");
const Ip = require("../models/ip");
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

const fetchIpInfo = async (ip) => {
  try {
    const response = await axios.get(`https://ipwho.is/${ip}`);
    const data = response.data;

    if (data.success === false) {
      return null;
    }

    return {
      city: data.city,
      region: data.region,
      country: data.country,
      latitude: data.latitude,
      longitude: data.longitude,
      connection: data.connection,
    };
  } catch (error) {
    console.error("Error fetching IP info:", error);
    return null;
  }
};

const checkEncryptionByIP = async (req, res, next) => {
  console.log("[checkEncryption SERVER]:", req.body);
  const { ip } = req.body;

  // Extract request metadata for transaction logging
  // const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!ip) {
      throw new CustomError(400, "Please provide all required fields");
    }

    let ipRecord = await Ip.findOne({ ip });

    // Validation checks

    if (ipRecord) {
      console.log("PPPP", ipRecord);
      ipRecord.accessCount += 1;
      ipRecord.lastAccessed = Date.now();
      await ipRecord.save();

      return res.status(200).json({
        success: true,
        message: "IP scanned successfully",
        data: {
          encrypted: ipRecord.isEncrypted,
          encryptionStatus: ipRecord.encryptionStatus,
          newRecord: false,
        },
      });
    }

    const ipInfo = await fetchIpInfo(ip);

    ipRecord = new Ip({
      ip,
      isEncrypted: false, // Default to false for new IPs
      city: ipInfo?.city,
      region: ipInfo?.region,
      country: ipInfo?.country,
      latitude: ipInfo?.latitude,
      longitude: ipInfo?.longitude,
      isp: ipInfo?.connection?.isp,
    });

    await ipRecord.save();

    res.status(200).json({
      success: true,
      message: "IP scanned successfully",
      data: {
        encrypted: false, // New IPs are assumed not encrypted
        encryptionStatus: "unapproved",
        newRecord: true,
      },
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

const checkEncryptionByIMEI = async (req, res, next) => {
  console.log("[checkEncryptionByIMEI SERVER]:", req.body);
  console.log("[checkEncryptionByIMEI SERVER]:", req.user);
  const { imei } = req.body;

  // Extract request metadata for transaction logging
  // const requestMetadata = extractRequestMetadata(req);

  // Start a database session for transaction
  const session = await mongoose.startSession();

  try {
    // Input validation
    if (!imei) {
      throw new CustomError(400, "Please provide all required fields");
    }

    const device = await Device.findOne({
      user: req.user._id,
      imei,
    });

    res.status(200).json({
      success: true,
      message: "Device scanned successfully",
      data: {
       

        isOnboarded: device?.isOnboarded || false,
        deviceExists: !!device,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("checkEncryptionByIMEI error:", err);

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
          "checkEncryptionByIMEI failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
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

module.exports = {
  checkEncryptionByIMEI,
  checkEncryptionByIP,
  login,
  getUser,
};
