// models/subscription.js - Updated with renewal tracking fields
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

    // NEW: Renewal tracking fields
    renewalHistory: [
      {
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
      },
    ],

    // Track last renewal
    lastRenewalDate: {
      type: Date,
    },

    // Count of renewals
    renewalCount: {
      type: Number,
      default: 0,
    },

    // Track total subscription value
    totalPaid: {
      type: Number,
      default: 0,
    },

    // Original subscription duration for reference
    originalDuration: {
      type: Number, // days
    },
  },
  { versionKey: false, timestamps: true }
);

// Index for efficient queue queries
SubscriptionSchema.index({ imei: 1, status: 1, queuePosition: 1 });
SubscriptionSchema.index({ status: 1, queuePosition: 1 });
SubscriptionSchema.index({ user: 1, status: 1 });

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

// NEW: Instance method to process renewal
SubscriptionSchema.methods.renewSubscription = async function (
  newPlan,
  addedDuration,
  transactionId
) {
  const now = new Date();
  const currentEndDate = this.endDate || now;

  // Calculate remaining days
  const remainingMs = Math.max(0, currentEndDate.getTime() - now.getTime());
  const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

  // Add renewal to history
  this.renewalHistory.push({
    renewedAt: now,
    previousPlan: this.plan,
    newPlan: newPlan,
    addedDuration: addedDuration,
    transactionId: transactionId,
    remainingDaysAtRenewal: remainingDays,
  });

  // Update subscription details
  this.plan = newPlan;
  this.endDate = new Date(
    currentEndDate.getTime() + addedDuration * 24 * 60 * 60 * 1000
  );
  this.lastRenewalDate = now;
  this.renewalCount = (this.renewalCount || 0) + 1;

  return await this.save();
};

// NEW: Method to calculate total days remaining
SubscriptionSchema.methods.getDaysRemaining = function () {
  if (!this.endDate || this.status !== "ACTIVE") {
    return 0;
  }

  const now = new Date();
  const remainingMs = Math.max(0, this.endDate.getTime() - now.getTime());
  return Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
};

// NEW: Method to check if subscription is eligible for renewal
SubscriptionSchema.methods.isEligibleForRenewal = function () {
  return this.status === "ACTIVE" && this.endDate && this.endDate > new Date();
};

module.exports = mongoose.model("Subscription", SubscriptionSchema);
