import Superadmin from "../Models/superAdmin.js";
import School from "../Models/school.js";
import BranchGroup from "../Models/branchGroup.js";
import Branch from "../Models/branch.js";
import Parents from "../Models/parents.js";
import Supervisor from "../Models/supervisor.js";
import Driver from "../Models/driver.js";
import PrekUser from "../Models/prekUser.js";
import jwt from "jsonwebtoken";
import { comparePassword, encrypt } from "../Utils/crypto.js";
import admin from "../config/firebaseadmin.js";
import authCache from "../Utils/authCache.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
import recordAuditLog from "../Utils/auditLogger.js";

// Add SuperAdmin
export const addAdmin = async (req, res) => {
  try {
    let { username, email, password } = req.body;

    username = username.trim();
    email = email.trim();
    password = password.trim();

    const newUser = new Superadmin({
      username,
      email,
      password: encrypt(password),
    });

    const savedUser = await newUser.save();
    res
      .status(201)
      .json({ message: "User created successfully", user: savedUser });
  } catch (error) {
    console.error("Error adding user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

/**
 * FR-1.1, FR-1.2, FR-1.5, FR-1.6: Unified User Login
 * Supports Pre-K 5-tier role hierarchy: AOM, BM, RSO, National Head, Central
 * Supports account lockout after 5 failed attempts (FR-1.6)
 * Logs audit trail for all attempts (FR-1.5)
 */
export const loginUser = async (req, res) => {
  let { username, password } = req.body;
  username = username?.trim();
  password = password?.trim();

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Please enter valid details" });
  }

  try {
    // 1. Check Pre-K User Collection first (FR-1.1, FR-1.2)
    const prekUser = await PrekUser.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: username.toLowerCase() },
      ],
    });

    if (prekUser) {
      // FR-1.6: Account Lockout Check
      if (prekUser.isLocked) {
        if (prekUser.lockUntil && prekUser.lockUntil > new Date()) {
          const minutesLeft = Math.ceil((prekUser.lockUntil.getTime() - Date.now()) / (60 * 1000));
          return res.status(403).json({
            success: false,
            message: `Account is locked due to multiple failed login attempts. Please try again in ${minutesLeft} minutes or reset your password. (FR-1.6)`,
          });
        } else if (prekUser.lockUntil && prekUser.lockUntil <= new Date()) {
          // Lock period expired
          prekUser.isLocked = false;
          prekUser.failedLoginAttempts = 0;
          prekUser.lockUntil = null;
          await prekUser.save();
        } else {
          return res.status(403).json({
            success: false,
            message: "Account is locked. Please contact Central administrator or use password reset. (FR-1.6)",
          });
        }
      }

      if (!prekUser.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive. Please contact the administrator.",
        });
      }

      const isMatch = await comparePassword(password, prekUser.password);
      if (!isMatch) {
        prekUser.failedLoginAttempts = (prekUser.failedLoginAttempts || 0) + 1;
        const attemptsRemaining = Math.max(0, 5 - prekUser.failedLoginAttempts);

        if (prekUser.failedLoginAttempts >= 5) {
          prekUser.isLocked = true;
          prekUser.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 mins
          await prekUser.save();

          await recordAuditLog({
            req,
            userId: prekUser._id,
            username: prekUser.username,
            userRole: prekUser.role,
            action: "ACCOUNT_LOCKED",
            entityType: "User",
            entityId: prekUser._id,
            details: { reason: "5 consecutive failed login attempts" },
          });

          return res.status(403).json({
            success: false,
            message: "Account locked: 5 consecutive failed login attempts reached. Please reset password or contact administrator. (FR-1.6)",
          });
        }

        await prekUser.save();

        await recordAuditLog({
          req,
          username: prekUser.username,
          userRole: prekUser.role,
          action: "LOGIN_FAILED",
          entityType: "Auth",
          details: { attemptsRemaining },
        });

        return res.status(400).json({
          success: false,
          message: `Incorrect password. ${attemptsRemaining} attempts remaining before account lockout.`,
        });
      }

      // Successful login
      prekUser.failedLoginAttempts = 0;
      prekUser.isLocked = false;
      prekUser.lockUntil = null;
      prekUser.lastLoginAt = new Date();
      await prekUser.save();

      const tokenPayload = {
        id: prekUser._id,
        name: prekUser.name,
        username: prekUser.username,
        email: prekUser.email,
        role: prekUser.role,
        zone: prekUser.zone,
        cluster: prekUser.cluster,
        centres: prekUser.centres,
        loginAccess: true,
      };

      const secret = process.env.JWT_SECRET || "prek-default-secret-key-2026";
      const token = jwt.sign(tokenPayload, secret, { expiresIn: "7d" });
      authCache.set(prekUser._id.toString(), tokenPayload);

      await recordAuditLog({
        req,
        userId: prekUser._id,
        username: prekUser.username,
        userRole: prekUser.role,
        action: "LOGIN_SUCCESS",
        entityType: "Auth",
        details: { role: prekUser.role, zone: prekUser.zone },
      });

      return res.status(200).json({
        success: true,
        message: "Successful Login",
        token,
        role: prekUser.role,
        username: prekUser.username,
        name: prekUser.name,
        zone: prekUser.zone,
        cluster: prekUser.cluster,
        centres: prekUser.centres,
      });
    }

    // 2. Legacy fallback
    const [
      superAdmin,
      school,
      branch,
      branchGroup,
      parent,
      supervisor,
      driver,
    ] = await Promise.all([
      Superadmin.findOne({ username }).lean(),
      School.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo"),
      Branch.findOne({ username }).populate("schoolId", "username").lean().select("-fcmToken -lastNotifiedDate -notificationsEnabled -lastNotifiedDate -subscriptionExpirationDate -mobileNo -Notification"),
      BranchGroup.findOne({ username }).populate("AssignedBranch", "username").lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo"),
      Parents.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
      Supervisor.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
      Driver.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
    ]);

    const user = superAdmin || school || branch || branchGroup || parent || supervisor || driver;

    if (!user) {
      await recordAuditLog({
        req,
        username,
        action: "LOGIN_FAILED_UNKNOWN_USER",
        entityType: "Auth",
      });
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const isSuperAdmin = user?.role === "superAdmin";

    if (!isSuperAdmin && !user?.Active) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact the administrator.",
      });
    }

    // Pending approval check
    if (
      (supervisor && supervisor.username === username && supervisor.isApproved === false) ||
      (driver && driver.username === username && driver.isApproved === false)
    ) {
      return res.status(403).json({ success: false, message: "Your account is not approved yet." });
    }

    // Validate password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Incorrect password or username ID" });
    }

    const tokenPayload = {
      id: user._id,
      username: user.username,
      role: user.role,
      schoolId: user?.schoolId,
      AssignedBranch: Array.isArray(user?.AssignedBranch)
        ? user.AssignedBranch.map((b) => b._id || b)
        : [],
      loginAccess: user.Active ?? true,
    };

    if (user.role === "branch" && user.schoolId) {
      tokenPayload.schoolId = user.schoolId._id || user.schoolId;
    }

    if (["supervisor", "driver", "parent"].includes(user.role) && user.branchId) {
      tokenPayload.branchId = user.branchId._id || user.branchId;
    }

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
    });

    return res.status(200).json({
      success: true,
      message: "Successful Login",
      token,
      role: user.role,
      username: user.username,
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
        message: "Username/email and newPassword are required",
      });
    }

    const query = username
      ? { username: username.toLowerCase().trim() }
      : { email: email.toLowerCase().trim() };

    const user = await PrekUser.findOne(query);
    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found" });
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
 * FR-1.4: Administrator-Driven User Creation (Central Admin Only)
 */
export const createPrekUser = async (req, res) => {
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
        message: "name, username, email, password, and role are required fields",
      });
    }

    const normalizedRole = normalizePrekRole(role);
    if (!normalizedRole) {
      return res.status(400).json({
        success: false,
        message: `Invalid role: ${role}. Allowed roles: AOM, BM, RSO, National Head, Central.`,
      });
    }

    const existingUser = await PrekUser.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: email.toLowerCase().trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Username or email is already registered",
      });
    }

    const newUser = new PrekUser({
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
      message: `User ${newUser.username} (${newUser.role}) created successfully.`,
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
 * FR-1.4: Administrator-Driven User Management - List Users
 */
export const getPrekUsers = async (req, res) => {
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

    const users = await PrekUser.find(filter)
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
 * FR-1.4: Administrator-Driven Role / Zone Reassignment & Details Update
 */
export const updatePrekUser = async (req, res) => {
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

    const user = await PrekUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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
export const unlockPrekUser = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central administrators can unlock accounts.",
      });
    }

    const { id } = req.params;
    const user = await PrekUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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
        message: "newPassword is required",
      });
    }

    const user = await PrekUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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

export const storeFcmToken = async (req, res) => {
  const { fcmToken: newToken } = req.body;
  const { id, role } = req.user || {};

  if (!id || !role || !newToken) {
    return res.status(400).json({ message: "Missing id, role or token" });
  }

  let Model;
  if (role === "superAdmin") Model = Superadmin;
  else if (role === "school") Model = School;
  else if (role === "branch") Model = Branch;
  else if (role === "branchgroup") Model = BranchGroup;
  else if (role === "parent") Model = Parents;
  else Model = PrekUser;

  try {
    const user = await Model.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.fcmToken = Array.isArray(user.fcmToken) ? user.fcmToken : [];

    const validTokens = [];
    const removedTokens = [];

    await Promise.all(
      user.fcmToken.map(async (token) => {
        try {
          await admin.messaging().send({
            token,
            data: { ping: "1" },
            android: { priority: "high" },
            apns: {
              headers: {
                "apns-priority": "10",
                "apns-push-type": "background",
              },
              payload: { aps: { "content-available": 1 } },
            },
          });
          validTokens.push(token);
        } catch (err) {
          const code = err?.errorInfo?.code || err?.code;
          const message = err?.errorInfo?.message || err?.message;

          if (
            code === "messaging/registration-token-not-registered" ||
            message?.includes("not registered")
          ) {
            removedTokens.push(token);
          } else {
            validTokens.push(token);
          }
        }
      })
    );

    let newTokenValid = false;
    try {
      await admin.messaging().send({
        token: newToken,
        data: { ping: "1" },
        android: { priority: "high" },
        apns: {
          headers: {
            "apns-priority": "10",
            "apns-push-type": "background",
          },
          payload: { aps: { "content-available": 1 } },
        },
      });
      newTokenValid = true;
    } catch (err) {
      // Ignored
    }

    if (newTokenValid && !validTokens.includes(newToken)) {
      validTokens.push(newToken);
    }

    user.fcmToken = validTokens;
    await user.save();

    res.status(200).json({
      message: newTokenValid
        ? "Token stored. Invalid tokens removed if any."
        : "New token is invalid. Existing tokens cleaned.",
      totalTokensStored: validTokens.length,
      removedTokens,
      updated: true,
      newTokenStored: newTokenValid,
    });
  } catch (error) {
    console.error("Error storing FCM token:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const NotificationOnOff = async (req, res) => {
  try {
    const { id, role } = req.user || {};
    let Model;

    if (role === "superAdmin") Model = Superadmin;
    else if (role === "school") Model = School;
    else if (role === "branch") Model = Branch;
    else if (role === "branchgroup") Model = BranchGroup;
    else if (role === "parent") Model = Parents;
    else if (role === "supervisor") Model = Supervisor;
    else if (role === "driver") Model = Driver;
    else Model = PrekUser;

    const user = await Model.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.Notification = !user.Notification;
    await user.save();

    res.status(200).json({
      message: `Notification ${user.Notification ? "enabled" : "disabled"}`,
      notificationStatus: user.Notification,
    });
  } catch (error) {
    console.error("Error updating notification status:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const roleModelMap = {
  school: School,
  branch: Branch,
  branchGroup: BranchGroup,
  parent: Parents,
  supervisor: Supervisor,
  driver: Driver,
  prekUser: PrekUser,
};

export const toggleAccountActivation = async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;
  const { Active, userRole } = req.body;

  const requesterRole = normalizePrekRole(role);
  if (requesterRole !== PREK_ROLES.CENTRAL && role !== "superAdmin") {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to perform this action",
    });
  }

  if (typeof Active !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Active must be boolean (true / false)",
    });
  }

  try {
    // Check if PrekUser first
    const prekUser = await PrekUser.findById(id);
    if (prekUser) {
      prekUser.isActive = Active;
      await prekUser.save();
      return res.status(200).json({
        success: true,
        message: `User account ${Active ? "activated" : "deactivated"} successfully`,
        data: prekUser,
      });
    }

    const Model = roleModelMap[userRole];
    if (!Model) {
      return res.status(400).json({
        success: false,
        message: "Invalid role provided",
      });
    }

    const updatedUser = await Model.findByIdAndUpdate(id, { Active }, { new: true });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: `${userRole} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `${userRole} account ${Active ? "activated" : "deactivated"} successfully`,
      data: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
