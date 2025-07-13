// models/subscription.js - Updated with QUEUED status
const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      ref: "User",
    },
    imei: {
      type: String,
      required: true,
    },
    deviceName: {
      type: String,
      required: true,
      default: "Device",
      trim: true,
      maxlength: [100, "Device name cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: [0, "Subscription price cannot be negative"],
    },
    cards: {
      type: [String],
      default: [],
    },
    queuePosition: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: {
        values: [
          "PENDING",
          "QUEUED",
          "ACTIVE",
          "EXPIRED",
          "CANCELLED",
          "APPROVED",
        ],
        message:
          "Status must be one of: PENDING, QUEUED, APPROVED, ACTIVE, EXPIRED, CANCELLED",
      },
      required: [true, "Status is required"],
      default: "PENDING",
    },
    // Admin tracking fields
    queuedBy: {
      type: String,
      ref: "User", // Admin who queued it
    },
    queuedAt: {
      type: Date,
    },
    reviewedBy: {
      type: String,
      ref: "User", // Admin who reviewed
    },
    reviewedAt: {
      type: Date,
    },
    adminNotes: {
      type: String,
      trim: true,
    },
    // Priority for queue ordering (optional)
    priority: {
      type: Number,
      default: 0, // Higher number = higher priority
    },
  },
  { versionKey: false, timestamps: true }
);

// Index for efficient queue queries
SubscriptionSchema.index({ imei: 1, status: 1, queuePosition: 1 });
SubscriptionSchema.index({ status: 1, queuePosition: 1 });

// Static method to get next queue position for a device
SubscriptionSchema.statics.getNextQueuePosition = async function (imei) {
  const lastQueued = await this.findOne({
    imei,
    status: { $in: ["QUEUED", "PENDING"] },
  }).sort({ queuePosition: -1 });

  if (!lastQueued || !lastQueued.queuePosition) {
    return "1";
  }

  const lastPosition = parseInt(lastQueued.queuePosition) || 0;
  return (lastPosition + 1).toString();
};

// Static method to reorder queue positions for a device
SubscriptionSchema.statics.reorderDeviceQueue = async function (imei) {
  const queuedSubs = await this.find({
    imei,
    status: { $in: ["QUEUED", "PENDING"] },
  }).sort({ priority: -1, createdAt: 1 }); // High priority first, then FIFO

  for (let i = 0; i < queuedSubs.length; i++) {
    queuedSubs[i].queuePosition = (i + 1).toString();
    await queuedSubs[i].save();
  }

  return queuedSubs.length;
};

// Static method to check if device has active subscription
SubscriptionSchema.statics.hasActiveSubscription = async function (imei) {
  const activeCount = await this.countDocuments({
    imei,
    status: "ACTIVE",
  });

  return activeCount > 0;
};

// Instance method to move to next in queue
SubscriptionSchema.methods.moveToQueue = async function (adminId, notes = "") {
  this.status = "QUEUED";
  this.queuedBy = adminId;
  this.queuedAt = new Date();
  this.adminNotes = notes;

  // Get next queue position
  if (!this.queuePosition) {
    this.queuePosition = await this.constructor.getNextQueuePosition(this.imei);
  }

  return await this.save();
};

module.exports = mongoose.model("Subscription", SubscriptionSchema);
