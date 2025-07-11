// routes/chat.js
const express = require("express");
const router = express.Router();
const Message = require("../models/message");
const Chat = require("../models/chat");
const auth = require("../middleware/auth");

// Get user conversations
router.get("/conversations", auth, async (req, res) => {
  try {
    const conversations = await Chat.find({
      participants: req.user.id,
    })
      .populate("participants", "name avatar")
      .populate("lastMessage")
      .sort({ lastActivity: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages with pagination
router.get("/conversations/:id/messages", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversation: id })
      .populate("sender", "name avatar")
      .populate("replyTo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalMessages = await Message.countDocuments({ conversation: id });
    const hasMore = skip + messages.length < totalMessages;

    res.json({
      messages: messages.reverse(), // Reverse to show oldest first
      hasMore,
      currentPage: page,
      totalPages: Math.ceil(totalMessages / limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or get conversation
router.post("/conversations", auth, async (req, res) => {
  try {
    const { participants, type = "direct" } = req.body;

    // For direct messages, check if conversation already exists
    if (type === "direct") {
      const existing = await Chat.findOne({
        type: "direct",
        participants: { $all: participants, $size: participants.length },
      });

      if (existing) {
        return res.json(existing);
      }
    }

    const conversation = new Chat({
      participants,
      type,
    });

    await conversation.save();
    await conversation.populate("participants", "name avatar");

    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
