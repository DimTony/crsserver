// utils/migration.js
// Run this script to update existing users with email verification fields
const mongoose = require("mongoose");
const User = require("../models/user");
require("dotenv").config();

const migrateExistingUsers = async () => {
  try {
    console.log("🚀 Starting database migration for email verification...");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Find all users that don't have email verification fields
    const usersToUpdate = await User.find({
      $or: [
        { isEmailVerified: { $exists: false } },
        { isActive: { $exists: false } },
      ],
    });

    console.log(`📊 Found ${usersToUpdate.length} users to update`);

    if (usersToUpdate.length === 0) {
      console.log("✅ No users need migration");
      return;
    }

    // Update users in batches
    const batchSize = 100;
    let updated = 0;

    for (let i = 0; i < usersToUpdate.length; i += batchSize) {
      const batch = usersToUpdate.slice(i, i + batchSize);
      const userIds = batch.map((user) => user._id);

      await User.updateMany(
        { _id: { $in: userIds } },
        {
          $set: {
            isEmailVerified: true, // Mark existing users as verified
            isActive: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
          },
        }
      );

      updated += batch.length;
      console.log(`📝 Updated ${updated}/${usersToUpdate.length} users`);
    }

    console.log("✅ Migration completed successfully!");
    console.log(`📊 Total users updated: ${updated}`);
  } catch (error) {
    console.error("❌ Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
};

// Option to mark all existing users as unverified (if you want to force verification)
const forceVerificationForExistingUsers = async () => {
  try {
    console.log("🚀 Starting forced verification migration...");

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const result = await User.updateMany(
      {},
      {
        $set: {
          isEmailVerified: false,
          isActive: false,
          emailVerificationToken: null,
          emailVerificationExpires: null,
        },
      }
    );

    console.log(
      `✅ Updated ${result.modifiedCount} users - they will need to verify email`
    );
  } catch (error) {
    console.error("❌ Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
};

// Run migration based on command line argument
const runMigration = async () => {
  const mode = process.argv[2];

  if (mode === "--force-verification") {
    await forceVerificationForExistingUsers();
  } else {
    await migrateExistingUsers();
  }
};

// Only run if this file is called directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  migrateExistingUsers,
  forceVerificationForExistingUsers,
};
