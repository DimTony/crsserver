// models/user.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    // Email verification fields
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      default: null,
    },
    emailVerificationExpires: {
      type: Date,
      default: null,
    },
    // Account status
    isActive: {
      type: Boolean,
      default: false, // Will be set to true after email verification
    },
    // Additional user fields (if needed)
    phoneNumber: {
      type: String,
    },
    deviceInfo: {
      deviceName: String,
      imei: String,
    },
    subscription: {
      plan: String,
      startDate: Date,
      status: {
        type: String,
        enum: ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"],
        default: "PENDING",
      },
    },
    role: {
      type: String,
      enum: ["user", "admin", "super_admin", "guest"],
      default: "guest",
    },
    encryptionCards: [
      {
        originalName: String,
        cloudinaryUrl: String,
        cloudinaryPublicId: String,
        size: Number,
        format: String,
        mimetype: String,
        uploadedAt: Date,
      },
    ],
    // Tracking fields
    lastLoginAt: {
      type: Date,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    stats: {
      messageCount: {
        type: Number,
        default: 0,
      },
      activeDevices: {
        type: Number,
        default: 1,
      },
    },
    adminInfo: {
      employeeId: {
        type: String,
        default: 1,
      },
      department: {
        type: String,
      },
      accessLevel: {
        type: Number,
        default: 1,
      },
      canApproveSubscriptions: {
        type: Boolean,
        default: false,
      },
      canViewAnalytics: {
        type: Boolean,
        default: false,
      },
      canManageUsers: {
        type: Boolean,
        default: false,
      },
      maxApprovalAmount: {
        type: Number,
        default: 1,
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

// Index for email verification token lookup
UserSchema.index({ emailVerificationToken: 1 });

// Method to check if verification token is valid
UserSchema.methods.isVerificationTokenValid = function () {
  return (
    this.emailVerificationExpires && this.emailVerificationExpires > Date.now()
  );
};

// Method to activate user account
UserSchema.methods.activateAccount = function () {
  this.isEmailVerified = true;
  this.isActive = true;
  this.emailVerificationToken = null;
  this.emailVerificationExpires = null;
  return this.save();
};

// Method to generate new verification token
UserSchema.methods.generateVerificationToken = function () {
  const crypto = require("crypto");
  const token = crypto.randomBytes(32).toString("hex");

  this.emailVerificationToken = token;
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return token;
};

// Static method to find user by verification token
UserSchema.statics.findByValidVerificationToken = function (token) {
  return this.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: Date.now() },
  });
};

// Clean up expired verification tokens (optional)
UserSchema.statics.cleanupExpiredTokens = function () {
  return this.updateMany(
    {
      emailVerificationExpires: { $lt: Date.now() },
      isEmailVerified: false,
    },
    {
      $unset: {
        emailVerificationToken: 1,
        emailVerificationExpires: 1,
      },
    }
  );
};

module.exports = mongoose.model("User", UserSchema);
