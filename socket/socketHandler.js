// socket/socketHandler.js
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const Message = require("../models/message");
const Chat = require("../models/chat");

class SocketHandler {
  constructor(server) {
    this.io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.activeUsers = new Map();
    this.setupSocketAuth();
    this.setupSocketEvents();
  }

  setupSocketAuth() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
      } catch (err) {
        next(new Error("Authentication error"));
      }
    });
  }

  setupSocketEvents() {
    this.io.on("connection", (socket) => {
      console.log(`User ${socket.userId} connected`);

      // Store active user
      this.activeUsers.set(socket.userId, socket.id);

      // Join user to their conversations
      this.joinUserRooms(socket);

      // Handle new messages
      socket.on("send_message", (data) => this.handleSendMessage(socket, data));

      // Handle typing indicators
      socket.on("typing_start", (data) => this.handleTypingStart(socket, data));
      socket.on("typing_stop", (data) => this.handleTypingStop(socket, data));

      // Handle message read receipts
      socket.on("mark_read", (data) => this.handleMarkRead(socket, data));

      // Handle disconnection
      socket.on("disconnect", () => this.handleDisconnect(socket));
    });
  }

  async joinUserRooms(socket) {
    try {
      const conversations = await Chat.find({
        participants: socket.userId,
      });

      conversations.forEach((conv) => {
        socket.join(conv._id.toString());
      });
    } catch (error) {
      console.error("Error joining rooms:", error);
    }
  }

  async handleSendMessage(socket, data) {
    try {
      const { conversationId, content, type = "text", replyTo } = data;

      // Create new message
      const message = new Message({
        conversation: conversationId,
        sender: socket.userId,
        content: {
          text: content,
          type: type,
        },
        replyTo: replyTo || null,
      });

      await message.save();
      await message.populate("sender", "name avatar");

      // Update conversation's last message
      await Chat.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        lastActivity: new Date(),
      });

      // Emit to all participants
      this.io.to(conversationId).emit("new_message", message);
    } catch (error) {
      socket.emit("message_error", { error: error.message });
    }
  }

  handleTypingStart(socket, { conversationId }) {
    socket.to(conversationId).emit("user_typing", {
      userId: socket.userId,
      conversationId,
    });
  }

  handleTypingStop(socket, { conversationId }) {
    socket.to(conversationId).emit("user_stop_typing", {
      userId: socket.userId,
      conversationId,
    });
  }

  async handleMarkRead(socket, { conversationId, messageId }) {
    try {
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: {
          readBy: {
            user: socket.userId,
            readAt: new Date(),
          },
        },
      });

      socket.to(conversationId).emit("message_read", {
        messageId,
        userId: socket.userId,
      });
    } catch (error) {
      console.error("Error marking message as read:", error);
    }
  }

  handleDisconnect(socket) {
    console.log(`User ${socket.userId} disconnected`);
    this.activeUsers.delete(socket.userId);
  }
}

module.exports = SocketHandler;
