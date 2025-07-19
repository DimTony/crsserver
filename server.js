const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");
const socketIo = require("socket.io");
// const setupSocket = require("./utils/socketHandler");
const dotenv = require("dotenv");
const logger = require("morgan");
const connectDB = require("./config/database");
const errorHandler = require("./middleware/errorHandler");
const CustomError = require("./utils/customError");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const subscriptionRoutes = require("./routes/subscription");
const deviceRoutes = require("./routes/device");
const adminRoutes = require("./routes/admin");
// const jarradTicketRoutes = require("./routes/jarradTicket");
// const jarradWrigleyRoutes = require("./routes/jarradWrigley");
// const lazadaRoutes = require("./routes/lazada");
// const mailingListRoutes = require("./routes/mailingList");
// const portfolioRoutes = require("./routes/portfolio");
// const researchRoutes = require("./routes/research");
// const testRoutes = require("./routes/test");
// const trackingRoutes = require("./routes/tracking");
// const volunteerRoutes = require("./routes/volunteer");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(express.json());

const allowedOrigins = [
  "https://mock-kappa.vercel.app",
  // "https://admin.yourdomain.com",
  "http://localhost:3000", // for local development
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked CORS request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // optional, if you're using cookies or sessions
};

app.use(cors(corsOptions));
app.use(helmet());

app.use(logger("dev"));

// Setup socket handlers
// setupSocket(io);

// Connect to MongoDB
connectDB();

// app.use((req, res, next) => {
//   console.log("Incoming request:", {
//     method: req.method,
//     url: req.url,
//     headers: req.headers,
//     body: req.body, // Note: This will not show file uploads
//     files: req.files, // This will show files if multer is used
//   });
//   next();
// });

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/admin", adminRoutes);
// app.use("/api/jarrad-ticket", jarradTicketRoutes);
// app.use("/api/jarrad-wrigley", jarradWrigleyRoutes);
// app.use("/api/lazada", lazadaRoutes);
// app.use("/api/mailing", mailingListRoutes);
// app.use("/api/portfolio", portfolioRoutes);
// app.use("/api/researches", researchRoutes);
// // Note: Ensure that the test routes are not used in production
// app.use("/api/test", testRoutes);
// app.use("/api/tracking", trackingRoutes);
// app.use("/api/volunteers", volunteerRoutes);

// Keep alive endpoint
app.get("/keep-alive", (req, res) => {
  res.status(200).send("Server is alive");
});

app.all("*", (req, res, next) => {
  const err = new CustomError(
    404,
    // `Welcome To CRS. Can't find ${req.originalUrl} on the server`
    `Resource not found`
  );

  next(err);
});

// Error handling middleware (should be last)
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on("unhandledRejection", (err) => {
  console.log(err.name, ":", err.message);
  console.log("Unhandled Rejection Occurred! Shutting Down...");
  server.close(() => {
    process.exit(1);
  });
});
