// controllers/transactionController.js
const Transaction = require("../models/transaction");
const Subscription = require("../models/subscription");
const User = require("../models/user");
const CustomError = require("../utils/customError");

// Get all transactions with filtering and pagination
const getAllTransactions = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      userId,
      subscriptionId,
      startDate,
      endDate,
      plan,
      minAmount,
      maxAmount,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = {};

    if (type) {
      if (type.includes(",")) {
        filter.type = { $in: type.split(",") };
      } else {
        filter.type = type;
      }
    }

    if (status) {
      if (status.includes(",")) {
        filter.status = { $in: status.split(",") };
      } else {
        filter.status = status;
      }
    }

    if (userId) filter.user = userId;
    if (subscriptionId) filter.subscription = subscriptionId;
    if (plan) filter.plan = plan;

    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = parseFloat(minAmount);
      if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    const transactions = await Transaction.find(filter)
      .populate("user", "username email")
      .populate("subscription", "plan status imei")
      .populate("device", "deviceName imei")
      .populate("processedBy", "username email")
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Transaction.countDocuments(filter);

    // Get summary statistics
    const stats = await Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          avgAmount: { $avg: "$amount" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        transactions,
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

// Get user's transaction history
const getUserTransactions = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.user._id;
    const {
      page = 1,
      limit = 20,
      type,
      status,
      startDate,
      endDate,
    } = req.query;

    // Check if user exists (for admin queries) or if user is requesting their own data
    if (
      req.params.userId &&
      req.user._id.toString() !== userId &&
      req.user.role !== "admin"
    ) {
      throw new CustomError(403, "Access denied");
    }

    const result = await Transaction.getUserTransactionHistory(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      status,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// Get specific transaction details
const getTransactionDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const transaction = await Transaction.findById(id)
      .populate("user", "username email phoneNumber")
      .populate("subscription", "plan status imei deviceName startDate endDate")
      .populate("device", "deviceName imei totpSecret")
      .populate("processedBy", "username email")
      .populate("relatedTransactions");

    if (!transaction) {
      throw new CustomError(404, "Transaction not found");
    }

    // Check access permissions
    if (
      userRole !== "admin" &&
      transaction.user._id.toString() !== userId.toString()
    ) {
      throw new CustomError(403, "Access denied");
    }

    res.json({
      success: true,
      data: { transaction },
    });
  } catch (err) {
    next(err);
  }
};

// Get financial summary/dashboard
const getFinancialSummary = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      groupBy = "status", // status, type, plan, month
    } = req.query;

    const dateRange = {};
    if (startDate) dateRange.startDate = startDate;
    if (endDate) dateRange.endDate = endDate;

    // Get general financial summary
    const summary = await Transaction.getFinancialSummary(dateRange);

    // Get revenue trends by month (last 12 months)
    const monthlyRevenue = await Transaction.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(new Date().setMonth(new Date().getMonth() - 12)),
            $lte: new Date(),
          },
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalRevenue: { $sum: "$amount" },
          transactionCount: { $sum: 1 },
          avgTransactionValue: { $avg: "$amount" },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    // Get plan performance
    const planPerformance = await Transaction.aggregate([
      {
        $match: {
          status: "COMPLETED",
          ...(startDate && endDate
            ? {
                createdAt: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              }
            : {}),
        },
      },
      {
        $group: {
          _id: "$plan",
          totalRevenue: { $sum: "$amount" },
          transactionCount: { $sum: 1 },
          avgPrice: { $avg: "$amount" },
        },
      },
      {
        $sort: { totalRevenue: -1 },
      },
    ]);

    // Get daily transaction volume (last 30 days)
    const dailyVolume = await Transaction.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          completedTransactions: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
          },
          failedTransactions: {
            $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
          },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
      },
    ]);

    res.json({
      success: true,
      data: {
        summary,
        monthlyRevenue,
        planPerformance,
        dailyVolume,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Update transaction status (admin only)
const updateTransactionStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminId = req.user._id;

    const validStatuses = [
      "PENDING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "REFUNDED",
    ];
    if (!validStatuses.includes(status)) {
      throw new CustomError(400, "Invalid transaction status");
    }

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      throw new CustomError(404, "Transaction not found");
    }

    // Update transaction
    await transaction.updateStatus(status, {
      processedBy: adminId,
      processedAt: new Date(),
      adminNotes: notes,
    });

    res.json({
      success: true,
      message: "Transaction status updated successfully",
      data: { transaction },
    });
  } catch (err) {
    next(err);
  }
};

// Create manual transaction (admin only - for special cases)
const createManualTransaction = async (req, res, next) => {
  try {
    const {
      userId,
      subscriptionId,
      type,
      amount,
      plan,
      notes,
      paymentMethod = "ADMIN_APPROVAL",
    } = req.body;
    const adminId = req.user._id;

    // Validate required fields
    if (!userId || !subscriptionId || !type || !amount || !plan) {
      throw new CustomError(400, "Missing required transaction fields");
    }

    // Verify user and subscription exist
    const user = await User.findById(userId);
    const subscription = await Subscription.findById(subscriptionId);

    if (!user) throw new CustomError(404, "User not found");
    if (!subscription) throw new CustomError(404, "Subscription not found");

    // Create transaction
    const transactionId = Transaction.generateTransactionId();

    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      device: subscription.device,
      transactionId,
      type,
      amount: parseFloat(amount),
      plan,
      paymentMethod,
      status: "COMPLETED",
      processedBy: adminId,
      processedAt: new Date(),
      adminNotes: notes,
      metadata: {
        manuallyCreated: true,
        createdByAdmin: adminId,
      },
    });

    await transaction.save();

    res.status(201).json({
      success: true,
      message: "Manual transaction created successfully",
      data: { transaction },
    });
  } catch (err) {
    next(err);
  }
};

// Get transaction analytics
const getTransactionAnalytics = async (req, res, next) => {
  try {
    const { period = "30d" } = req.query;

    let startDate;
    const endDate = new Date();

    switch (period) {
      case "7d":
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Success rate analysis
    const successRate = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          total: 1,
          completed: 1,
          failed: 1,
          pending: 1,
          successRate: {
            $multiply: [{ $divide: ["$completed", "$total"] }, 100],
          },
          failureRate: {
            $multiply: [{ $divide: ["$failed", "$total"] }, 100],
          },
        },
      },
    ]);

    // Revenue by plan
    const revenueByPlan = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: "$plan",
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { revenue: -1 },
      },
    ]);

    // Processing time analysis
    const processingTime = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          completedAt: { $exists: true },
        },
      },
      {
        $project: {
          processingTimeHours: {
            $divide: [
              { $subtract: ["$completedAt", "$createdAt"] },
              1000 * 60 * 60,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgProcessingTime: { $avg: "$processingTimeHours" },
          minProcessingTime: { $min: "$processingTimeHours" },
          maxProcessingTime: { $max: "$processingTimeHours" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        period,
        dateRange: { startDate, endDate },
        successRate: successRate[0] || {
          total: 0,
          completed: 0,
          failed: 0,
          pending: 0,
          successRate: 0,
          failureRate: 0,
        },
        revenueByPlan,
        processingTime: processingTime[0] || {
          avgProcessingTime: 0,
          minProcessingTime: 0,
          maxProcessingTime: 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// Export transaction data (admin only)
const exportTransactions = async (req, res, next) => {
  try {
    const {
      format = "csv",
      startDate,
      endDate,
      status,
      type,
      plan,
    } = req.query;

    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (plan) filter.plan = plan;

    const transactions = await Transaction.find(filter)
      .populate("user", "username email")
      .populate("subscription", "plan imei")
      .sort({ createdAt: -1 })
      .lean();

    if (format === "csv") {
      // Convert to CSV format
      const csvHeader = [
        "Transaction ID",
        "User Email",
        "Username",
        "Plan",
        "Amount",
        "Status",
        "Type",
        "Created At",
        "Completed At",
        "IMEI",
      ].join(",");

      const csvRows = transactions.map((tx) =>
        [
          tx.transactionId,
          tx.user?.email || "",
          tx.user?.username || "",
          tx.plan,
          tx.amount,
          tx.status,
          tx.type,
          tx.createdAt?.toISOString() || "",
          tx.completedAt?.toISOString() || "",
          tx.subscription?.imei || "",
        ].join(",")
      );

      const csvContent = [csvHeader, ...csvRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=transactions-${
          new Date().toISOString().split("T")[0]
        }.csv`
      );
      res.send(csvContent);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: { transactions },
        exportInfo: {
          format,
          totalRecords: transactions.length,
          exportedAt: new Date(),
        },
      });
    }
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllTransactions,
  getUserTransactions,
  getTransactionDetails,
  getFinancialSummary,
  updateTransactionStatus,
  createManualTransaction,
  getTransactionAnalytics,
  exportTransactions,
};
