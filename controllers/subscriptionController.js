// controllers/subscriptionController.js - MISSING
const Transaction = require("../models/transaction");
const Subscription = require("../models/subscription");
const {
  getSubscriptionPrice,
  getSubscriptionDuration,
} = require("../utils/helpers");

// Upgrade subscription
const upgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const oldPrice = subscription.price;
    const newPrice = getSubscriptionPrice(newPlan);

    if (newPrice <= oldPrice) {
      throw new CustomError(400, "New plan must be higher tier");
    }

    // Calculate prorated amount
    const remainingDays = Math.ceil(
      (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
    );
    const proratedAmount = newPrice - oldPrice;

    // Create upgrade transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_UPGRADED",
      amount: proratedAmount,
      plan: newPlan,
      status: "PENDING",
      metadata: {
        oldPlan,
        newPlan,
        proratedDays: remainingDays,
        fullNewPrice: newPrice,
        oldPrice,
      },
    });

    await transaction.save();

    // Update subscription
    subscription.plan = newPlan;
    subscription.price = newPrice;

    // Extend end date based on new plan duration
    const newDuration = getSubscriptionDuration(newPlan);
    subscription.endDate = new Date(
      subscription.startDate.getTime() + newDuration * 24 * 60 * 60 * 1000
    );

    await subscription.save();

    // Mark transaction as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      subscription,
      transaction,
      proratedAmount,
    });
  } catch (err) {
    next(err);
  }
};

// Downgrade subscription
const downgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const newPrice = getSubscriptionPrice(newPlan);

    // Create downgrade transaction (no immediate charge)
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_DOWNGRADED",
      amount: 0, // No immediate charge for downgrade
      plan: newPlan,
      status: "COMPLETED",
      metadata: {
        oldPlan,
        newPlan,
        effectiveDate: subscription.endDate, // Takes effect at next billing cycle
        newPrice,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    // Schedule the downgrade for next billing cycle
    subscription.pendingPlanChange = {
      newPlan,
      newPrice,
      effectiveDate: subscription.endDate,
    };

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription downgrade scheduled for next billing cycle",
      subscription,
      transaction,
      effectiveDate: subscription.endDate,
    });
  } catch (err) {
    next(err);
  }
};

// Cancel subscription
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { reason, immediate = false } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_CANCELLED",
      amount: 0,
      plan: subscription.plan,
      status: "COMPLETED",
      metadata: {
        cancellationReason: reason,
        immediate,
        originalEndDate: subscription.endDate,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    if (immediate) {
      subscription.status = "CANCELLED";
      subscription.endDate = new Date();
    } else {
      subscription.cancelledAt = new Date();
      subscription.cancellationReason = reason;
      // Subscription remains active until end date
    }

    await subscription.save();

    res.json({
      success: true,
      message: immediate
        ? "Subscription cancelled immediately"
        : "Subscription will end at the current billing cycle",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

// Renew expired subscription
const renewSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "EXPIRED",
    });

    if (!subscription) {
      throw new CustomError(404, "Expired subscription not found");
    }

    // Create renewal transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_ACTIVATED",
      amount: subscription.price,
      plan: subscription.plan,
      status: "PENDING",
    });

    await transaction.save();

    // This would typically integrate with payment processing
    // For now, we'll mark as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    // Reactivate subscription
    const duration = getSubscriptionDuration(subscription.plan);
    subscription.status = "ACTIVE";
    subscription.startDate = new Date();
    subscription.endDate = new Date(
      Date.now() + duration * 24 * 60 * 60 * 1000
    );
    subscription.cancelledAt = null;
    subscription.cancellationReason = null;

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription renewed successfully",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  renewSubscription,
};
