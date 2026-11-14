import jwt from "jsonwebtoken";
import authCache from "../Utils/authCache.js";

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
    const decoded = jwt.verify(token, secret);

    const userId = decoded.id;
    const { role, loginAccess } = decoded;

    if (role !== "superAdmin" && loginAccess === false) {
      return res.status(401).json({
        success: false,
        message: "Your login access is denied",
      });
    }

    // Check Cache
    const cachedUser = authCache.get(userId);

    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    const userContext = {
      id: decoded.id,
      name: decoded.name || decoded.username,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      zone: decoded.zone || null,
      cluster: decoded.cluster || null,
      centres: decoded.centres || [],
      loginAccess: decoded.loginAccess ?? true,
    };

    // Save to Cache
    authCache.set(userId, userContext);

    req.user = userContext;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Access token expired. Please refresh your session using /auth/refresh-token.",
        code: "TOKEN_EXPIRED",
      });
    }
    console.error("Auth error:", error.message);
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export default authenticateUser;
