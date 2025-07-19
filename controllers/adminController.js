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
  sendSubscriptionApprovedEmail,
  sendSubscriptionRejectedEmail,
} = require("../config/emailService");
const CustomError = require("../utils/customError");

const getPendingSubscriptions = async (req, res, next) => {
  try {
    const {
      status = "PENDING",
      page = 1,
      limit = 20,
      sortBy = "queuePosition",
      sortOrder = "asc",
      plan,
      imei,
      email,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = {};
    if (status && status !== "all") {
      if (status.includes(",")) {
        filter.status = { $in: status.split(",") };
      } else {
        filter.status = status;
      }
    }
    if (plan) filter.plan = plan;
    if (imei) filter.imei = new RegExp(imei, "i");
    if (email) filter.email = new RegExp(email, "i");

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    const subscriptions = await Subscription.find(filter)
      .populate("user", "username email isEmailVerified phoneNumber createdAt")
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Subscription.countDocuments(filter);

    // Get statistics
    const stats = await Subscription.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$price" },
          avgPrice: { $avg: "$price" },
        },
      },
    ]);

    // Get processing time for reviewed subscriptions
    const processingStats = await Subscription.aggregate([
      {
        $match: {
          reviewedAt: { $exists: true },
          createdAt: { $exists: true },
        },
      },
      {
        $project: {
          processingTime: {
            $divide: [
              { $subtract: ["$reviewedAt", "$createdAt"] },
              1000 * 60 * 60 * 24, // Convert to days
            ],
          },
          status: 1,
        },
      },
      {
        $group: {
          _id: "$status",
          avgProcessingDays: { $avg: "$processingTime" },
          minProcessingDays: { $min: "$processingTime" },
          maxProcessingDays: { $max: "$processingTime" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        subscriptions,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1,
        },
        statistics: stats,
        processingStatistics: processingStats,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get detailed view of a specific subscription
const getSubscriptionDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const subscription = await Subscription.findById(id)
      .populate(
        "user",
        "username email phoneNumber isEmailVerified createdAt lastLoginAt"
      )
      .populate("reviewedBy", "username email");

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    // Get user's subscription history
    const userSubscriptionHistory = await Subscription.find({
      user: subscription.user._id,
      _id: { $ne: id },
    }).sort({ createdAt: -1 });

    // Get user's device information
    const deviceInfo = await Device.findOne({
      imei: subscription.imei,
    });

    // Get transaction history for this subscription
    const transactionHistory = await Transaction.find({
      subscription: id,
    })
      .populate("processedBy", "username email")
      .sort({ createdAt: -1 });

    // Get other subscriptions with same IMEI
    const sameDeviceSubscriptions = await Subscription.find({
      imei: subscription.imei,
      _id: { $ne: id },
    })
      .populate("user", "username email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        subscription,
        userHistory: userSubscriptionHistory,
        deviceInfo,
        transactionHistory,
        sameDeviceSubscriptions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Approve a subscription
const approveSubscription = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { comments, activateNow = false } = req.body;
    const adminId = req.user._id;

    // Start database transaction for atomicity
    await session.startTransaction();

    const subscription = await Subscription.findById(id)
      .populate("user", "username email")
      .session(session);

    if (!subscription) {
      await session.abortTransaction();
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.status !== "PENDING") {
      await session.abortTransaction();
      throw new CustomError(400, "Only pending subscriptions can be approved");
    }

    // Store original status for logging
    const originalStatus = subscription.status;

    // Update subscription within transaction
    if (activateNow) {
      // Activate immediately
      const subscriptionDuration = getSubscriptionDuration(subscription.plan);
      subscription.status = "ACTIVE";
      subscription.startDate = new Date();
      subscription.endDate = new Date(
        Date.now() + subscriptionDuration * 24 * 60 * 60 * 1000
      );
    } else {
      // Mark as approved but not active (user needs to activate)
      subscription.status = "QUEUED";
    }

    subscription.adminNotes = comments;
    subscription.reviewedBy = adminId;
    subscription.reviewedAt = new Date();

    await subscription.save({ session });

    // Log transaction within the same database transaction
    const transactionType = activateNow
      ? "SUBSCRIPTION_ACTIVATED"
      : "SUBSCRIPTION_QUEUED";
    const transactionStatus = activateNow ? "COMPLETED" : "QUEUED";

    try {
      await logTransactionUpdate(
        id,
        transactionType,
        transactionStatus,
        adminId,
        {
          adminNotes: comments,
          metadata: {
            approvedAt: new Date(),
            activatedImmediately: activateNow,
            originalStatus: originalStatus,
            approvedBy: adminId,
          },
          subscriptionPeriod: activateNow
            ? {
                startDate: subscription.startDate,
                endDate: subscription.endDate,
              }
            : undefined,
        }
      );
    } catch (transactionLogError) {
      console.error("Failed to log transaction update:", transactionLogError);
      // Don't fail the entire operation for transaction logging issues
      // But log the error for monitoring
    }

    // If we reach this point, commit the transaction
    await session.commitTransaction();
    console.log(
      `✅ Subscription ${id} ${
        activateNow ? "activated" : "queued"
      } successfully`
    );

    // Send email notification (outside transaction to avoid rollback on email failure)
    try {
      if (activateNow) {
        // Send activation confirmation email
        await sendSubscriptionApprovedEmail(
          subscription.user.email,
          subscription.user.username,
          subscription.plan,
          null // No activation token needed since it's already active
        );
        console.log(`✅ Activation email sent to ${subscription.user.email}`);
      } else {
        // Send approval email with activation instructions
        await sendSubscriptionApprovedEmail(
          subscription.user.email,
          subscription.user.username,
          subscription.plan,
          subscription._id // Can use subscription ID for activation
        );
        console.log(`✅ Approval email sent to ${subscription.user.email}`);
      }
    } catch (emailError) {
      console.error("Failed to send approval email:", emailError);
      // Email failure shouldn't affect the approval process
      // The subscription is still approved/activated successfully
    }

    // Prepare response data
    const responseData = {
      subscription: {
        id: subscription._id,
        plan: subscription.plan,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        queuePosition: subscription.queuePosition,
        reviewedBy: subscription.reviewedBy,
        reviewedAt: subscription.reviewedAt,
        adminNotes: subscription.adminNotes,
      },
      user: {
        id: subscription.user._id,
        username: subscription.user.username,
        email: subscription.user.email,
      },
      activatedImmediately: activateNow,
      approvalDate: new Date(),
    };

    res.json({
      success: true,
      message: `Subscription ${
        activateNow
          ? "approved and activated"
          : "approved and queued for user activation"
      } successfully`,
      data: responseData,
    });
  } catch (err) {
    // Rollback transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Subscription approval error:", err);

    if (err instanceof CustomError) {
      next(err);
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
    } else if (err.code === 11000) {
      // Handle duplicate key errors if any
      next(new CustomError(400, "Duplicate entry detected"));
    } else {
      next(
        new CustomError(
          500,
          "Subscription approval failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // Always end the session
    await session.endSession();
  }
};

// Reject a subscription
const rejectSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, comments } = req.body;
    const adminId = req.user._id;

    if (!reason) {
      throw new CustomError(400, "Rejection reason is required");
    }

    const subscription = await Subscription.findById(id).populate(
      "user",
      "username email"
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.status !== "PENDING") {
      throw new CustomError(400, "Only pending subscriptions can be rejected");
    }

    // Update subscription
    subscription.status = "CANCELLED";
    subscription.adminNotes = `${reason}. ${comments || ""}`.trim();
    subscription.reviewedBy = adminId;
    subscription.reviewedAt = new Date();

    await subscription.save();

    // Log transaction
    await logTransactionUpdate(id, "SUBSCRIPTION_REJECTED", "FAILED", adminId, {
      adminNotes: subscription.adminNotes,
      metadata: {
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    // Send rejection email
    try {
      await sendSubscriptionRejectedEmail(
        subscription.user.email,
        subscription.user.username,
        subscription.plan,
        reason,
        comments
      );
    } catch (emailError) {
      console.error("Failed to send rejection email:", emailError);
    }

    res.json({
      success: true,
      message: "Subscription rejected successfully",
      data: {
        subscription,
        rejectionReason: reason,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Activate an approved subscription
const activateSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const adminId = req.user._id;

    const subscription = await Subscription.findById(id).populate(
      "user",
      "username email"
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.status !== "APPROVED") {
      throw new CustomError(
        400,
        "Only approved subscriptions can be activated"
      );
    }

    // Check for conflicts
    const existingActive = await Subscription.findOne({
      $or: [
        { user: subscription.user._id, status: "ACTIVE" },
        { imei: subscription.imei, status: "ACTIVE" },
      ],
      _id: { $ne: id },
    });

    if (existingActive) {
      throw new CustomError(
        400,
        "User or device already has an active subscription"
      );
    }

    // Activate subscription
    const subscriptionDuration = getSubscriptionDuration(subscription.plan);
    subscription.status = "ACTIVE";
    subscription.startDate = new Date();
    subscription.endDate = new Date(
      Date.now() + subscriptionDuration * 24 * 60 * 60 * 1000
    );

    if (comments) {
      subscription.adminNotes = `${
        subscription.adminNotes || ""
      } ${comments}`.trim();
    }

    await subscription.save();

    // Log transaction
    await logTransactionUpdate(
      id,
      "SUBSCRIPTION_ACTIVATED",
      "COMPLETED",
      adminId,
      {
        adminNotes: comments,
        metadata: {
          activatedAt: new Date(),
        },
        subscriptionPeriod: {
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
      }
    );

    res.json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscription,
        activationDate: subscription.startDate,
        expiryDate: subscription.endDate,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Bulk operations for admin efficiency
const bulkUpdateSubscriptions = async (req, res, next) => {
  try {
    const { subscriptionIds, action, data } = req.body;
    const adminId = req.user._id;

    if (
      !subscriptionIds ||
      !Array.isArray(subscriptionIds) ||
      subscriptionIds.length === 0
    ) {
      throw new CustomError(400, "Subscription IDs array is required");
    }

    if (!action) {
      throw new CustomError(400, "Action is required");
    }

    let updateResult = [];

    switch (action) {
      case "approve":
        updateResult = await Promise.all(
          subscriptionIds.map(async (id) => {
            try {
              const sub = await Subscription.findById(id).populate(
                "user",
                "username email"
              );
              if (sub && sub.status === "PENDING") {
                sub.status = data.activateNow ? "ACTIVE" : "APPROVED";
                sub.adminNotes = data.comments || "";
                sub.reviewedBy = adminId;
                sub.reviewedAt = new Date();

                if (data.activateNow) {
                  const duration = getSubscriptionDuration(sub.plan);
                  sub.startDate = new Date();
                  sub.endDate = new Date(
                    Date.now() + duration * 24 * 60 * 60 * 1000
                  );
                }

                await sub.save();

                // Log transaction
                await logTransactionUpdate(
                  id,
                  data.activateNow
                    ? "SUBSCRIPTION_ACTIVATED"
                    : "SUBSCRIPTION_APPROVED",
                  data.activateNow ? "COMPLETED" : "PENDING",
                  adminId,
                  {
                    adminNotes: `Bulk operation: ${data.comments || ""}`,
                    metadata: { bulkOperation: true },
                  }
                );

                return { id, status: "approved", success: true };
              }
              return {
                id,
                status: "failed",
                reason: "Invalid status or not found",
                success: false,
              };
            } catch (error) {
              return {
                id,
                status: "failed",
                reason: error.message,
                success: false,
              };
            }
          })
        );
        break;

      case "reject":
        if (!data.reason) {
          throw new CustomError(
            400,
            "Rejection reason is required for bulk rejection"
          );
        }

        updateResult = await Promise.all(
          subscriptionIds.map(async (id) => {
            try {
              const sub = await Subscription.findById(id).populate(
                "user",
                "username email"
              );
              if (sub && sub.status === "PENDING") {
                sub.status = "CANCELLED";
                sub.adminNotes = `${data.reason}. ${
                  data.comments || ""
                }`.trim();
                sub.reviewedBy = adminId;
                sub.reviewedAt = new Date();

                await sub.save();

                // Log transaction
                await logTransactionUpdate(
                  id,
                  "SUBSCRIPTION_REJECTED",
                  "FAILED",
                  adminId,
                  {
                    adminNotes: sub.adminNotes,
                    metadata: {
                      bulkOperation: true,
                      rejectionReason: data.reason,
                    },
                  }
                );

                return { id, status: "rejected", success: true };
              }
              return {
                id,
                status: "failed",
                reason: "Invalid status or not found",
                success: false,
              };
            } catch (error) {
              return {
                id,
                status: "failed",
                reason: error.message,
                success: false,
              };
            }
          })
        );
        break;

      default:
        throw new CustomError(400, "Invalid action specified");
    }

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      data: {
        results: updateResult,
        processed: subscriptionIds.length,
        successful: updateResult.filter((r) => r.success).length,
        failed: updateResult.filter((r) => !r.success).length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get admin dashboard statistics
const getAdminDashboard = async (req, res, next) => {
  try {
    // Subscription statistics
    const subscriptionStats = await Subscription.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$price" },
          avgPrice: { $avg: "$price" },
        },
      },
    ]);

    // Plan distribution
    const planStats = await Subscription.aggregate([
      {
        $group: {
          _id: "$plan",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$price" },
          avgPrice: { $avg: "$price" },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    // Recent subscriptions
    const recentSubscriptions = await Subscription.find({})
      .populate("user", "username email")
      .populate("reviewedBy", "username")
      .sort({ createdAt: -1 })
      .limit(10)
      .select("plan status price createdAt reviewedAt user reviewedBy");

    // Transaction statistics
    const transactionStats = await Transaction.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    // Recent transactions
    const recentTransactions = await Transaction.find({})
      .populate("user", "username email")
      .populate("processedBy", "username")
      .sort({ createdAt: -1 })
      .limit(10)
      .select(
        "transactionId type status amount plan createdAt user processedBy"
      );

    // Monthly revenue
    const monthlyRevenue = await Transaction.aggregate([
      {
        $match: {
          status: "COMPLETED",
          createdAt: {
            $gte: new Date(new Date().setMonth(new Date().getMonth() - 12)),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Queue analysis (pending subscriptions)
    const queueAnalysis = await Subscription.aggregate([
      {
        $match: { status: "PENDING" },
      },
      {
        $group: {
          _id: null,
          totalPending: { $sum: 1 },
          oldestPending: { $min: "$createdAt" },
          avgQueuePosition: { $avg: "$queuePosition" },
          totalPendingValue: { $sum: "$price" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        subscriptionStatistics: subscriptionStats,
        planDistribution: planStats,
        recentSubscriptions,
        transactionStatistics: transactionStats,
        recentTransactions,
        monthlyRevenue,
        queueAnalysis: queueAnalysis[0] || {
          totalPending: 0,
          oldestPending: null,
          avgQueuePosition: 0,
          totalPendingValue: 0,
        },
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
};

const logTransactionUpdate = async (
  subscriptionId,
  type,
  status,
  adminId,
  additionalData = {}
) => {
  try {
    const existingTransaction = await Transaction.findOne({
      subscription: subscriptionId,
    }).sort({ createdAt: -1 });

    if (existingTransaction) {
      const newTransaction = new Transaction({
        user: existingTransaction.user,
        subscription: subscriptionId,
        device: existingTransaction.device,
        transactionId: Transaction.generateTransactionId(),
        type: type,
        amount: existingTransaction.amount,
        plan: existingTransaction.plan,
        status: status,
        paymentMethod: existingTransaction.paymentMethod,
        processedBy: adminId,
        processedAt: new Date(),
        previousTransaction: existingTransaction._id,
        metadata: {
          ...existingTransaction.metadata,
          ...additionalData.metadata,
        },
        adminNotes: additionalData.adminNotes || "",
        subscriptionPeriod:
          additionalData.subscriptionPeriod ||
          existingTransaction.subscriptionPeriod,
      });

      await newTransaction.save();
      existingTransaction.relatedTransactions.push(newTransaction._id);
      await existingTransaction.save();

      console.log(
        `✅ Transaction logged: ${newTransaction.transactionId} for ${type}`
      );
      return newTransaction;
    }
    return null;
  } catch (error) {
    console.error("Failed to log transaction update:", error);
    return null;
  }
};

// Queue a subscription for a user (create new or move existing)
const queueSubscriptionForUser = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const {
      userId,
      imei,
      deviceName,
      phoneNumber,
      plan,
      priority = 0,
      adminNotes = "",
      cards = [], // Optional: admin can upload cards or use existing
    } = req.body;

    const adminId = req.user._id;

    // Validation
    if (!userId || !imei || !plan) {
      throw new CustomError(400, "Missing required fields: userId, imei, plan");
    }

    await session.startTransaction();

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Check if device exists, create if needed
    let device = await Device.findOne({ imei }).session(session);
    if (!device) {
      const crypto = require("crypto");
      const totpSecret = crypto.randomBytes(32).toString("hex");

      device = new Device({
        user: userId,
        imei,
        totpSecret,
        deviceName: deviceName || "Device",
      });
      await device.save({ session });
      console.log(`✅ Created new device: ${device._id}`);
    }

    // Check if user already has a queued/pending subscription for this device
    const existingQueued = await Subscription.findOne({
      user: userId,
      imei,
      status: { $in: ["QUEUED", "PENDING"] },
    }).session(session);

    if (existingQueued) {
      throw new CustomError(
        400,
        "User already has a queued subscription for this device"
      );
    }

    // Calculate subscription price
    const subscriptionPrice = getSubscriptionPrice(plan);

    // Get next queue position
    const queuePosition = await Subscription.getNextQueuePosition(imei);

    // Create new subscription
    const newSubscription = new Subscription({
      user: userId,
      imei,
      deviceName: deviceName || device.deviceName,
      phone: phoneNumber || user.phoneNumber,
      email: user.email,
      plan,
      price: subscriptionPrice,
      cards: cards.length > 0 ? cards : [], // Use provided cards or empty array
      queuePosition,
      status: "QUEUED",
      queuedBy: adminId,
      queuedAt: new Date(),
      adminNotes,
      priority,
    });

    await newSubscription.save({ session });
    console.log(`✅ Subscription queued: ${newSubscription._id}`);

    // Create transaction record
    const transaction = new Transaction({
      user: userId,
      subscription: newSubscription._id,
      device: device._id,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_QUEUED",
      amount: subscriptionPrice,
      plan,
      status: "PENDING",
      queuePosition,
      queuedAt: new Date(),
      processedBy: adminId,
      processedAt: new Date(),
      adminNotes: `Admin queued subscription: ${adminNotes}`,
      metadata: {
        userAgent: req.get("User-Agent") || "Admin Interface",
        ipAddress: req.ip || "Unknown",
        deviceInfo: {
          imei: imei,
          deviceName: deviceName || device.deviceName,
        },
        adminAction: true,
        queuedByAdmin: adminId,
        priority: priority,
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
      message: "Subscription queued successfully",
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
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Queue subscription error:", err);
    next(err);
  } finally {
    await session.endSession();
  }
};

// Move existing subscription to queue
const moveSubscriptionToQueue = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { priority = 0, adminNotes = "" } = req.body;
    const adminId = req.user._id;

    const subscription = await Subscription.findById(subscriptionId).populate(
      "user",
      "username email"
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    // Can only queue PENDING subscriptions
    if (subscription.status !== "PENDING") {
      throw new CustomError(
        400,
        "Only pending subscriptions can be moved to queue"
      );
    }

    // Move to queue
    subscription.status = "QUEUED";
    subscription.queuedBy = adminId;
    subscription.queuedAt = new Date();
    subscription.priority = priority;
    if (adminNotes) {
      subscription.adminNotes = adminNotes;
    }

    // Ensure queue position
    if (!subscription.queuePosition) {
      subscription.queuePosition = await Subscription.getNextQueuePosition(
        subscription.imei
      );
    }

    await subscription.save();

    // Reorder queue
    await Subscription.reorderDeviceQueue(subscription.imei);

    // Log transaction
    await logTransactionUpdate(
      subscriptionId,
      "SUBSCRIPTION_QUEUED",
      "PENDING",
      adminId,
      {
        adminNotes: `Moved to queue: ${adminNotes}`,
        metadata: {
          movedToQueueAt: new Date(),
          priority: priority,
        },
      }
    );

    res.json({
      success: true,
      message: "Subscription moved to queue successfully",
      data: {
        subscription,
        newQueuePosition: subscription.queuePosition,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get queue status for a device
const getDeviceQueueStatus = async (req, res, next) => {
  try {
    const { imei } = req.params;
    const { includeHistory = false } = req.query;

    // Get current queue
    const queuedSubscriptions = await Subscription.find({
      imei,
      status: { $in: ["QUEUED", "PENDING"] },
    })
      .populate("user", "username email phoneNumber")
      .populate("queuedBy", "username email")
      .sort({ priority: -1, queuePosition: 1 });

    // Get active subscription
    const activeSubscription = await Subscription.findOne({
      imei,
      status: "ACTIVE",
    }).populate("user", "username email phoneNumber");

    // Queue statistics
    const queueStats = {
      totalInQueue: queuedSubscriptions.length,
      hasActiveSubscription: !!activeSubscription,
      nextInQueue: queuedSubscriptions[0] || null,
      estimatedWaitTime: queuedSubscriptions.length * 2, // Rough estimate: 2 days per position
    };

    let history = [];
    if (includeHistory === "true") {
      history = await Subscription.find({
        imei,
        status: { $in: ["EXPIRED", "CANCELLED", "ACTIVE"] },
      })
        .populate("user", "username email")
        .sort({ createdAt: -1 })
        .limit(10);
    }

    res.json({
      success: true,
      data: {
        imei,
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

// Update queue position
const updateQueuePosition = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPosition } = req.body;
    const adminId = req.user._id;

    if (!newPosition || newPosition < 1) {
      throw new CustomError(
        400,
        "Valid queue position is required (must be >= 1)"
      );
    }

    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (!["QUEUED", "PENDING"].includes(subscription.status)) {
      throw new CustomError(
        400,
        "Can only update queue position for queued/pending subscriptions"
      );
    }

    const oldPosition = parseInt(subscription.queuePosition) || 0;
    const newPos = parseInt(newPosition);

    if (oldPosition === newPos) {
      return res.json({
        success: true,
        message: "Queue position unchanged",
        data: { subscription, oldPosition, newPosition: newPos },
      });
    }

    // Get all queued subscriptions for this device
    const allQueued = await Subscription.find({
      imei: subscription.imei,
      status: { $in: ["QUEUED", "PENDING"] },
      _id: { $ne: subscriptionId },
    }).sort({ queuePosition: 1 });

    // Validate new position
    if (newPos > allQueued.length + 1) {
      throw new CustomError(
        400,
        `Queue position cannot exceed ${allQueued.length + 1}`
      );
    }

    // Update positions
    if (newPos < oldPosition) {
      // Moving up - increment positions of others
      await Subscription.updateMany(
        {
          imei: subscription.imei,
          status: { $in: ["QUEUED", "PENDING"] },
          queuePosition: { $gte: newPos, $lt: oldPosition },
          _id: { $ne: subscriptionId },
        },
        { $inc: { queuePosition: 1 } }
      );
    } else {
      // Moving down - decrement positions of others
      await Subscription.updateMany(
        {
          imei: subscription.imei,
          status: { $in: ["QUEUED", "PENDING"] },
          queuePosition: { $gt: oldPosition, $lte: newPos },
          _id: { $ne: subscriptionId },
        },
        { $inc: { queuePosition: -1 } }
      );
    }

    // Update the subscription
    subscription.queuePosition = newPos.toString();
    await subscription.save();

    // Reorder to ensure consistency
    await Subscription.reorderDeviceQueue(subscription.imei);

    // Log transaction
    await logTransactionUpdate(
      subscriptionId,
      "QUEUE_POSITION_UPDATED",
      "PENDING",
      adminId,
      {
        adminNotes: `Queue position changed from ${oldPosition} to ${newPos}`,
        metadata: {
          queuePositionChange: {
            from: oldPosition,
            to: newPos,
            updatedAt: new Date(),
          },
        },
      }
    );

    res.json({
      success: true,
      message: "Queue position updated successfully",
      data: {
        subscription,
        oldPosition,
        newPosition: newPos,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Bulk queue operations
const bulkQueueOperations = async (req, res, next) => {
  try {
    const { operation, subscriptionIds, data = {} } = req.body;
    const adminId = req.user._id;

    if (
      !subscriptionIds ||
      !Array.isArray(subscriptionIds) ||
      subscriptionIds.length === 0
    ) {
      throw new CustomError(400, "Subscription IDs array is required");
    }

    if (!operation) {
      throw new CustomError(400, "Operation is required");
    }

    let results = [];

    switch (operation) {
      case "queue":
        results = await Promise.all(
          subscriptionIds.map(async (id) => {
            try {
              const sub = await Subscription.findById(id);
              if (sub && sub.status === "PENDING") {
                await sub.moveToQueue(
                  adminId,
                  data.adminNotes || "Bulk queue operation"
                );
                return { id, status: "queued", success: true };
              }
              return {
                id,
                status: "failed",
                reason: "Invalid status or not found",
                success: false,
              };
            } catch (error) {
              return {
                id,
                status: "failed",
                reason: error.message,
                success: false,
              };
            }
          })
        );
        break;

      case "reorder":
        // Reorder all queues for affected devices
        const subscriptions = await Subscription.find({
          _id: { $in: subscriptionIds },
        });
        const devices = [...new Set(subscriptions.map((sub) => sub.imei))];

        for (const imei of devices) {
          await Subscription.reorderDeviceQueue(imei);
        }

        results = subscriptionIds.map((id) => ({
          id,
          status: "reordered",
          success: true,
        }));
        break;

      case "setPriority":
        if (typeof data.priority !== "number") {
          throw new CustomError(400, "Priority must be a number");
        }

        await Subscription.updateMany(
          {
            _id: { $in: subscriptionIds },
            status: { $in: ["QUEUED", "PENDING"] },
          },
          { $set: { priority: data.priority } }
        );

        results = subscriptionIds.map((id) => ({
          id,
          status: "priority_updated",
          success: true,
        }));
        break;

      default:
        throw new CustomError(400, "Invalid operation specified");
    }

    res.json({
      success: true,
      message: `Bulk ${operation} completed`,
      data: {
        results,
        processed: subscriptionIds.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get queue dashboard/overview
const getQueueDashboard = async (req, res, next) => {
  try {
    // Overall queue statistics
    const queueStats = await Subscription.aggregate([
      {
        $match: { status: { $in: ["QUEUED", "PENDING"] } },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalValue: { $sum: "$price" },
          avgPrice: { $avg: "$price" },
        },
      },
    ]);

    // Queue by device
    const deviceQueues = await Subscription.aggregate([
      {
        $match: { status: { $in: ["QUEUED", "PENDING"] } },
      },
      {
        $group: {
          _id: "$imei",
          queueLength: { $sum: 1 },
          totalValue: { $sum: "$price" },
          oldestQueued: { $min: "$queuedAt" },
        },
      },
      { $sort: { queueLength: -1 } },
    ]);

    // Plan distribution in queue
    const planDistribution = await Subscription.aggregate([
      {
        $match: { status: { $in: ["QUEUED", "PENDING"] } },
      },
      {
        $group: {
          _id: "$plan",
          count: { $sum: 1 },
          totalValue: { $sum: "$price" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Recent queue activity
    const recentActivity = await Subscription.find({
      queuedAt: { $exists: true },
    })
      .populate("user", "username email")
      .populate("queuedBy", "username")
      .sort({ queuedAt: -1 })
      .limit(10)
      .select("plan status queuePosition queuedAt user queuedBy imei");

    // Active subscriptions count
    const activeCount = await Subscription.countDocuments({ status: "ACTIVE" });

    res.json({
      success: true,
      data: {
        overview: {
          totalQueued: queueStats.reduce((sum, stat) => sum + stat.count, 0),
          totalValue: queueStats.reduce(
            (sum, stat) => sum + stat.totalValue,
            0
          ),
          activeSubscriptions: activeCount,
          devicesWithQueues: deviceQueues.length,
        },
        queueStats,
        deviceQueues: deviceQueues.slice(0, 20), // Top 20 devices
        planDistribution,
        recentActivity,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPendingSubscriptions,
  getSubscriptionDetails,
  approveSubscription,
  rejectSubscription,
  activateSubscription,
  updateQueuePosition,
  bulkUpdateSubscriptions,
  getAdminDashboard,
  logTransactionUpdate,

  queueSubscriptionForUser,
  moveSubscriptionToQueue,
  getDeviceQueueStatus,
  bulkQueueOperations,
  getQueueDashboard,
};
