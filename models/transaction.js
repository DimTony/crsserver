// models/transaction.js
const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // Reference IDs
    user: {
      type: String,
      required: true,
      ref: "User",
      index: true,
    },
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      // ref: "Device",
      // required: true,
    },

    // Transaction Details
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "SUBSCRIPTION_CREATED",
        "SUBSCRIPTION_ACTIVATED",
        "SUBSCRIPTION_CANCELLED",
        "SUBSCRIPTION_EXPIRED",
        "SUBSCRIPTION_QUEUED",
        "SUBSCRIPTION_REFUNDED",
        "SUBSCRIPTION_RENEWAL",
        "SUBSCRIPTION_UPGRADED",
        "SUBSCRIPTION_DOWNGRADED",
        "PAYMENT_PENDING",
        "PAYMENT_COMPLETED",
        "PAYMENT_FAILED",
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "QUEUED",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
      ],
      default: "PENDING",
      index: true,
    },

    // Financial Information
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      required: true,
    },
    plan: {
      type: String,
      required: true,
      index: true,
    },

    // Payment Information
    paymentMethod: {
      type: String,
      enum: [
        "ADMIN_APPROVAL",
        "CREDIT_CARD",
        "BANK_TRANSFER",
        "PAYPAL",
        "CRYPTO",
        "FREE_TRIAL",
      ],
      default: "ADMIN_APPROVAL",
    },
    paymentProvider: {
      type: String, // e.g., "stripe", "paypal", "internal"
    },
    externalTransactionId: {
      type: String, // ID from payment provider
      index: true,
    },

    // Subscription Period
    subscriptionPeriod: {
      startDate: Date,
      endDate: Date,
      duration: Number, // in days
    },

    // Admin Actions (for admin-processed transactions)
    processedBy: {
      type: String,
      ref: "User", // Admin who processed
    },
    processedAt: {
      type: Date,
    },
    adminNotes: {
      type: String,
    },

    // Queue Information (for subscription creation)
    queuePosition: {
      type: String,
    },
    queuedAt: {
      type: Date,
    },
    approvedAt: {
      type: Date,
    },

    // Transaction Metadata
    metadata: {
      userAgent: String,
      ipAddress: String,
      deviceInfo: {
        imei: String,
        deviceName: String,
      },
      submissionNotes: String,
      encryptionCards: [String], // URLs to uploaded cards
      phoneNumber: String,
      email: String,
    },

    // Audit Trail
    previousTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },
    relatedTransactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],

    // Error Information (for failed transactions)
    errorDetails: {
      code: String,
      message: String,
      stackTrace: String,
    },

    // Timestamps
    initiatedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    versionKey: false,
    timestamps: true,
    // Add compound indexes for common queries
    indexes: [
      { user: 1, createdAt: -1 },
      { subscription: 1, type: 1 },
      { status: 1, createdAt: -1 },
      { type: 1, createdAt: -1 },
      { transactionId: 1 },
      { externalTransactionId: 1 },
    ],
  }
);

// Generate unique transaction ID
TransactionSchema.statics.generateTransactionId = function() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `TXN_${timestamp}_${randomStr}`.toUpperCase();
};

// Static method to create subscription transaction
TransactionSchema.statics.createSubscriptionTransaction = async function(subscriptionData, type = "SUBSCRIPTION_CREATED") {
  const transactionId = this.generateTransactionId();
  
  const transaction = new this({
    user: subscriptionData.user,
    subscription: subscriptionData._id,
    device: subscriptionData.device || null,
    transactionId,
    type,
    amount: subscriptionData.price || 0,
    plan: subscriptionData.plan,
    status: "PENDING",
    subscriptionPeriod: {
      startDate: subscriptionData.startDate,
      endDate: subscriptionData.endDate,
      duration: subscriptionData.duration,
    },
    queuePosition: subscriptionData.queuePosition,
    queuedAt: subscriptionData.createdAt || new Date(),
    metadata: {
      deviceInfo: {
        imei: subscriptionData.imei,
        deviceName: subscriptionData.deviceName,
      },
      encryptionCards: subscriptionData.cards || [],
      phoneNumber: subscriptionData.phone,
      email: subscriptionData.email,
      submissionNotes: subscriptionData.submissionNotes,
    },
  });
  
  return await transaction.save();
};

// Instance method to update transaction status
TransactionSchema.methods.updateStatus = async function(newStatus, additionalData = {}) {
  this.status = newStatus;
  
  if (newStatus === "COMPLETED") {
    this.completedAt = new Date();
  }
  
  // Merge additional data
  Object.assign(this, additionalData);
  
  return await this.save();
};

// Instance method to add admin processing info
TransactionSchema.methods.processedByAdmin = async function(adminId, notes = "") {
  this.processedBy = adminId;
  this.processedAt = new Date();
  this.adminNotes = notes;
  
  return await this.save();
};

// Static method to get user transaction history
TransactionSchema.statics.getUserTransactionHistory = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type,
    status,
    startDate,
    endDate,
  } = options;
  
  const filter = { user: userId };
  
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }
  
  const skip = (page - 1) * limit;
  
  const transactions = await this.find(filter)
    .populate("subscription", "plan status")
    .populate("device", "deviceName imei")
    .populate("processedBy", "username email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  const total = await this.countDocuments(filter);
  
  return {
    transactions,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      hasNext: skip + transactions.length < total,
      hasPrev: page > 1,
    },
  };
};

// Static method for financial reporting
TransactionSchema.statics.getFinancialSummary = async function(dateRange = {}) {
  const { startDate, endDate } = dateRange;
  const matchStage = {};
  
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }
  
  const summary = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          status: "$status",
          type: "$type",
          plan: "$plan",
        },
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        avgAmount: { $avg: "$amount" },
      },
    },
    {
      $group: {
        _id: "$_id.status",
        transactions: {
          $push: {
            type: "$_id.type",
            plan: "$_id.plan",
            count: "$count",
            totalAmount: "$totalAmount",
            avgAmount: "$avgAmount",
          },
        },
        totalTransactions: { $sum: "$count" },
        totalRevenue: { $sum: "$totalAmount" },
      },
    },
  ]);
  
  return summary;
};

module.exports = mongoose.model("Transaction", TransactionSchema);