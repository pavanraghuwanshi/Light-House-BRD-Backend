import { Server } from "socket.io";
import jwt from "jsonwebtoken";



let io;

export function setupSocket(server) {
  io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8,
  });

  console.log("✅ Socket.IO initialized");

  // Optional: setup basic connection logging

  io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  try {
    const authHeader =
      socket.handshake.auth?.token ||
      socket.handshake.headers.Authorization ;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log(`❌ Missing auth token: ${socket.id}`);
      socket.disconnect(true);
      return;
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);


  const { role, loginAccess } = decoded;

   if (role !== "superAdmin" && !loginAccess) {
    socket.emit("auth_error", {
      message: "Your login access is denied",
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 100);

    return;
  }

    socket.data.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      schoolId: decoded.schoolId || null,
      branchId: decoded.branchId || null,
      AssignedBranch: decoded.AssignedBranch || null,
    };

    console.log(`✅ Socket authenticated: ${socket.id} (${decoded.role})`);
    initChatSocket(socket)
  } catch (err) {
    console.error(`❌ Socket auth error: ${socket.id}`, err.message);
    socket.emit("[error]", err.message)
    socket.disconnect(true);
    return;
  }


  socket.data.allDeviceInterval = null;
  socket.data.allDeviceTimeout = null;
  socket.data.singleDeviceInterval = null;
  socket.data.singleDeviceTimeout = null;

  socket.on("disconnect", (reason) => {
    console.log(`❌ Socket disconnected: ${socket.id}. Reason: ${reason}`);
    try {
      if (socket.data?.allDeviceInterval)
        clearInterval(socket.data.allDeviceInterval);
      if (socket.data?.allDeviceTimeout)
        clearTimeout(socket.data.allDeviceTimeout);
      if (socket.data?.singleDeviceInterval)
        clearInterval(socket.data.singleDeviceInterval);
      if (socket.data?.singleDeviceTimeout)
        clearTimeout(socket.data.singleDeviceTimeout);


    } catch (err) {
      console.error("❌ Error clearing socket timers:", err);
    }
  });
});


  return io;
}

export const getIo = () => {
  if (!io) {
    throw new Error("❌ Socket.io not initialized yet!");
  }
  return io;
};
