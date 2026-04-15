import jwt from "jsonwebtoken";
import authCache from "../Utils/authCache.js";


export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.id;
    const {role, loginAccess} = decoded;


    if (role !== "superAdmin" && !loginAccess) {
      return res.status(401).json({
        message: "Your login access is denied",
      });
    }

    // ✅ CHECK CACHE FIRST
    const cachedUser = authCache.get(userId);

    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    const userContext = {
      id: decoded.id,
      role: decoded.role,
      schoolId: decoded.schoolId || null,
      branchId: decoded.branchId || null,
      AssignedBranch: decoded.AssignedBranch || null,
      loginAccess:decoded.loginAccess
    };

    // ✅ SAVE TO CACHE
    authCache.set(userId, userContext);

    req.user = userContext;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};



export default authenticateUser;
