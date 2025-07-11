const SubscriptionQueue = require("../models/subscriptionQueue");
const Subscription = require("../models/subscription");
const User = require("../models/user");
const Device = require("../models/device");
const CustomError = require("../utils/customError");
const {
  sendSubscriptionApprovedEmail,
  sendSubscriptionRejectedEmail,
} = require("../config/emailService");

// Get all queued subscriptions for admin review
const getQueuedSubscriptions = async (req, res, next) => {
  try {
    const {
      status = "SUBMITTED",
      page = 1,
      limit = 20,
      sortBy = "queuePosition",
      sortOrder = "asc",
      priority,
      plan,
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
    if (priority) filter.priority = priority;
    if (plan) filter.plan = plan;

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    const queuedSubscriptions = await SubscriptionQueue.find(filter)
      .populate("user", "username email isEmailVerified")
      .populate("device", "deviceName imei")
      .populate("adminReview.reviewedBy", "username email")
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await SubscriptionQueue.countDocuments(filter);

    // Get queue statistics
    const stats = await SubscriptionQueue.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          avgProcessingTime: {
            $avg: {
              $cond: [
                { $ne: ["$adminReview.reviewedAt", null] },
                {
                  $subtract: ["$adminReview.reviewedAt", "$createdAt"],
                },
                null,
              ],
            },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        subscriptions: queuedSubscriptions,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1,
        },
        statistics: stats,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get detailed view of a specific queued subscription
const getQueuedSubscriptionDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const queuedSubscription = await SubscriptionQueue.findById(id)
      .populate("user", "username email phoneNumber isEmailVerified createdAt")
      .populate("device", "deviceName imei totpSecret")
      .populate("adminReview.reviewedBy", "username email");

    if (!queuedSubscription) {
      throw new CustomError(404, "Queued subscription not found");
    }

    // Get user's subscription history
    const userSubscriptionHistory = await Subscription.find({
      user: queuedSubscription.user._id,
    })
      .populate("device", "deviceName imei")
      .sort({ createdAt: -1 });

    // Get user's other pending subscriptions
    const otherPendingSubscriptions = await SubscriptionQueue.find({
      user: queuedSubscription.user._id,
      _id: { $ne: id },
      status: { $in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] },
    });

    res.json({
      success: true,
      data: {
        subscription: queuedSubscription,
        userHistory: userSubscriptionHistory,
        otherPending: otherPendingSubscriptions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Approve a queued subscription
const approveSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { comments, priority, authenticatorProvider } = req.body;
    const adminId = req.user._id; // Assuming admin is authenticated

    const queuedSubscription = await SubscriptionQueue.findById(id).populate(
      "user",
      "username email"
    );

    if (!queuedSubscription) {
      throw new CustomError(404, "Queued subscription not found");
    }

    if (
      queuedSubscription.status !== "SUBMITTED" &&
      queuedSubscription.status !== "UNDER_REVIEW"
    ) {
      throw new CustomError(
        400,
        "Subscription cannot be approved in current status"
      );
    }

    // Check if user already has an active subscription
    const existingActive = await Subscription.hasActiveSubscription(
      queuedSubscription.user._id
    );
    if (existingActive) {
      throw new CustomError(400, "User already has an active subscription");
    }

    // Approve the subscription
    await queuedSubscription.approve(adminId, comments);

    // Set up authenticator if specified
    if (authenticatorProvider) {
      await queuedSubscription.generateAuthenticatorSetup(
        authenticatorProvider
      );
    }

    // Update priority if specified
    if (priority) {
      queuedSubscription.priority = priority;
      await queuedSubscription.save();
    }

    // Send approval email to user
    try {
      await sendSubscriptionApprovedEmail(
        queuedSubscription.user.email,
        queuedSubscription.user.username,
        queuedSubscription.plan,
        queuedSubscription.activationToken
      );
    } catch (emailError) {
      console.error("Failed to send approval email:", emailError);
    }

    res.json({
      success: true,
      message: "Subscription approved successfully",
      data: {
        subscription: queuedSubscription,
        activationToken: queuedSubscription.activationToken,
        activationExpires: queuedSubscription.activationExpires,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Reject a queued subscription
const rejectSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, comments } = req.body;
    const adminId = req.user._id;

    if (!reason) {
      throw new CustomError(400, "Rejection reason is required");
    }

    const queuedSubscription = await SubscriptionQueue.findById(id).populate(
      "user",
      "username email"
    );

    if (!queuedSubscription) {
      throw new CustomError(404, "Queued subscription not found");
    }

    if (
      queuedSubscription.status !== "SUBMITTED" &&
      queuedSubscription.status !== "UNDER_REVIEW"
    ) {
      throw new CustomError(
        400,
        "Subscription cannot be rejected in current status"
      );
    }

    // Reject the subscription
    await queuedSubscription.reject(adminId, reason, comments);

    // Send rejection email to user
    try {
      await sendSubscriptionRejectedEmail(
        queuedSubscription.user.email,
        queuedSubscription.user.username,
        queuedSubscription.plan,
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
        subscription: queuedSubscription,
        rejectionReason: reason,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Update subscription status to under review
const markUnderReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;

    const queuedSubscription = await SubscriptionQueue.findById(id);

    if (!queuedSubscription) {
      throw new CustomError(404, "Queued subscription not found");
    }

    if (queuedSubscription.status !== "SUBMITTED") {
      throw new CustomError(400, "Subscription is not in submitted status");
    }

    queuedSubscription.status = "UNDER_REVIEW";
    if (comments) {
      queuedSubscription.internalNotes = comments;
    }

    await queuedSubscription.save();

    res.json({
      success: true,
      message: "Subscription marked as under review",
      data: queuedSubscription,
    });
  } catch (err) {
    next(err);
  }
};

// Update queue position (for priority management)
const updateQueuePosition = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPosition, priority } = req.body;

    const queuedSubscription = await SubscriptionQueue.findById(id);

    if (!queuedSubscription) {
      throw new CustomError(404, "Queued subscription not found");
    }

    if (newPosition) {
      const currentPosition = queuedSubscription.queuePosition;

      if (newPosition !== currentPosition) {
        // Update positions of other subscriptions
        if (newPosition < currentPosition) {
          // Moving up in queue - increment positions of subscriptions between new and current position
          await SubscriptionQueue.updateMany(
            {
              queuePosition: { $gte: newPosition, $lt: currentPosition },
              status: { $in: ["SUBMITTED", "UNDER_REVIEW"] },
            },
            { $inc: { queuePosition: 1 } }
          );
        } else {
          // Moving down in queue - decrement positions of subscriptions between current and new position
          await SubscriptionQueue.updateMany(
            {
              queuePosition: { $gt: currentPosition, $lte: newPosition },
              status: { $in: ["SUBMITTED", "UNDER_REVIEW"] },
            },
            { $inc: { queuePosition: -1 } }
          );
        }

        queuedSubscription.queuePosition = newPosition;
      }
    }

    if (priority) {
      queuedSubscription.priority = priority;
    }

    await queuedSubscription.save();

    res.json({
      success: true,
      message: "Queue position updated successfully",
      data: queuedSubscription,
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

    let updateResult;

    switch (action) {
      case "approve":
        updateResult = await Promise.all(
          subscriptionIds.map(async (id) => {
            const sub = await SubscriptionQueue.findById(id).populate(
              "user",
              "username email"
            );
            if (
              sub &&
              (sub.status === "SUBMITTED" || sub.status === "UNDER_REVIEW")
            ) {
              await sub.approve(adminId, data.comments || "");

              // Send approval email
              try {
                await sendSubscriptionApprovedEmail(
                  sub.user.email,
                  sub.user.username,
                  sub.plan,
                  sub.activationToken
                );
              } catch (emailError) {
                console.error(
                  `Failed to send approval email to ${sub.user.email}:`,
                  emailError
                );
              }

              return { id, status: "approved", success: true };
            }
            return {
              id,
              status: "failed",
              reason: "Invalid status or not found",
              success: false,
            };
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
            const sub = await SubscriptionQueue.findById(id).populate(
              "user",
              "username email"
            );
            if (
              sub &&
              (sub.status === "SUBMITTED" || sub.status === "UNDER_REVIEW")
            ) {
              await sub.reject(adminId, data.reason, data.comments || "");

              // Send rejection email
              try {
                await sendSubscriptionRejectedEmail(
                  sub.user.email,
                  sub.user.username,
                  sub.plan,
                  data.reason,
                  data.comments
                );
              } catch (emailError) {
                console.error(
                  `Failed to send rejection email to ${sub.user.email}:`,
                  emailError
                );
              }

              return { id, status: "rejected", success: true };
            }
            return {
              id,
              status: "failed",
              reason: "Invalid status or not found",
              success: false,
            };
          })
        );
        break;

      case "under_review":
        updateResult = await SubscriptionQueue.updateMany(
          {
            _id: { $in: subscriptionIds },
            status: "SUBMITTED",
          },
          {
            status: "UNDER_REVIEW",
            ...(data.comments && { internalNotes: data.comments }),
          }
        );
        break;

      case "update_priority":
        if (!data.priority) {
          throw new CustomError(400, "Priority is required");
        }

        updateResult = await SubscriptionQueue.updateMany(
          { _id: { $in: subscriptionIds } },
          { priority: data.priority }
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
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get admin dashboard statistics
const getAdminDashboard = async (req, res, next) => {
  try {
    // Queue statistics
    const queueStats = await SubscriptionQueue.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          oldestSubmission: { $min: "$createdAt" },
          newestSubmission: { $max: "$createdAt" },
          avgPrice: { $avg: "$price" },
        },
      },
    ]);

    // Priority distribution
    const priorityStats = await SubscriptionQueue.aggregate([
      {
        $match: { status: { $in: ["SUBMITTED", "UNDER_REVIEW"] } },
      },
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
        },
      },
    ]);

    // Plan distribution
    const planStats = await SubscriptionQueue.aggregate([
      {
        $group: {
          _id: "$plan",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$price" },
        },
      },
    ]);

    // Processing time analysis
    const processingTimeStats = await SubscriptionQueue.aggregate([
      {
        $match: {
          "adminReview.reviewedAt": { $exists: true },
        },
      },
      {
        $project: {
          processingTime: {
            $divide: [
              { $subtract: ["$adminReview.reviewedAt", "$createdAt"] },
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

    // Active subscriptions overview
    const activeSubscriptions = await Subscription.aggregate([
      {
        $match: { status: "ACTIVE" },
      },
      {
        $group: {
          _id: "$plan",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$price" },
        },
      },
    ]);

    // Recent activity
    const recentActivity = await SubscriptionQueue.find({
      "adminReview.reviewedAt": { $exists: true },
    })
      .populate("user", "username email")
      .populate("adminReview.reviewedBy", "username")
      .sort({ "adminReview.reviewedAt": -1 })
      .limit(10)
      .select("plan status adminReview user createdAt");

    res.json({
      success: true,
      data: {
        queueStatistics: queueStats,
        priorityDistribution: priorityStats,
        planDistribution: planStats,
        processingTimeAnalysis: processingTimeStats,
        activeSubscriptions: activeSubscriptions,
        recentActivity: recentActivity,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getQueuedSubscriptions,
  getQueuedSubscriptionDetails,
  approveSubscription,
  rejectSubscription,
  markUnderReview,
  updateQueuePosition,
  bulkUpdateSubscriptions,
  getAdminDashboard,
};
