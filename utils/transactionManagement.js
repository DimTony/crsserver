// utils/transactionUtils.js
const Transaction = require("../models/transaction");
const Subscription = require("../models/subscription");
const User = require("../models/user");
const { getSubscriptionDuration } = require("./helpers");

// Process expired subscriptions
const processExpiredSubscriptions = async () => {
  try {
    console.log("🔄 Processing expired subscriptions...");

    const expiredSubscriptions = await Subscription.find({
      status: "ACTIVE",
      endDate: { $lt: new Date() }
    });

    console.log(`📊 Found ${expiredSubscriptions.length} expired subscriptions`);

    for (const subscription of expiredSubscriptions) {
      // Create expiration transaction
      const transaction = new Transaction({
        user: subscription.user,
        subscription: subscription._id,
        transactionId: Transaction.generateTransactionId(),
        type: "SUBSCRIPTION_EXPIRED",
        amount: 0,
        plan: subscription.plan,
        status: "COMPLETED",
        completedAt: new Date(),
        metadata: {
          expiredAt: new Date(),
          originalEndDate: subscription.endDate
        }
      });

      await transaction.save();

      // Update subscription status
      subscription.status = "EXPIRED";
      await subscription.save();

      console.log(`✅ Expired subscription ${subscription._id}`);
    }

    return { processed: expiredSubscriptions.length };
  } catch (error) {
    console.error("❌ Error processing expired subscriptions:", error);
    throw error;
  }
};

// Process pending plan changes
const processPendingPlanChanges = async () => {
  try {
    console.log("🔄 Processing pending plan changes...");

    const subscriptionsWithPendingChanges = await Subscription.find({
      "pendingPlanChange.effectiveDate": { $lte: new Date() },
      status: "ACTIVE"
    });

    console.log(`📊 Found ${subscriptionsWithPendingChanges.length} pending plan changes`);

    for (const subscription of subscriptionsWithPendingChanges) {
      const { newPlan, newPrice } = subscription.pendingPlanChange;

      // Create plan change transaction
      const transaction = new Transaction({
        user: subscription.user,
        subscription: subscription._id,
        transactionId: Transaction.generateTransactionId(),
        type: "SUBSCRIPTION_DOWNGRADED",
        amount: newPrice,
        plan: newPlan,
        status: "COMPLETED",
        completedAt: new Date(),
        metadata: {
          oldPlan: subscription.plan,
          newPlan,
          planChangeEffective: new Date()
        }
      });

      await transaction.save();

      // Apply plan change
      subscription.plan = newPlan;
      subscription.price = newPrice;
      subscription.pendingPlanChange = undefined;

      // Extend subscription based on new plan
      const newDuration = getSubscriptionDuration(newPlan);
      subscription.endDate = new Date(Date.now() + newDuration * 24 * 60 * 60 * 1000);

      await subscription.save();

      console.log(`✅ Applied plan change for subscription ${subscription._id}`);
    }

    return { processed: subscriptionsWithPendingChanges.length };
  } catch (error) {
    console.error("❌ Error processing pending plan changes:", error);
    throw error;
  }
};

// Retry failed transactions
const retryFailedTransactions = async () => {
  try {
    console.log("🔄 Retrying failed transactions...");

    // Find failed payment transactions from last 7 days
    const failedTransactions = await Transaction.find({
      status: "FAILED",
      type: { $in: ["PAYMENT_PENDING", "PAYMENT_FAILED"] },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      retryCount: { $lt: 3 } // Max 3 retry attempts
    });

    console.log(`📊 Found ${failedTransactions.length} failed transactions to retry`);

    for (const transaction of failedTransactions) {
      try {
        // This would integrate with your payment processor
        const retryResult = await retryPaymentProcessing(transaction);

        if (retryResult.success) {
          await transaction.updateStatus("COMPLETED", {
            type: "PAYMENT_COMPLETED",
            completedAt: new Date(),
            retryCount: (transaction.retryCount || 0) + 1
          });

          // Activate associated subscription if needed
          const subscription = await Subscription.findById(transaction.subscription);
          if (subscription && subscription.status === "PENDING") {
            subscription.status = "ACTIVE";
            subscription.startDate = new Date();
            subscription.endDate = new Date(
              Date.now() + getSubscriptionDuration(subscription.plan) * 24 * 60 * 60 * 1000
            );
            await subscription.save();
          }

          console.log(`✅ Retry successful for transaction ${transaction.transactionId}`);
        } else {
          // Update retry count
          transaction.retryCount = (transaction.retryCount || 0) + 1;
          transaction.metadata = {
            ...transaction.metadata,
            lastRetryAt: new Date(),
            lastRetryError: retryResult.error
          };
          await transaction.save();

          console.log(`❌ Retry failed for transaction ${transaction.transactionId}`);
        }
      } catch (error) {
        console.error(`❌ Error retrying transaction ${transaction.transactionId}:`, error);
      }
    }

    return { processed: failedTransactions.length };
  } catch (error) {
    console.error("❌ Error retrying failed transactions:", error);
    throw error;
  }
};

// Mock payment retry function - replace with actual payment processor
const retryPaymentProcessing = async (transaction) => {
  // This would integrate with Stripe, PayPal, etc.
  return {
    success: Math.random() > 0.5, // 50% success rate for demo
    error: "Payment method declined"
  };
};

// Generate transaction reports
const generateDailyTransactionReport = async () => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const report = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: {
            status: "$status",
            type: "$type"
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" }
        }
      }
    ]);

    console.log("📊 Daily Transaction Report:");
    console.table(report);

    return report;
  } catch (error) {
    console.error("❌ Error generating daily report:", error);
    throw error;
  }
};



// Utility to reconcile transactions with subscriptions
const reconcileTransactions = async () => {
  try {
    console.log("🔄 Starting transaction reconciliation...");

    // Find subscriptions without transactions
    const subscriptionsWithoutTransactions = await Subscription.find({}).lean();
    const existingTransactionSubs = new Set(
      (await Transaction.distinct("subscription")).map((id) => id.toString())
    );

    const missingTransactions = subscriptionsWithoutTransactions.filter(
      (sub) => !existingTransactionSubs.has(sub._id.toString())
    );

    console.log(
      `📊 Found ${missingTransactions.length} subscriptions without transactions`
    );

    // Create missing transactions
    for (const subscription of missingTransactions) {
      try {
        const transaction = await Transaction.createSubscriptionTransaction({
          user: subscription.user,
          _id: subscription._id,
          device: subscription.device,
          price: subscription.price || 0,
          plan: subscription.plan,
          imei: subscription.imei,
          deviceName: subscription.deviceName,
          phone: subscription.phone,
          email: subscription.email,
          cards: subscription.cards || [],
          queuePosition: subscription.queuePosition,
          createdAt: subscription.createdAt,
        });

        // Update transaction status based on subscription status
        let transactionStatus = "PENDING";
        let transactionType = "SUBSCRIPTION_CREATED";

        if (subscription.status === "ACTIVE") {
          transactionStatus = "COMPLETED";
          transactionType = "SUBSCRIPTION_ACTIVATED";
        } else if (subscription.status === "CANCELLED") {
          transactionStatus = "CANCELLED";
          transactionType = "SUBSCRIPTION_CANCELLED";
        } else if (subscription.status === "EXPIRED") {
          transactionStatus = "COMPLETED";
          transactionType = "SUBSCRIPTION_EXPIRED";
        }

        await transaction.updateStatus(transactionStatus, {
          type: transactionType,
          subscriptionPeriod: {
            startDate: subscription.startDate,
            endDate: subscription.endDate,
          },
        });

        console.log(
          `✅ Created transaction for subscription ${subscription._id}`
        );
      } catch (error) {
        console.error(
          `❌ Failed to create transaction for subscription ${subscription._id}:`,
          error.message
        );
      }
    }

    console.log("✅ Transaction reconciliation completed");
    return {
      processed: missingTransactions.length,
      success: true,
    };
  } catch (error) {
    console.error("❌ Transaction reconciliation failed:", error);
    return {
      processed: 0,
      success: false,
      error: error.message,
    };
  }
};

// Generate financial report
const generateFinancialReport = async (startDate, endDate) => {
  try {
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = dateFilter.length > 0 ? { createdAt: dateFilter } : {};

    // Revenue summary
    const revenueSummary = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          transactionCount: { $sum: 1 },
          avgAmount: { $avg: "$amount" },
        },
      },
    ]);

    // Plan performance
    const planPerformance = await Transaction.aggregate([
      { $match: { ...matchStage, status: "COMPLETED" } },
      {
        $group: {
          _id: "$plan",
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
          avgPrice: { $avg: "$amount" },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    // Monthly trends
    const monthlyTrends = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            status: "$status",
          },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Transaction type breakdown
    const typeBreakdown = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return {
      reportPeriod: { startDate, endDate },
      revenueSummary,
      planPerformance,
      monthlyTrends,
      typeBreakdown,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error("Failed to generate financial report:", error);
    throw error;
  }
};

// Audit transaction integrity
const auditTransactionIntegrity = async () => {
  try {
    console.log("🔍 Starting transaction integrity audit...");

    const issues = [];

    // Check for transactions without corresponding subscriptions
    const transactionsWithoutSubs = await Transaction.find({})
      .populate("subscription")
      .lean();

    const orphanedTransactions = transactionsWithoutSubs.filter(
      (tx) => !tx.subscription
    );

    if (orphanedTransactions.length > 0) {
      issues.push({
        type: "ORPHANED_TRANSACTIONS",
        count: orphanedTransactions.length,
        transactions: orphanedTransactions.map((tx) => tx.transactionId),
      });
    }

    // Check for duplicate transaction IDs
    const duplicateCheck = await Transaction.aggregate([
      {
        $group: {
          _id: "$transactionId",
          count: { $sum: 1 },
          transactions: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (duplicateCheck.length > 0) {
      issues.push({
        type: "DUPLICATE_TRANSACTION_IDS",
        count: duplicateCheck.length,
        duplicates: duplicateCheck,
      });
    }

    // Check for transactions with invalid amounts
    const invalidAmounts = await Transaction.find({
      $or: [
        { amount: { $lt: 0 } },
        { amount: null },
        { amount: { $exists: false } },
      ],
    }).lean();

    if (invalidAmounts.length > 0) {
      issues.push({
        type: "INVALID_AMOUNTS",
        count: invalidAmounts.length,
        transactions: invalidAmounts.map((tx) => tx.transactionId),
      });
    }

    // Check for status inconsistencies
    const statusInconsistencies = await Transaction.aggregate([
      {
        $lookup: {
          from: "subscriptions",
          localField: "subscription",
          foreignField: "_id",
          as: "sub",
        },
      },
      {
        $match: {
          $and: [
            { "sub.status": "ACTIVE" },
            { status: { $nin: ["COMPLETED", "PENDING"] } },
          ],
        },
      },
    ]);

    if (statusInconsistencies.length > 0) {
      issues.push({
        type: "STATUS_INCONSISTENCIES",
        count: statusInconsistencies.length,
        transactions: statusInconsistencies.map((tx) => tx.transactionId),
      });
    }

    console.log(`✅ Audit completed. Found ${issues.length} issue types`);

    return {
      auditDate: new Date(),
      totalIssues: issues.reduce((sum, issue) => sum + issue.count, 0),
      issues,
      healthy: issues.length === 0,
    };
  } catch (error) {
    console.error("❌ Transaction audit failed:", error);
    throw error;
  }
};

// Calculate user lifetime value
const calculateUserLTV = async (userId) => {
  try {
    const userTransactions = await Transaction.find({
      user: userId,
      status: "COMPLETED",
    }).lean();

    const ltv = {
      totalRevenue: userTransactions.reduce((sum, tx) => sum + tx.amount, 0),
      totalTransactions: userTransactions.length,
      avgTransactionValue: 0,
      firstTransaction: null,
      lastTransaction: null,
      planBreakdown: {},
    };

    if (userTransactions.length > 0) {
      ltv.avgTransactionValue = ltv.totalRevenue / ltv.totalTransactions;
      ltv.firstTransaction = Math.min(
        ...userTransactions.map((tx) => tx.createdAt)
      );
      ltv.lastTransaction = Math.max(
        ...userTransactions.map((tx) => tx.createdAt)
      );

      // Plan breakdown
      userTransactions.forEach((tx) => {
        if (!ltv.planBreakdown[tx.plan]) {
          ltv.planBreakdown[tx.plan] = { count: 0, revenue: 0 };
        }
        ltv.planBreakdown[tx.plan].count++;
        ltv.planBreakdown[tx.plan].revenue += tx.amount;
      });
    }

    return ltv;
  } catch (error) {
    console.error(`Failed to calculate LTV for user ${userId}:`, error);
    throw error;
  }
};

// Export transaction data for analytics
const exportTransactionData = async (filters = {}) => {
  try {
    const transactions = await Transaction.find(filters)
      .populate("user", "username email")
      .populate("subscription", "plan imei")
      .lean();

    return transactions.map((tx) => ({
      transactionId: tx.transactionId,
      userEmail: tx.user?.email,
      userName: tx.user?.username,
      plan: tx.plan,
      amount: tx.amount,
      status: tx.status,
      type: tx.type,
      createdAt: tx.createdAt,
      completedAt: tx.completedAt,
      imei: tx.subscription?.imei,
      paymentMethod: tx.paymentMethod,
    }));
  } catch (error) {
    console.error("Failed to export transaction data:", error);
    throw error;
  }
};

module.exports = {
  reconcileTransactions,
  generateFinancialReport,
  auditTransactionIntegrity,
  calculateUserLTV,
  exportTransactionData,
  
    processExpiredSubscriptions,
    processPendingPlanChanges,
    retryFailedTransactions,
    generateDailyTransactionReport
  
};
