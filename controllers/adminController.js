// controllers/adminController.js - Updated without SubscriptionQueue
const Subscription = require("../models/subscription");
const Transaction = require("../models/transaction");
const User = require("../models/user");
const Device = require("../models/device");
const CustomError = require("../utils/customError");
const { getSubscriptionDuration } = require("../utils/helpers");
const {
  sendSubscriptionApprovedEmail,
  sendSubscriptionRejectedEmail,
} = require("../config/emailService");

// Helper function to log transaction updates
const logTransactionUpdate = async (
  subscriptionId,
  type,
  status,
  adminId,
  additionalData = {}
) => {
  try {
    // Find existing transaction for this subscription
    const existingTransaction = await Transaction.findOne({
      subscription: subscriptionId,
    }).sort({ createdAt: -1 });

    if (existingTransaction) {
      // Create a new transaction record for the status change
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

      // Update related transactions
      existingTransaction.relatedTransactions.push(newTransaction._id);
      await existingTransaction.save();

      console.log(
        `✅ Transaction logged: ${newTransaction.transactionId} for ${type}`
      );
      return newTransaction;
    } else {
      console.warn(
        `⚠️ No existing transaction found for subscription: ${subscriptionId}`
      );
      return null;
    }
  } catch (error) {
    console.error("Failed to log transaction update:", error);
    return null;
  }
};

// Get all pending subscriptions for admin review
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
  try {
    const { id } = req.params;
    const { comments, activateNow = false } = req.body;
    const adminId = req.user._id;

    const subscription = await Subscription.findById(id).populate(
      "user",
      "username email"
    );

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.status !== "PENDING") {
      throw new CustomError(400, "Only pending subscriptions can be approved");
    }

    // Check if user already has an active subscription
    const existingActive = await Subscription.findOne({
      user: subscription.user._id,
      status: "ACTIVE",
      _id: { $ne: id },
    });

    if (existingActive) {
      throw new CustomError(400, "User already has an active subscription");
    }

    // Check if device already has an active subscription
    const deviceActive = await Subscription.findOne({
      imei: subscription.imei,
      status: "ACTIVE",
      _id: { $ne: id },
    });

    if (deviceActive) {
      throw new CustomError(400, "Device already has an active subscription");
    }

    // Update subscription
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
      subscription.status = "APPROVED";
    }

    subscription.adminNotes = comments;
    subscription.reviewedBy = adminId;
    subscription.reviewedAt = new Date();

    await subscription.save();

    // Log transaction
    const transactionType = activateNow
      ? "SUBSCRIPTION_ACTIVATED"
      : "SUBSCRIPTION_APPROVED";
    const transactionStatus = activateNow ? "COMPLETED" : "PENDING";

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
        },
        subscriptionPeriod: activateNow
          ? {
              startDate: subscription.startDate,
              endDate: subscription.endDate,
            }
          : undefined,
      }
    );

    // Send email notification
    try {
      if (activateNow) {
        // Send activation confirmation email
        await sendSubscriptionApprovedEmail(
          subscription.user.email,
          subscription.user.username,
          subscription.plan,
          null // No activation token needed since it's already active
        );
      } else {
        // Send approval email with activation instructions
        await sendSubscriptionApprovedEmail(
          subscription.user.email,
          subscription.user.username,
          subscription.plan,
          subscription._id // Can use subscription ID for activation
        );
      }
    } catch (emailError) {
      console.error("Failed to send approval email:", emailError);
    }

    res.json({
      success: true,
      message: `Subscription ${
        activateNow ? "approved and activated" : "approved"
      } successfully`,
      data: {
        subscription,
        activatedImmediately: activateNow,
      },
    });
  } catch (err) {
    next(err);
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

// Update queue position
const updateQueuePosition = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPosition } = req.body;
    const adminId = req.user._id;

    if (!newPosition || newPosition < 1) {
      throw new CustomError(400, "Valid queue position is required");
    }

    const subscription = await Subscription.findById(id);

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    if (subscription.status !== "PENDING") {
      throw new CustomError(
        400,
        "Can only update queue position for pending subscriptions"
      );
    }

    const oldPosition = subscription.queuePosition;

    // Update queue positions for affected subscriptions
    if (newPosition !== oldPosition) {
      if (newPosition < oldPosition) {
        // Moving up - increment positions of subscriptions between new and old position
        await Subscription.updateMany(
          {
            queuePosition: { $gte: newPosition, $lt: oldPosition },
            status: "PENDING",
            _id: { $ne: id },
          },
          { $inc: { queuePosition: 1 } }
        );
      } else {
        // Moving down - decrement positions of subscriptions between old and new position
        await Subscription.updateMany(
          {
            queuePosition: { $gt: oldPosition, $lte: newPosition },
            status: "PENDING",
            _id: { $ne: id },
          },
          { $inc: { queuePosition: -1 } }
        );
      }

      subscription.queuePosition = newPosition;
      await subscription.save();

      // Log transaction
      await logTransactionUpdate(
        id,
        "QUEUE_POSITION_UPDATED",
        "PENDING",
        adminId,
        {
          adminNotes: `Queue position changed from ${oldPosition} to ${newPosition}`,
          metadata: {
            queuePositionChange: {
              from: oldPosition,
              to: newPosition,
              updatedAt: new Date(),
            },
          },
        }
      );
    }

    res.json({
      success: true,
      message: "Queue position updated successfully",
      data: {
        subscription,
        oldPosition,
        newPosition,
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
};
