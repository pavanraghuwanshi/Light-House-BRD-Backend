import User from "../Models/user.js";
import jwt from "jsonwebtoken";
import { comparePassword, encrypt } from "../Utils/crypto.js";
import authCache from "../Utils/authCache.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
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
    const token = jwt.sign(tokenPayload, secret, { expiresIn: "7d" });
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

    return res.status(200).json({
      success: true,
      message: "Successful Login",
      token,
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
 * FR-1.4: Self-Service Password Reset
 */
export const resetPassword = async (req, res) => {
  try {
    const { username, email, newPassword } = req.body;
    if ((!username && !email) || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Username or email and newPassword are required.",
      });
    }

    const query = username
      ? { username: username.toLowerCase().trim() }
      : { email: email.toLowerCase().trim() };

    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    user.password = encrypt(newPassword.trim());
    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await recordAuditLog({
      req,
      userId: user._id,
      username: user.username,
      userRole: user.role,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: user._id,
      details: { method: "self-service" },
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Central Administrator Account Creation
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

    const { name, username, email, password, role, zone, cluster, centres } = req.body;

    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, password, and role are required.",
      });
    }

    const normalizedRole = normalizePrekRole(role);
    if (!normalizedRole) {
      return res.status(400).json({
        success: false,
        message: `Invalid role: ${role}. Allowed roles: AOM, BM, RSO, National Head, Central.`,
      });
    }

    const existingUser = await User.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: email.toLowerCase().trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Username or email is already registered.",
      });
    }

    const newUser = new User({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: encrypt(password.trim()),
      role: normalizedRole,
      zone: zone ? zone.trim() : undefined,
      cluster: cluster ? cluster.trim() : undefined,
      centres: Array.isArray(centres) ? centres : centres ? [centres] : [],
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
        role: newUser.role,
        zone: newUser.zone,
        cluster: newUser.cluster,
        centres: newUser.centres,
        isActive: newUser.isActive,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: List Provisioned Users (Central & National Head)
 */
export const getUsers = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (
      requesterRole !== PREK_ROLES.CENTRAL &&
      requesterRole !== PREK_ROLES.NATIONAL_HEAD &&
      req.user?.role !== "superAdmin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only Central and National Head can list users.",
      });
    }

    const { role, zone, search } = req.query;
    const filter = {};

    if (role) filter.role = normalizePrekRole(role) || role;
    if (zone) filter.zone = { $regex: `^${zone}$`, $options: "i" };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { cluster: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      total: users.length,
      data: users,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Update User Assignment (Role, Zone, Cluster, Centres)
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
    const { name, role, zone, cluster, centres, isActive } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (name) user.name = name.trim();
    if (role) user.role = normalizePrekRole(role) || role;
    if (zone !== undefined) user.zone = zone ? zone.trim() : "";
    if (cluster !== undefined) user.cluster = cluster ? cluster.trim() : "";
    if (centres !== undefined) user.centres = Array.isArray(centres) ? centres : [centres];
    if (typeof isActive === "boolean") user.isActive = isActive;

    await user.save();

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
      },
    });

    return res.status(200).json({
      success: true,
      message: `User ${user.username} updated successfully.`,
      data: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        zone: user.zone,
        cluster: user.cluster,
        centres: user.centres,
        isActive: user.isActive,
      },
    });
  } catch (err) {
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
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.4: Administrator Password Reset
 */
export const adminResetPassword = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central administrators can reset user passwords.",
      });
    }

    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "newPassword is required.",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.password = encrypt(newPassword.trim());
    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await recordAuditLog({
      req,
      action: "PASSWORD_RESET_BY_ADMIN",
      entityType: "User",
      entityId: user._id,
      details: { targetUsername: user.username },
    });

    return res.status(200).json({
      success: true,
      message: `Password for ${user.username} has been reset successfully.`,
    });
  } catch (err) {
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
    return res.status(500).json({ success: false, message: err.message });
  }
};
