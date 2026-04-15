import Superadmin from "../Models/superAdmin.js";
import School from "../Models/school.js";
import BranchGroup from "../Models/branchGroup.js";
import Branch from "../Models/branch.js";
import Parents from "../Models/parents.js";
import Supervisor from "../Models/supervisor.js";
import Driver from "../Models/driver.js";
import jwt from "jsonwebtoken";
import { comparePassword, encrypt } from "../Utils/crypto.js";
import admin from "../config/firebaseadmin.js";
import authCache from "../Utils/authCache.js";

// Add user controller
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

export const loginUser = async (req, res) => {
  let { username, password } = req.body;
  username = username.trim();
  password = password.trim();

  if (!username || !password) {
    return res.status(400).json({ message: "Please enter valid details" });
  }

  try {
    // Find user across collections
    const [ superAdmin, school, branch, branchGroup, parent, supervisor, driver,
    ] = await Promise.all([
      Superadmin.findOne({ username }).lean(),
      School.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo"),
      Branch.findOne({ username }).populate("schoolId", "username").lean().select("-fcmToken -lastNotifiedDate -notificationsEnabled -lastNotifiedDate -subscriptionExpirationDate -mobileNo -Notification"),
      BranchGroup.findOne({ username }).populate("AssignedBranch", "username").lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo"),
      Parents.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
      Supervisor.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
      Driver.findOne({ username }).lean().select("-fcmToken -updatedAt -createdAt -Notification -mobileNo -email"),
    ]);

    const user = superAdmin ||school ||branch ||branchGroup ||parent ||supervisor ||driver;


    const isSuperAdmin = user?.role === "superAdmin";

    if (!user)
      return res.status(400).json({ success: false, message: "Invalid credentials" });

    if (!isSuperAdmin && !user?.Active)
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact the administrator.",
      });


    // Pending approval check
    if ((supervisor && supervisor.username === username && supervisor.isApproved === false) || (driver && driver.username === username && driver.isApproved === false) ) {
      return res
        .status(403)
        .json({ message: "Your account is not approved yet." });
    }

    // Validate password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Incorrect password or username ID" });
    }

    // ✅ Build JWT payload dynamically
    const tokenPayload = {
      id: user._id,
      username: user.username,
      role: user.role,
      schoolId: user?.schoolId,
      AssignedBranch: Array.isArray(user?.AssignedBranch)
    ? user.AssignedBranch.map(b => b._id || b)
    : [],
      loginAccess:user.Active
    };

    // Add schoolId if role = branch
    if (user.role === "branch" && user.schoolId) {
      tokenPayload.schoolId = user.schoolId._id || user.schoolId;
    }

    // Optional: include branchId for supervisors/drivers/parents
    if (
      ["supervisor", "driver", "parent"].includes(user.role) &&
      user.branchId
    ) {
      tokenPayload.branchId = user.branchId._id || user.branchId;
    }

    // Generate JWT token
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET);

    authCache.set(user._id.toString(), tokenPayload);

    res.status(200).json({
      message: "Successful Login",
      token,
      role: user.role,
      username: user.username
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: error.message });
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
  else return res.status(400).json({ message: "Invalid role" });

  try {
    const user = await Model.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.fcmToken = Array.isArray(user.fcmToken) ? user.fcmToken : [];

    const validTokens = [];
    const removedTokens = [];

    // Step 1: Validate all existing tokens
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

    // Step 2: Validate the new token before adding
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
      const code = err?.errorInfo?.code || err?.code;
      const message = err?.errorInfo?.message || err?.message;
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
    else return res.status(400).json({ message: "Invalid role" });

    const user = await Model.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 🔁 TOGGLE
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



// user account deactivate 

const roleModelMap = {
  "school": School,
  "branch": Branch,
  "branchGroup": BranchGroup,
  "parent": Parents,
  "supervisor": Supervisor,
  "driver": Driver,
};



export const toggleAccountActivation = async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;  
  const { Active ,userRole} = req.body; 



  if (role !== "superAdmin") {
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

  const Model = roleModelMap[userRole];


  if (!Model) {
    return res.status(400).json({
      success: false,
      message: "Invalid role provided",
    });
  }

  try {
    const updatedUser = await Model.findByIdAndUpdate(
      id,
      { Active },
      { new: true }
    );

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
