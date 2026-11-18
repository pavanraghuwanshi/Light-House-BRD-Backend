import User from "../Models/user.js";
import Centre from "../Models/centre.js";
import jwt from "jsonwebtoken";
import { comparePassword, encrypt, decrypt } from "../Utils/crypto.js";
import authCache from "../Utils/authCache.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
import { escapeRegex } from "../Utils/roleResolver.js";
import recordAuditLog from "../Utils/auditLogger.js";

/**
 * FR-1.1, FR-1.2, FR-1.5, FR-1.6: Pre-K User Login Controller
 * Individual role-based logins for ~94 users across the 5 roles:
 * Area Operations Manager (AOM), Business Manager (BM), Regional Safety Officer (RSO),
 * National Head, and Central (All-Activity Admin).
 * - Enforces account lockout after 5 failed login attempts (FR-1.6).
 * - Logs all login attempts to audit trail (FR-1.5).
 */
export const loginUser = async (req, res) => {
  let { username, password } = req.body;
  username = username?.trim();
  password = password?.trim();

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username/email and password are required." });
  }

  try {
    const user = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: username.toLowerCase() },
      ],
    });

    if (!user) {
      await recordAuditLog({
        req,
        username,
        action: "LOGIN_FAILED_UNKNOWN_USER",
        entityType: "Auth",
      });
      return res.status(400).json({ success: false, message: "Invalid credentials." });
    }

    // FR-1.6: Account Lockout Check
    if (user.isLocked) {
      if (user.lockUntil && user.lockUntil > new Date()) {
        const minutesLeft = Math.ceil((user.lockUntil.getTime() - Date.now()) / (60 * 1000));
        return res.status(403).json({
          success: false,
          message: `Account is locked due to multiple failed login attempts. Please try again in ${minutesLeft} minutes or reset your password. (FR-1.6)`,
        });
      } else if (user.lockUntil && user.lockUntil <= new Date()) {
        // Lock duration expired
        user.isLocked = false;
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        await user.save();
      } else {
        return res.status(403).json({
          success: false,
          message: "Account is locked. Please contact Central administrator or use password reset. (FR-1.6)",
        });
      }
    }

    // Soft-deleted check
    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated or removed. Please contact your system administrator.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is deactivated. Please contact the administrator.",
      });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      const attemptsRemaining = Math.max(0, 5 - user.failedLoginAttempts);

      if (user.failedLoginAttempts >= 5) {
        user.isLocked = true;
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30-minute lockout
        await user.save();

        await recordAuditLog({
          req,
          userId: user._id,
          username: user.username,
          userRole: user.role,
          action: "ACCOUNT_LOCKED",
          entityType: "User",
          entityId: user._id,
          details: { reason: "5 consecutive failed login attempts reached" },
        });

        return res.status(403).json({
          success: false,
          message: "Account locked: 5 consecutive failed login attempts reached. Please reset password or contact Central administrator. (FR-1.6)",
        });
      }

      await user.save();

      await recordAuditLog({
        req,
        username: user.username,
        userRole: user.role,
        action: "LOGIN_FAILED",
        entityType: "Auth",
        details: { attemptsRemaining },
      });

      return res.status(400).json({
        success: false,
        message: `Incorrect password. ${attemptsRemaining} attempts remaining before account lockout.`,
      });
    }

    // Login successful: reset failed attempts
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const tokenPayload = {
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      zone: user.zone,
      cluster: user.cluster,
      centres: user.centres,
      loginAccess: true,
    };

    const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET || (secret + "_refresh_secret_2026");

    // 15-Minute Access Token
    const accessToken = jwt.sign(tokenPayload, secret, { expiresIn: "15m" });

    // 30-Day Refresh Token
    const refreshToken = jwt.sign(
      { id: user._id, username: user.username, role: user.role, type: "refresh" },
      refreshSecret,
      { expiresIn: "30d" }
    );

    // Persist refresh token in database
    user.refreshToken = refreshToken;
    user.refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await user.save();

    authCache.set(user._id.toString(), tokenPayload);

    await recordAuditLog({
      req,
      userId: user._id,
      username: user.username,
      userRole: user.role,
      action: "LOGIN_SUCCESS",
      entityType: "Auth",
      details: { role: user.role, zone: user.zone },
    });

    // Set secure httpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return res.status(200).json({
      success: true,
      message: "Successful Login",
      accessToken,
      token: accessToken, // backward-compatible alias
      refreshToken,
      expiresIn: "15m",
      refreshExpiresIn: "30d",
      role: user.role,
      username: user.username,
      name: user.name,
      zone: user.zone,
      cluster: user.cluster,
      centres: user.centres,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * FR-1.4: Unified Password Reset Controller
 * Single password reset endpoint for the entire system:
 * 1. Self-Service User: Requires `oldPassword` (or `oldPass`) and `newPassword` (or `newPass`).
 *    `username` is NOT required (identified via authenticated Bearer token).
 * 2. Central Administrator: Can reset any user's password using `userId` (or `username`) + `newPassword` without needing their old password.
 */
export const resetPassword = async (req, res) => {
  try {
    const oldPassword = req.body.oldPassword || req.body.oldPass || req.body.currentPassword;
    const newPassword = req.body.newPassword || req.body.newPass || req.body.password;
    const targetUserId = req.body.userId || req.body.id;
    const targetUsername = req.body.username || req.body.email;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "newPassword (or newPass) is required.",
        missingFields: ["newPassword"],
      });
    }

    // Determine requester identity from middleware or Authorization header
    let requesterId = req.user?.id || req.user?._id;
    let requesterRole = req.user?.role;

    if (!requesterId && req.headers?.authorization?.startsWith("Bearer ")) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
        const decoded = jwt.verify(token, secret);
        requesterId = decoded.id;
        requesterRole = decoded.role;
      } catch (tokenErr) {
        // Token verify fallback
      }
    }

    const isCentralAdmin = normalizePrekRole(requesterRole) === PREK_ROLES.CENTRAL || requesterRole === "superAdmin";

    // Find the target user
    let user;
    if (isCentralAdmin && (targetUserId || targetUsername)) {
      if (targetUserId) {
        user = await User.findById(targetUserId);
      } else {
        user = await User.findOne({
          $or: [
            { username: targetUsername.toLowerCase().trim() },
            { email: targetUsername.toLowerCase().trim() },
          ],
        });
      }
    } else if (requesterId) {
      // Authenticated user resetting their own password
      user = await User.findById(requesterId);
    } else if (targetUserId) {
      user = await User.findById(targetUserId);
    } else if (targetUsername) {
      user = await User.findOne({
        $or: [
          { username: targetUsername.toLowerCase().trim() },
          { email: targetUsername.toLowerCase().trim() },
        ],
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Authentication token or user identifier is required to reset password.",
      });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const isSelf = requesterId && requesterId.toString() === user._id.toString();

    // When resetting own password (or non-Central admin), oldPassword verification is mandatory
    if (!isCentralAdmin || isSelf) {
      if (!oldPassword) {
        return res.status(400).json({
          success: false,
          message: "oldPassword (or oldPass) is required.",
          missingFields: ["oldPassword"],
        });
      }

      const isMatch = comparePassword(String(oldPassword).trim(), user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Incorrect old password. Please enter your valid current password.",
        });
      }

      if (String(oldPassword).trim() === String(newPassword).trim()) {
        return res.status(400).json({
          success: false,
          message: "New password cannot be the same as the old password.",
        });
      }
    }

    user.password = encrypt(String(newPassword).trim());
    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    if (authCache && authCache.del) {
      authCache.del(user._id.toString());
    }

    await recordAuditLog({
      req,
      userId: user._id,
      username: user.username,
      userRole: user.role,
      action: isCentralAdmin && !isSelf ? "PASSWORD_RESET_BY_ADMIN" : "PASSWORD_RESET",
      entityType: "User",
      entityId: user._id,
      details: { targetUsername: user.username, method: isSelf ? "self-reset" : "admin-reset" },
    });

    return res.status(200).json({
      success: true,
      message: `Password for ${user.username} has been reset successfully.`,
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Refresh Access Token Controller
 * - Validates refresh token (valid for 30 days)
 * - Returns a new 15-minute access token
 * - After 30 days, refresh token expires and user must re-authenticate
 */
export const refreshTokenHandler = async (req, res) => {
  try {
    const rawRefreshToken =
      req.body.refreshToken ||
      req.cookies?.refreshToken ||
      req.headers["x-refresh-token"];

    if (!rawRefreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required.",
      });
    }

    const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET || (secret + "_refresh_secret_2026");

    let decoded;
    try {
      decoded = jwt.verify(rawRefreshToken, refreshSecret);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Refresh token has expired (30 days limit). Please log in again.",
          code: "REFRESH_TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token. Please log in again.",
      });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive || user.isLocked) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive, locked, or not found.",
      });
    }

    if (user.refreshToken !== rawRefreshToken) {
      return res.status(403).json({
        success: false,
        message: "Refresh token has been revoked or replaced. Please log in again.",
      });
    }

    const tokenPayload = {
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      zone: user.zone,
      cluster: user.cluster,
      centres: user.centres,
      loginAccess: true,
    };

    // Issue new 15-minute access token
    const newAccessToken = jwt.sign(tokenPayload, secret, { expiresIn: "15m" });
    authCache.set(user._id.toString(), tokenPayload);

    return res.status(200).json({
      success: true,
      message: "Access token refreshed successfully.",
      accessToken: newAccessToken,
      token: newAccessToken,
      expiresIn: "15m",
      refreshToken: user.refreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while refreshing token.",
    });
  }
};

/**
 * User Logout Controller
 * - Revokes stored refresh token in DB and clears cookie
 */
export const logoutUser = async (req, res) => {
  try {
    const rawRefreshToken =
      req.body.refreshToken ||
      req.cookies?.refreshToken ||
      req.headers["x-refresh-token"];

    if (rawRefreshToken) {
      const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
      const refreshSecret = process.env.REFRESH_TOKEN_SECRET || (secret + "_refresh_secret_2026");
      try {
        const decoded = jwt.verify(rawRefreshToken, refreshSecret);
        await User.findByIdAndUpdate(decoded.id, {
          refreshToken: null,
          refreshTokenExpiresAt: null,
        });
        authCache.del(decoded.id);
      } catch (e) {
        // Continue clearing cookie even if token decode fails
      }
    }

    res.clearCookie("refreshToken");
    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Pre-K User Provisioning (Central Admin Only)
 * Pure BRD v1.1 Scalable Architecture:
 * - 5 Roles: AOM, BM, RSO, National Head, Central
 * - Explicit field validation with exact missing field feedback
 * - Role-scoped hierarchy validation (Zone for RSO/BM/AOM, Cluster for BM, Centres for AOM)
 * - Strict 1-AOM-per-centre allocation conflict check (FR-1.3)
 */
export const createUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can create user accounts (FR-1.4).",
      });
    }

    const {
      name,
      username,
      email,
      phone,
      mobileNo,
      password,
      role,
      zone,
      cluster,
      centres,
    } = req.body;

    // 1. Explicit Missing Field Validation
    const missingFields = [];
    if (!name || typeof name !== "string" || !name.trim()) missingFields.push("name");
    if (!username || typeof username !== "string" || !username.trim()) missingFields.push("username");
    if (!email || typeof email !== "string" || !email.trim()) missingFields.push("email");
    const contactNumber = phone !== undefined && phone !== null ? phone : mobileNo;
    if (contactNumber === undefined || contactNumber === null || !String(contactNumber).trim()) {
      missingFields.push("phone");
    }
    if (!password || typeof password !== "string" || !password.trim()) missingFields.push("password");
    if (!role || typeof role !== "string" || !role.trim()) missingFields.push("role");

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field${missingFields.length > 1 ? "s" : ""}: ${missingFields.join(", ")}.`,
        missingFields,
      });
    }

    // 2. Canonical Pre-K Role Normalization & Validation
    const normalizedRole = normalizePrekRole(role);
    if (!normalizedRole) {
      return res.status(400).json({
        success: false,
        message: `Invalid role: '${role}'. Allowed Pre-K roles are: AOM, BM, RSO, National Head, Central.`,
      });
    }

    // 3. BRD v1.1 Hierarchy Scoping Validations
    const cleanZone = zone && typeof zone === "string" ? zone.trim() : "";
    const cleanCluster = cluster && typeof cluster === "string" ? cluster.trim() : "";
    const assignedCentres = Array.isArray(centres)
      ? centres.map((c) => String(c).trim()).filter(Boolean)
      : centres && typeof centres === "string" && centres.trim()
      ? [centres.trim()]
      : [];

    if (normalizedRole === PREK_ROLES.AOM) {
      if (!cleanZone) {
        return res.status(400).json({
          success: false,
          message: "Zone is required for AOM role (e.g. West, North, South, East, Central).",
        });
      }
      if (assignedCentres.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Centres are required for AOM role (must assign at least 1 pre-K centre).",
        });
      }

      // 1-AOM-per-centre mutual exclusivity rule (FR-1.3)
      const conflictingUsers = await User.find({
        role: PREK_ROLES.AOM,
        isActive: true,
        isDeleted: { $ne: true },
        centres: { $in: assignedCentres },
      }).select("name username centres");

      if (conflictingUsers.length > 0) {
        const conflicts = [];
        conflictingUsers.forEach((u) => {
          const overlap = u.centres.filter((c) => assignedCentres.includes(c));
          conflicts.push(`${u.name} (@${u.username}) already manages: ${overlap.join(", ")}`);
        });
        return res.status(400).json({
          success: false,
          message: `Centre allocation conflict: A single centre cannot have multiple AOMs. Conflicting assignments: ${conflicts.join("; ")}`,
          conflicts,
        });
      }
    } else if (normalizedRole === PREK_ROLES.BM) {
      if (!cleanZone) {
        return res.status(400).json({
          success: false,
          message: "Zone is required for BM role (e.g. West, North, South, East, Central).",
        });
      }
      if (!cleanCluster) {
        return res.status(400).json({
          success: false,
          message: "Cluster is required for BM role (e.g. Mumbai Cluster, Pune Cluster, Delhi Cluster).",
        });
      }

      // 1-BM-per-cluster exclusivity rule: Ensure only one active BM manages each cluster
      const conflictingBM = await User.findOne({
        role: PREK_ROLES.BM,
        cluster: { $regex: `^${cleanCluster}$`, $options: "i" },
        isActive: true,
        isDeleted: { $ne: true },
      }).select("name username cluster");

      if (conflictingBM) {
        return res.status(400).json({
          success: false,
          message: `Cluster allocation conflict: A single cluster cannot have multiple Business Managers. Cluster '${cleanCluster}' is already managed by ${conflictingBM.name} (@${conflictingBM.username}).`,
          conflictingBM: {
            id: conflictingBM._id,
            name: conflictingBM.name,
            username: conflictingBM.username,
            cluster: conflictingBM.cluster,
          },
        });
      }
    } else if (normalizedRole === PREK_ROLES.RSO) {
      if (!cleanZone) {
        return res.status(400).json({
          success: false,
          message: "Zone is required for RSO role (e.g. West, North, South, East, Central).",
        });
      }
    }

    // 4. Duplicate Username and Email Checks with Specific Error Feedback (active accounts)
    const cleanUsername = username.toLowerCase().trim();
    const cleanEmail = email.toLowerCase().trim();

    const existingUsername = await User.findOne({ username: cleanUsername, isDeleted: { $ne: true } });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: `Username '@${cleanUsername}' is already taken. Please choose a different username.`,
      });
    }

    const existingEmail = await User.findOne({ email: cleanEmail, isDeleted: { $ne: true } });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: `Email '${cleanEmail}' is already registered. Please use a different email address.`,
      });
    }

    // Check if previously soft-deleted user exists with this username or email -> prompt restore
    const deletedUser = await User.findOne({
      $or: [
        { originalUsername: cleanUsername },
        { originalEmail: cleanEmail },
        { username: cleanUsername },
        { email: cleanEmail },
      ],
      isDeleted: true,
    });

    if (deletedUser) {
      const origUser = deletedUser.originalUsername || cleanUsername;
      return res.status(409).json({
        success: false,
        canRestore: true,
        conflictType: "ALREADY_EXISTS_DELETED",
        message: `User '@${origUser}' (${deletedUser.role}) already exists in the system but was previously deleted (in trash). You can restore this account using PUT /api/users/${deletedUser._id}/restore instead of creating a duplicate.`,
        existingId: deletedUser._id,
        deletedUser: {
          id: deletedUser._id,
          name: deletedUser.name,
          username: origUser,
          email: deletedUser.originalEmail || cleanEmail,
          role: deletedUser.role,
          deletedAt: deletedUser.deletedAt,
        },
      });
    }

    // 5. Create New User Document
    const newUser = new User({
      name: name.trim(),
      username: cleanUsername,
      email: cleanEmail,
      phone: String(contactNumber).trim(),
      password: encrypt(password.trim()),
      role: normalizedRole,
      zone: cleanZone || undefined,
      cluster: cleanCluster || undefined,
      centres: assignedCentres,
      isActive: true,
    });

    await newUser.save();

    await recordAuditLog({
      req,
      action: "USER_CREATED",
      entityType: "User",
      entityId: newUser._id,
      details: {
        createdUsername: newUser.username,
        createdRole: newUser.role,
        zone: newUser.zone,
        cluster: newUser.cluster,
      },
    });

    return res.status(201).json({
      success: true,
      message: `User ${newUser.username} (${newUser.role}) provisioned successfully.`,
      data: {
        id: newUser._id,
        name: newUser.name,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone || "",
        role: newUser.role,
        zone: newUser.zone || "",
        cluster: newUser.cluster || "",
        centres: newUser.centres || [],
        isActive: newUser.isActive,
        password: password.trim(),
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: List Provisioned Users
 * - Central & National Head: All users across all zones (with decrypted passwords)
 * - RSO: Staff strictly within their own assigned zone (co-RSOs in the same zone, BMs, AOMs; NEVER other zones)
 * - BM: AOMs strictly within their assigned cluster & zone
 */
export const getUsers = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    const isCentralOrNational =
      requesterRole === PREK_ROLES.CENTRAL ||
      requesterRole === PREK_ROLES.NATIONAL_HEAD ||
      req.user?.role === "superAdmin";
    const isRSO = requesterRole === PREK_ROLES.RSO;
    const isBM = requesterRole === PREK_ROLES.BM;

    if (!isCentralOrNational && !isRSO && !isBM) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only Central, National Head, RSO, and Business Managers can list staff.",
      });
    }

    const { role, zone, cluster: queryCluster, search, includeDeleted } = req.query;
    const allowDeleted = isCentralOrNational && (includeDeleted === "true" || includeDeleted === true);
    const andConditions = allowDeleted ? [] : [{ isDeleted: { $ne: true } }];

    const reqZone = req.user?.zone ? String(req.user.zone).trim() : "";
    const reqCluster = req.user?.cluster ? String(req.user.cluster).trim() : "";

    if (isRSO) {
      if (!reqZone) {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }
      // Strictly lock RSO to their own zone (peer RSOs in same zone + BMs + AOMs in same zone)
      andConditions.push({ zone: { $regex: `^${escapeRegex(reqZone)}$`, $options: "i" } });
      andConditions.push({ role: { $in: [PREK_ROLES.RSO, PREK_ROLES.BM, PREK_ROLES.AOM] } });

      if (role) {
        const requestedRole = normalizePrekRole(role) || role;
        andConditions.push({ role: requestedRole });
      }
      if (queryCluster) {
        andConditions.push({ cluster: { $regex: `^${escapeRegex(String(queryCluster).trim())}$`, $options: "i" } });
      }
      // If RSO tries to query a different zone, intersect so it returns 0 records (never leaks another zone)
      if (zone && String(zone).trim().toLowerCase() !== "all") {
        andConditions.push({ zone: { $regex: `^${escapeRegex(String(zone).trim())}$`, $options: "i" } });
      }
    } else if (isBM) {
      // Business Manager is strictly scoped to view AOMs under their assigned cluster (never peer clusters)
      andConditions.push({ role: PREK_ROLES.AOM });
      if (!reqCluster) {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }

      const clusterCentres = await Centre.find({
        cluster: { $regex: `^${escapeRegex(reqCluster)}$`, $options: "i" },
        isDeleted: false,
      })
        .select("name")
        .lean();
      const clusterCentreNames = clusterCentres.map((c) => c.name);

      const bmMatchConditions = [
        { cluster: { $regex: `^${escapeRegex(reqCluster)}$`, $options: "i" } },
      ];
      if (clusterCentreNames.length > 0) {
        bmMatchConditions.push({ centres: { $in: clusterCentreNames } });
      }
      andConditions.push({ $or: bmMatchConditions });

      if (reqZone) {
        andConditions.push({ zone: { $regex: `^${escapeRegex(reqZone)}$`, $options: "i" } });
      }
      if (zone && String(zone).trim().toLowerCase() !== "all") {
        andConditions.push({ zone: { $regex: `^${escapeRegex(String(zone).trim())}$`, $options: "i" } });
      }
    } else {
      // Central & National Head
      if (role) andConditions.push({ role: normalizePrekRole(role) || role });
      if (queryCluster) {
        andConditions.push({ cluster: { $regex: `^${escapeRegex(String(queryCluster).trim())}$`, $options: "i" } });
      }
      if (zone && String(zone).trim().toLowerCase() !== "all") {
        andConditions.push({ zone: { $regex: `^${escapeRegex(String(zone).trim())}$`, $options: "i" } });
      }
    }

    if (search && String(search).trim()) {
      const s = escapeRegex(String(search).trim());
      andConditions.push({
        $or: [
          { name: { $regex: s, $options: "i" } },
          { username: { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { cluster: { $regex: s, $options: "i" } },
        ],
      });
    }

    const filter =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
        ? andConditions[0]
        : { $and: andConditions };

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // Include plain-text decrypted password for administrative user review (Central/National only)
    const usersFormatted = users.map((u) => {
      const copy = { ...u };
      if (isCentralOrNational) {
        copy.password = u.password ? decrypt(u.password) : "";
      } else {
        delete copy.password;
      }
      return copy;
    });

    return res.status(200).json({
      success: true,
      total: usersFormatted.length,
      data: usersFormatted,
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Update User Details & Assignment (Name, Username, Email, Phone, Password, Role, Zone, Cluster, Centres, Status)
 */
export const updateUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can update user assignments (FR-1.4).",
      });
    }

    const { id } = req.params;
    const {
      name,
      username,
      email,
      phone,
      mobileNo,
      password,
      newPassword,
      role,
      zone,
      cluster,
      centres,
      isActive,
      isLocked,
    } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const targetRole = role ? normalizePrekRole(role) : user.role;
    if (role && !targetRole) {
      return res.status(400).json({
        success: false,
        message: `Invalid role: '${role}'. Allowed Pre-K roles are: AOM, BM, RSO, National Head, Central.`,
      });
    }

    const targetCentres = centres !== undefined
      ? (Array.isArray(centres) ? centres.map((c) => String(c).trim()).filter(Boolean) : [String(centres).trim()])
      : user.centres;

    // BRD Section 5 & FR-1.3: 1-AOM-per-centre allocation rule
    // Prevent assigning the same centre to multiple AOMs to guarantee strict peer isolation
    if (targetRole === PREK_ROLES.AOM && Array.isArray(targetCentres) && targetCentres.length > 0) {
      const conflictingUsers = await User.find({
        role: PREK_ROLES.AOM,
        _id: { $ne: user._id },
        isActive: true,
        isDeleted: { $ne: true },
        centres: { $in: targetCentres },
      }).select("name username centres");

      if (conflictingUsers.length > 0) {
        const conflicts = [];
        conflictingUsers.forEach((u) => {
          const overlap = u.centres.filter((c) => targetCentres.includes(c));
          conflicts.push(`${u.name} (@${u.username}) already manages: ${overlap.join(", ")}`);
        });
        return res.status(400).json({
          success: false,
          message: `Centre allocation conflict: A single centre cannot have multiple AOMs. Conflicting assignments: ${conflicts.join("; ")}`,
          conflicts,
        });
      }
    }

    // 1-BM-per-cluster exclusivity rule: Ensure only one active BM manages each cluster
    if (targetRole === PREK_ROLES.BM && cluster !== undefined && String(cluster).trim()) {
      const cleanClusterTarget = String(cluster).trim();
      const conflictingBM = await User.findOne({
        role: PREK_ROLES.BM,
        _id: { $ne: user._id },
        cluster: { $regex: `^${cleanClusterTarget}$`, $options: "i" },
        isActive: true,
        isDeleted: { $ne: true },
      }).select("name username cluster");

      if (conflictingBM) {
        return res.status(400).json({
          success: false,
          message: `Cluster allocation conflict: A single cluster cannot have multiple Business Managers. Cluster '${cleanClusterTarget}' is already managed by ${conflictingBM.name} (@${conflictingBM.username}).`,
        });
      }
    }

    if (name && typeof name === "string" && name.trim()) {
      user.name = name.trim();
    }

    // Username update handling: allow keeping own username, block duplicates belonging to other users in DB
    if (username && typeof username === "string" && username.trim()) {
      const usernameLower = username.toLowerCase().trim();
      if (usernameLower !== (user.username || "").toLowerCase()) {
        const existingActiveUsername = await User.findOne({
          username: usernameLower,
          _id: { $ne: user._id },
          isDeleted: { $ne: true },
        });
        if (existingActiveUsername) {
          return res.status(400).json({
            success: false,
            message: `Duplicate username: '@${usernameLower}' already exists for another user.`,
          });
        }

        const existingDeletedUsername = await User.findOne({
          $or: [{ username: usernameLower }, { originalUsername: usernameLower }],
          _id: { $ne: user._id },
          isDeleted: true,
        });
        if (existingDeletedUsername) {
          return res.status(409).json({
            success: false,
            canRestore: true,
            conflictType: "ALREADY_EXISTS_DELETED",
            message: `Duplicate username: '@${usernameLower}' already exists in a soft-deleted account. Please choose a different username or restore that account.`,
            existingId: existingDeletedUsername._id,
          });
        }

        user.username = usernameLower;
      }
    }

    // Email update handling: allow keeping own email, block duplicates belonging to other users in DB
    if (email && typeof email === "string" && email.trim()) {
      const emailLower = email.toLowerCase().trim();
      if (emailLower !== (user.email || "").toLowerCase()) {
        const existingActiveEmail = await User.findOne({
          email: emailLower,
          _id: { $ne: user._id },
          isDeleted: { $ne: true },
        });
        if (existingActiveEmail) {
          return res.status(400).json({
            success: false,
            message: `Duplicate email: '${emailLower}' is already registered by another user.`,
          });
        }

        const existingDeletedEmail = await User.findOne({
          $or: [{ email: emailLower }, { originalEmail: emailLower }],
          _id: { $ne: user._id },
          isDeleted: true,
        });
        if (existingDeletedEmail) {
          return res.status(409).json({
            success: false,
            canRestore: true,
            conflictType: "ALREADY_EXISTS_DELETED",
            message: `Duplicate email: '${emailLower}' already exists in a soft-deleted account. Please use a different email or restore that account.`,
            existingId: existingDeletedEmail._id,
          });
        }

        user.email = emailLower;
      }
    }

    if (role) user.role = targetRole;
    if (zone !== undefined) user.zone = zone ? String(zone).trim() : "";
    if (cluster !== undefined) user.cluster = cluster ? String(cluster).trim() : "";
    if (centres !== undefined) user.centres = targetCentres;
    const contactNumber = phone !== undefined && phone !== null ? phone : mobileNo;
    if (contactNumber !== undefined && contactNumber !== null) {
      user.phone = String(contactNumber).trim();
    }
    if (typeof isActive === "boolean") user.isActive = isActive;
    if (typeof isLocked === "boolean") {
      user.isLocked = isLocked;
      if (!isLocked) {
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
      }
    }

    // Password update handling (accepts password or newPassword)
    const updatedPassword = password || newPassword;
    let passwordUpdated = false;
    if (updatedPassword && typeof updatedPassword === "string" && updatedPassword.trim()) {
      user.password = encrypt(updatedPassword.trim());
      user.isLocked = false;
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      passwordUpdated = true;
    }

    await user.save();

    if (authCache && authCache.del) {
      authCache.del(user._id.toString());
    }

    await recordAuditLog({
      req,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: user._id,
      details: {
        updatedUsername: user.username,
        role: user.role,
        zone: user.zone,
        isActive: user.isActive,
        passwordUpdated,
      },
    });

    return res.status(200).json({
      success: true,
      message: `User ${user.username} updated successfully.${passwordUpdated ? " Password updated." : ""}`,
      data: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        zone: user.zone,
        cluster: user.cluster,
        centres: user.centres,
        isActive: user.isActive,
        isLocked: user.isLocked,
        password: user.password ? decrypt(user.password) : "",
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.6: Administrator Unlock Account
 */
export const unlockUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central administrators can unlock accounts.",
      });
    }

    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await recordAuditLog({
      req,
      action: "ACCOUNT_UNLOCKED_BY_ADMIN",
      entityType: "User",
      entityId: user._id,
      details: { unlockedUsername: user.username },
    });

    return res.status(200).json({
      success: true,
      message: `Account for ${user.username} has been unlocked successfully.`,
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Password Reset by User ID (Self-Reset with old/new password OR Central Admin Override)
 * `username` is NOT required.
 * Accepts `oldPassword` (or `oldPass`) and `newPassword` (or `newPass`).
 */
export const adminResetPassword = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    const { id } = req.params;
    const oldPassword = req.body.oldPassword || req.body.oldPass || req.body.currentPassword;
    const newPassword = req.body.newPassword || req.body.newPass || req.body.password;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "newPassword (or newPass) is required.",
        missingFields: ["newPassword"],
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isSelf = req.user?.id && req.user.id.toString() === user._id.toString();
    const isCentralAdmin = requesterRole === PREK_ROLES.CENTRAL || req.user?.role === "superAdmin";

    if (!isSelf && !isCentralAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only reset your own password. Central administrator privileges required to reset other users' passwords.",
      });
    }

    // When resetting own password, oldPassword verification is mandatory
    if (isSelf || (!isCentralAdmin && oldPassword)) {
      if (!oldPassword) {
        return res.status(400).json({
          success: false,
          message: "oldPassword (or oldPass) is required.",
          missingFields: ["oldPassword"],
        });
      }

      const isMatch = comparePassword(String(oldPassword).trim(), user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Incorrect old password. Please enter your valid current password.",
        });
      }

      if (String(oldPassword).trim() === String(newPassword).trim()) {
        return res.status(400).json({
          success: false,
          message: "New password cannot be the same as the old password.",
        });
      }
    }

    user.password = encrypt(String(newPassword).trim());
    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    if (authCache && authCache.del) {
      authCache.del(user._id.toString());
    }

    await recordAuditLog({
      req,
      action: isCentralAdmin && !isSelf ? "PASSWORD_RESET_BY_ADMIN" : "PASSWORD_RESET",
      entityType: "User",
      entityId: user._id,
      details: { targetUsername: user.username, method: isSelf ? "self-reset" : "admin-reset" },
    });

    return res.status(200).json({
      success: true,
      message: `Password for ${user.username} has been reset successfully.`,
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Activate / Deactivate Account
 */
export const toggleUserActivation = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can activate or deactivate accounts.",
      });
    }

    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "active boolean (true/false) is required.",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.isActive = active;
    await user.save();

    await recordAuditLog({
      req,
      action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: user._id,
      details: { username: user.username, active },
    });

    return res.status(200).json({
      success: true,
      message: `Account for ${user.username} ${active ? "activated" : "deactivated"} successfully.`,
      data: user,
    });
  } catch (err) {
    if (err.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate ${dupField}: this ${dupField} already exists in the database.`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4 / Lifecycle: Soft Delete User Account
 * - Releases assigned centres so new/replacement staff can take over.
 * - Suffixes credentials to allow clean recreation without unique index collisions.
 * - Stores previousCentres and original credentials for potential restoration.
 */
export const softDeleteUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can delete user accounts.",
      });
    }

    const { id } = req.params;
    const user = await User.findOne({
      _id: id,
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found or already deleted." });
    }

    // Security: Prevent self-deletion
    if (req.user?.id && String(user._id) === String(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: "Security restriction: You cannot delete your own administrator account.",
      });
    }

    const originalUsername = user.username;
    const originalEmail = user.email;
    const previousCentres = [...(user.centres || [])];

    user.originalUsername = originalUsername;
    user.originalEmail = originalEmail;
    user.previousCentres = previousCentres;

    // Release centres immediately so another AOM can be assigned to these schools
    user.centres = [];
    user.isDeleted = true;
    user.isActive = false;
    user.deletedAt = new Date();
    user.deletedBy = req.user?.id || req.user?._id;

    // Prefix username and email with deleted timestamp so new staff can use original username
    user.username = `deleted_${Date.now()}_${originalUsername}`;
    user.email = `deleted_${Date.now()}_${originalEmail}`;

    await user.save();

    await recordAuditLog({
      req,
      action: "USER_SOFT_DELETED",
      entityType: "User",
      entityId: user._id,
      details: {
        originalUsername,
        originalEmail,
        role: user.role,
        zone: user.zone,
        releasedCentres: previousCentres,
      },
    });

    return res.status(200).json({
      success: true,
      message: `User '${originalUsername}' has been soft deleted successfully. Assigned centres have been released and can now be reassigned.`,
      data: {
        id: user._id,
        username: originalUsername,
        email: originalEmail,
        role: user.role,
        deletedAt: user.deletedAt,
        previousCentres,
      },
    });
  } catch (err) {
    console.error("SOFT DELETE USER ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4 / Lifecycle: List Soft-Deleted / Trashed Users
 * Central & National Head can review deleted accounts and their released assignments.
 */
export const getDeletedUsers = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (
      requesterRole !== PREK_ROLES.CENTRAL &&
      requesterRole !== PREK_ROLES.NATIONAL_HEAD &&
      req.user?.role !== "superAdmin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only Central and National Head administrators can view deleted user accounts.",
      });
    }

    const { role, zone, search } = req.query;
    const filter = { isDeleted: true };

    if (role) filter.role = normalizePrekRole(role) || role;
    if (zone) filter.zone = { $regex: `^${zone}$`, $options: "i" };

    if (search && String(search).trim()) {
      const s = String(search).trim();
      filter.$or = [
        { name: { $regex: s, $options: "i" } },
        { originalUsername: { $regex: s, $options: "i" } },
        { originalEmail: { $regex: s, $options: "i" } },
        { username: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
      ];
    }

    const deletedUsers = await User.find(filter)
      .populate("deletedBy", "name username email")
      .sort({ deletedAt: -1 })
      .lean();

    const formatted = deletedUsers.map((u) => ({
      id: u._id,
      name: u.name,
      username: u.originalUsername || u.username.replace(/^deleted_\d+_/, ""),
      email: u.originalEmail || u.email.replace(/^deleted_\d+_/, ""),
      phone: u.phone || "",
      role: u.role,
      zone: u.zone || "",
      cluster: u.cluster || "",
      previousCentres: u.previousCentres || [],
      deletedAt: u.deletedAt,
      deletedBy: u.deletedBy || null,
      isDeleted: true,
    }));

    return res.status(200).json({
      success: true,
      total: formatted.length,
      data: formatted,
    });
  } catch (err) {
    console.error("GET DELETED USERS ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4 / Lifecycle: Restore Soft-Deleted User Account
 * Checks:
 * 1. Has an active user already been created with this username or email? If yes, returns clear conflict error.
 * 2. If user is AOM, are any of their previous centres currently assigned to another active AOM? If yes, warns with conflict details.
 */
export const restoreUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can restore deleted user accounts.",
      });
    }

    const { id } = req.params;
    const user = await User.findOne({ _id: id, isDeleted: true });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Deleted user not found with ID: " + id,
      });
    }

    const targetUsername = (user.originalUsername || user.username.replace(/^deleted_\d+_/, "")).toLowerCase().trim();
    const targetEmail = (user.originalEmail || user.email.replace(/^deleted_\d+_/, "")).toLowerCase().trim();

    // 1. Conflict Check: Check if an active user was created with this username or email while this user was deleted
    const activeUsernameConflict = await User.findOne({
      username: targetUsername,
      isDeleted: { $ne: true },
    }).select("name username email role");

    if (activeUsernameConflict) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: An active user with username '@${targetUsername}' already exists (${activeUsernameConflict.name}, role: ${activeUsernameConflict.role}). To restore this user, either rename or delete the existing active user first.`,
        conflictType: "USERNAME_EXISTS",
        conflictingUser: {
          id: activeUsernameConflict._id,
          name: activeUsernameConflict.name,
          username: activeUsernameConflict.username,
          role: activeUsernameConflict.role,
        },
      });
    }

    const activeEmailConflict = await User.findOne({
      email: targetEmail,
      isDeleted: { $ne: true },
    }).select("name username email role");

    if (activeEmailConflict) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: An active user with email '${targetEmail}' already exists (${activeEmailConflict.name}, role: ${activeEmailConflict.role}). To restore this user, please update or remove the active user first.`,
        conflictType: "EMAIL_EXISTS",
        conflictingUser: {
          id: activeEmailConflict._id,
          name: activeEmailConflict.name,
          email: activeEmailConflict.email,
          role: activeEmailConflict.role,
        },
      });
    }

    // 2. Conflict Check: If AOM, check centre exclusivity against other active AOMs
    const targetCentres = req.body.centres !== undefined
      ? (Array.isArray(req.body.centres) ? req.body.centres.map((c) => String(c).trim()).filter(Boolean) : [String(req.body.centres).trim()])
      : (user.previousCentres || []);

    if (user.role === PREK_ROLES.AOM && targetCentres.length > 0) {
      const conflictingAOMs = await User.find({
        role: PREK_ROLES.AOM,
        _id: { $ne: user._id },
        isActive: true,
        isDeleted: { $ne: true },
        centres: { $in: targetCentres },
      }).select("name username centres");

      if (conflictingAOMs.length > 0) {
        const conflicts = [];
        conflictingAOMs.forEach((u) => {
          const overlap = u.centres.filter((c) => targetCentres.includes(c));
          conflicts.push(`${u.name} (@${u.username}) currently manages: ${overlap.join(", ")}`);
        });
        return res.status(409).json({
          success: false,
          message: `Cannot restore AOM with original centres: Centre allocation conflict. Conflicting assignments: ${conflicts.join("; ")}. Please provide new unassigned centres or reassign existing active AOMs first.`,
          conflictType: "CENTRE_ALLOCATION_CONFLICT",
          conflicts,
        });
      }
    }

    // 3. Conflict Check: If BM, check cluster exclusivity against other active BMs
    const targetCluster = req.body.cluster !== undefined
      ? String(req.body.cluster).trim()
      : user.cluster;

    if (user.role === PREK_ROLES.BM && targetCluster) {
      const conflictingBM = await User.findOne({
        role: PREK_ROLES.BM,
        _id: { $ne: user._id },
        cluster: { $regex: `^${targetCluster}$`, $options: "i" },
        isActive: true,
        isDeleted: { $ne: true },
      }).select("name username cluster");

      if (conflictingBM) {
        return res.status(409).json({
          success: false,
          message: `Cannot restore BM with original cluster '${targetCluster}': Cluster is already managed by active BM ${conflictingBM.name} (@${conflictingBM.username}). Please reassign or update cluster allocation first.`,
          conflictType: "CLUSTER_ALLOCATION_CONFLICT",
          conflictingBM: {
            id: conflictingBM._id,
            name: conflictingBM.name,
            username: conflictingBM.username,
            cluster: conflictingBM.cluster,
          },
        });
      }
    }

    // 4. Restore User Account
    user.username = targetUsername;
    user.email = targetEmail;
    user.isDeleted = false;
    user.isActive = true;
    user.deletedAt = null;
    user.deletedBy = null;
    user.centres = targetCentres;
    user.previousCentres = [];
    user.failedLoginAttempts = 0;
    user.isLocked = false;

    await user.save();

    await recordAuditLog({
      req,
      action: "USER_RESTORED",
      entityType: "User",
      entityId: user._id,
      details: {
        restoredUsername: user.username,
        restoredEmail: user.email,
        role: user.role,
        zone: user.zone,
        centres: user.centres,
      },
    });

    return res.status(200).json({
      success: true,
      message: `User '@${user.username}' (${user.role}) has been restored successfully.`,
      data: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        zone: user.zone || "",
        cluster: user.cluster || "",
        centres: user.centres,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    console.error("RESTORE USER ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
