import express from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import { dbConnections } from "./Database/db.js";
import authRoute from "./Routes/auth.route.js";
import userRoute from "./Routes/user.route.js";
import incidentRoute from "./Routes/incident.route.js";
import { setupSocket } from "./Utils/socket/socket.js";

dotenv.config();

const app = express();
const server = createServer(app);

// Global Middleware
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use("/uploads", express.static("uploads"));

// Health Check
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Pre-K Division National Incident & Safety Reporting Portal API Server (BRD v1.1)",
    status: 200,
    statusText: "OK",
  });
});

// Pre-K Portal API Routes (BRD v1.1)
app.use("/auth", authRoute);
app.use("/api", userRoute);
app.use("/api", incidentRoute);

// WebSocket Setup
setupSocket(server);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  try {
    console.log(`Pre-K Safety Portal Backend is running on port ${PORT}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

export default app;
