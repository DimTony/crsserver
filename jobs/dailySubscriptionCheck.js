// jobs/dailySubscriptionCheck.js
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const Transaction = require("../models/transaction");
const { getSubscriptionDuration } = require("../utils/helpers");
require("dotenv").config();

class DailySubscriptionManager {
  constructor() {
    this.jobName = "Daily Subscription Check";
    this.isRunning = false;
  }

  async executeDaily() {
    if (this.isRunning) {
      console.log("⚠️ Daily subscription job is already running, skipping...");
      return;
    }

    this.isRunning = true;
    const startTime = new Date();

    try {
      console.log(`🚀 Starting ${this.jobName} at ${startTime.toISOString()}`);

      // Step 1: Expire due subscriptions
      const expiredResults = await this.expireDueSubscriptions();

      // Step 2: Activate next queued subscriptions
      const activatedResults = await this.activateNextQueuedSubscriptions();

      // Step 3: Generate job summary
      const summary = {
        jobStartTime: startTime,
        jobEndTime: new Date(),
        expiredSubscriptions: expiredResults,
        activatedSubscriptions: activatedResults,
        totalProcessed: expiredResults.length + activatedResults.length,
      };

      console.log("✅ Daily subscription job completed successfully");
      console.log("📊 Job Summary:", JSON.stringify(summary, null, 2));

      return summary;
    } catch (error) {
      console.error("❌ Daily subscription job failed:", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async expireDueSubscriptions() {
    const session = await mongoose.startSession();
    const expiredSubscriptions = [];

    try {
      await session.startTransaction();

      // Find subscriptions that are due today (endDate <= today at end of day)
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const dueSubscriptions = await Subscription.find({
        status: "ACTIVE",
        endDate: { $lte: endOfToday },
      }).session(session);

      console.log(
        `📅 Found ${dueSubscriptions.length} subscriptions due for expiration`
      );

      for (const subscription of dueSubscriptions) {
        try {
          // Update subscription status to EXPIRED
          subscription.status = "EXPIRED";
          subscription.expiredAt = new Date();
          await subscription.save({ session });

          // Create expiration transaction
          const expirationTransaction = new Transaction({
            user: subscription.user,
            subscription: subscription._id,
            device: subscription.device,
            transactionId: Transaction.generateTransactionId(),
            type: "SUBSCRIPTION_EXPIRED",
            amount: 0,
            plan: subscription.plan,
            status: "COMPLETED",
            completedAt: new Date(),
            metadata: {
              expiredAt: new Date(),
              originalEndDate: subscription.endDate,
              autoExpired: true,
              jobExecuted: true,
            },
            subscriptionPeriod: {
              startDate: subscription.startDate,
              endDate: subscription.endDate,
            },
          });

          await expirationTransaction.save({ session });

          expiredSubscriptions.push({
            subscriptionId: subscription._id,
            imei: subscription.imei,
            plan: subscription.plan,
            user: subscription.user,
            endDate: subscription.endDate,
            transactionId: expirationTransaction.transactionId,
          });

          console.log(
            `⏰ Expired subscription ${subscription._id} for IMEI ${subscription.imei}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to expire subscription ${subscription._id}:`,
            error
          );
          // Continue with other subscriptions even if one fails
        }
      }

      await session.commitTransaction();
      console.log(
        `✅ Successfully expired ${expiredSubscriptions.length} subscriptions`
      );
    } catch (error) {
      await session.abortTransaction();
      console.error("❌ Failed to expire due subscriptions:", error);
      throw error;
    } finally {
      await session.endSession();
    }

    return expiredSubscriptions;
  }

  async activateNextQueuedSubscriptions() {
    const activatedSubscriptions = [];

    try {
      // Get all unique IMEIs that have queued subscriptions
      const uniqueIMEIs = await Subscription.distinct("imei", {
        status: "QUEUED",
      });

      console.log(
        `📱 Found ${uniqueIMEIs.length} devices with queued subscriptions`
      );

      for (const imei of uniqueIMEIs) {
        try {
          const activated = await this.activateNextForDevice(imei);
          if (activated) {
            activatedSubscriptions.push(activated);
          }
        } catch (error) {
          console.error(
            `❌ Failed to activate subscription for IMEI ${imei}:`,
            error
          );
          // Continue with other devices even if one fails
        }
      }

      console.log(
        `✅ Successfully activated ${activatedSubscriptions.length} subscriptions`
      );
    } catch (error) {
      console.error("❌ Failed to activate queued subscriptions:", error);
      throw error;
    }

    return activatedSubscriptions;
  }

  async activateNextForDevice(imei) {
    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      // Check if device already has an active subscription
      const existingActive = await Subscription.findOne({
        imei,
        status: "ACTIVE",
      }).session(session);

      if (existingActive) {
        console.log(
          `⚠️ Device ${imei} already has an active subscription, skipping activation`
        );
        await session.abortTransaction();
        return null;
      }

      // Find the next queued subscription (lowest queue position)
      const nextQueued = await Subscription.findOne({
        imei,
        status: "QUEUED",
      })
        .sort({ queuePosition: 1, createdAt: 1 }) // Lowest queue position first, then FIFO
        .session(session);

      if (!nextQueued) {
        console.log(`📝 No queued subscriptions found for device ${imei}`);
        await session.abortTransaction();
        return null;
      }

      // Activate the subscription
      const subscriptionDuration = getSubscriptionDuration(nextQueued.plan);
      const now = new Date();

      nextQueued.status = "ACTIVE";
      nextQueued.startDate = now;
      nextQueued.endDate = new Date(
        now.getTime() + subscriptionDuration * 24 * 60 * 60 * 1000
      );
      nextQueued.activatedAt = now;
      nextQueued.autoActivated = true;

      await nextQueued.save({ session });

      // Create activation transaction
      const activationTransaction = new Transaction({
        user: nextQueued.user,
        subscription: nextQueued._id,
        device: nextQueued.device,
        transactionId: Transaction.generateTransactionId(),
        type: "SUBSCRIPTION_ACTIVATED",
        amount: nextQueued.price,
        plan: nextQueued.plan,
        status: "COMPLETED",
        completedAt: now,
        metadata: {
          activatedAt: now,
          autoActivated: true,
          jobExecuted: true,
          queuePosition: nextQueued.queuePosition,
        },
        subscriptionPeriod: {
          startDate: nextQueued.startDate,
          endDate: nextQueued.endDate,
          duration: subscriptionDuration,
        },
      });

      await activationTransaction.save({ session });

      // Reorder remaining queue for this device
      await this.reorderDeviceQueue(imei, session);

      await session.commitTransaction();

      const result = {
        subscriptionId: nextQueued._id,
        imei: nextQueued.imei,
        plan: nextQueued.plan,
        user: nextQueued.user,
        startDate: nextQueued.startDate,
        endDate: nextQueued.endDate,
        queuePosition: nextQueued.queuePosition,
        transactionId: activationTransaction.transactionId,
      };

      console.log(
        `🎉 Activated subscription ${nextQueued._id} for IMEI ${imei} (was queue position ${nextQueued.queuePosition})`
      );

      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async reorderDeviceQueue(imei, session) {
    try {
      // Get remaining queued subscriptions for this device
      const remainingQueued = await Subscription.find({
        imei,
        status: "QUEUED",
      })
        .sort({ queuePosition: 1, createdAt: 1 })
        .session(session);

      // Reorder queue positions
      for (let i = 0; i < remainingQueued.length; i++) {
        remainingQueued[i].queuePosition = (i + 1).toString();
        await remainingQueued[i].save({ session });
      }

      console.log(
        `🔄 Reordered ${remainingQueued.length} remaining queued subscriptions for device ${imei}`
      );
    } catch (error) {
      console.error(`❌ Failed to reorder queue for device ${imei}:`, error);
      throw error;
    }
  }

  // Method to run the job manually (for testing)
  async runManual() {
    console.log("🔧 Running daily subscription job manually...");
    return await this.executeDaily();
  }

  // Method to check job status
  getStatus() {
    return {
      jobName: this.jobName,
      isRunning: this.isRunning,
      lastRun: this.lastRun || null,
    };
  }
}

// Export singleton instance
const dailySubscriptionManager = new DailySubscriptionManager();

// Function to set up the daily cron job
const setupDailyJob = () => {
  // Option 1: Using node-cron (install with: npm install node-cron)
  const cron = require("node-cron");

  // Run every day at 2 AM
  cron.schedule(
    "0 2 * * *",
    async () => {
      try {
        await dailySubscriptionManager.executeDaily();
      } catch (error) {
        console.error("❌ Scheduled daily job failed:", error);
        // Add your error notification logic here (email, Slack, etc.)
      }
    },
    {
      timezone: "UTC", // Adjust timezone as needed
    }
  );

  console.log("⏰ Daily subscription job scheduled for 2:00 AM UTC");
};

// Alternative setup function using setTimeout (if you prefer not to use node-cron)
const setupDailyJobWithTimeout = () => {
  const scheduleNext = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0); // 2 AM

    const timeUntilTomorrow = tomorrow.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        await dailySubscriptionManager.executeDaily();
      } catch (error) {
        console.error("❌ Scheduled daily job failed:", error);
      }
      scheduleNext(); // Schedule the next run
    }, timeUntilTomorrow);

    console.log(
      `⏰ Next daily subscription job scheduled for ${tomorrow.toISOString()}`
    );
  };

  scheduleNext();
};

module.exports = {
  DailySubscriptionManager,
  dailySubscriptionManager,
  setupDailyJob,
  setupDailyJobWithTimeout,
};
