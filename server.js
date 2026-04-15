import express from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import { dbConnections } from "./Database/db.js";
import compression from "compression";



import schoolRoute from "./Routes/school.route.js";
import userRoute from "./Routes/userlogin.route.js";
import branchRoute from "./Routes/branch.route.js";
import branchGroupRoute from "./Routes/branchGroup.route.js";
import parentsRoute from "./Routes/parents.route.js";
import supervisorRoute from "./Routes/supervisor.route.js";
import driverRoute from "./Routes/driver.route.js";






import { setupSocket } from "./Utils/socket/socket.js";




import authenticateUser from "./Middleware/authMiddleware.js";




dotenv.config();

const app = express();
const server = createServer(app);
app.use(compression());
app.use("/uploads", express.static("uploads"));
// app.use("/api/upload", UploadRoutes);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "This is new ParentsEye Backend Server",
    status: 200,
    statusText: "OK",
  });
});

// Use routes
app.use("/api", schoolRoute);
app.use("/api", branchRoute);
app.use("/api", branchGroupRoute);
app.use("/api", parentsRoute);
app.use("/api", supervisorRoute);
app.use("/api", driverRoute);
app.use("/auth", userRoute);









setupSocket(server);



// Start server and connect to database
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  try {
    console.log(`Server is listening on port ${PORT}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// testing of pipline
