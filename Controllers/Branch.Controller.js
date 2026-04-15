import School from "../Models/school.js";
import findSameUsername from "../Utils/findSameUsername.js";
import { decrypt, encrypt, comparePassword } from "../Utils/crypto.js";
import Branch from "../Models/branch.js";
import mongoose from "mongoose";
import xlsx from "xlsx";

export const addBranch = async (req, res) => {
  const {
    branchName,
    username,
    password,
    email,
    address,
    mobileNo,
    schoolId,
    fullAccess,
    subscriptionExpirationDate,
    notificationsEnabled = {},
  } = req.body;

  const role = req.user.role;

  if (role !== "school" && role !== "superAdmin") {
    return res.status(403).json({ message: "You are not a valid user." });
  }

  try {
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const existingUserByUsername = await findSameUsername(username);
    if (existingUserByUsername.exists) {
      return res.status(400).json({ message: "This username already exists" });
    }

    const encryptedPassword = encrypt(password);

    const finalNotifications = {
      geofence: notificationsEnabled.geofence ?? true,
      eta: notificationsEnabled.eta ?? true,
      vehicleStatus: notificationsEnabled.vehicleStatus ?? true,
      overspeed: notificationsEnabled.overspeed ?? true,
      sos: notificationsEnabled.sos ?? true,
      busWiseTrip: notificationsEnabled.busWiseTrip ?? true,
    };

    // Create new branch
    const newBranch = new Branch({
      branchName,
      username,
      password: encryptedPassword,
      email,
      address,
      mobileNo,
      schoolId,
      fullAccess,
      subscriptionExpirationDate,
      notificationsEnabled: finalNotifications,
    });

    const savedBranch = await newBranch.save();

    const branchWithPassword = savedBranch.toObject();
    branchWithPassword.password = password;

    res.status(201).json({
      message: "Branch added successfully",
      branch: branchWithPassword,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getBranches = async (req, res) => {
  const { id, AssignedBranch } = req.user;
  const { role } = req.user;

  const ObjectId = mongoose.Types.ObjectId;
  let Branches;

  try {
    if (role === "superAdmin") {
      Branches = await Branch.find().select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v").populate("schoolId", "schoolName");
    } else if (role === "school") {
      Branches = await Branch.find({ schoolId: new ObjectId(id) }).select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v").populate(
        "schoolId",
        "schoolName"
      );
    } else if (role === "branchGroup") {
      Branches = await Branch.find({ _id: { $in: AssignedBranch } }).select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v").populate(
        "schoolId",
        "schoolName"
      );
    }
    if (!Branches) {
      return res.status(404).json({ message: "Branches not found" });
    }

    Branches.forEach((branch) => {
      const decryptedPassword = decrypt(branch.password);
      branch.password = decryptedPassword;
    });

    res.status(200).json(Branches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getBranchesDropdown = async (req, res) => {
  const { role, id, AssignedBranch } = req.user;
  const { schoolId } = req.query;

  try {
    let filter = {};
    if (role === "superAdmin") {
      if (!schoolId) {
        return res.status(400).json({
          success: false,
          message: "schoolId is required for superAdmin",
        });
      }
      filter.schoolId = new mongoose.Types.ObjectId(schoolId);
    } else if (role === "school") {
      filter.schoolId = new mongoose.Types.ObjectId(id);
    } else if (role === "branchGroup") {
      filter._id = { $in: AssignedBranch };
    } else if (role === "branch") {
      return res.status(403).json({
        success: false,
        message: "Branches cannot access this resource",
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const branches = await Branch.find(filter)
      .select("_id branchName")
      .sort({ branchName: 1 });

    res.status(200).json({
      data: branches,
    });
  } catch (err) {
    console.error("Branch Dropdown Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to load branches",
    });
  }
};

export const updateBranch = async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;
  const {
    branchName,
    username,
    password,
    email,
    address,
    schoolId,
    mobileNo,
    fullAccess,
    subscriptionExpirationDate,
    notificationsEnabled = {},
  } = req.body;

  if (role !== "school" && role !== "superAdmin") {
    return res.status(403).json({ message: "You are not a valid user." });
  }

  try {
    const branch = await Branch.findById(id);
    if (username && branch.username !== username) {
      if (username) {
        const existingUserByUsername = await findSameUsername(username);
        if (existingUserByUsername.exists) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }
    }

    const mergedNotifications = {
      ...branch.notificationsEnabled, // previous values
      ...notificationsEnabled, // new updates
    };

    const updateData = {
      branchName,
      username,
      email,
      ...(password ? { password: encrypt(password) } : {}),
      address,
      mobileNo,
      schoolId,
      fullAccess,
      subscriptionExpirationDate,
      notificationsEnabled: mergedNotifications,
    };

    const updatedBranch = await Branch.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedBranch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    res.status(200).json(updatedBranch);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteBranch = async (req, res) => {
  const { id } = req.params;
  const { role } = req.user;

  if (role !== "school" && role !== "superAdmin") {
    return res.status(403).json({ message: "You are not a valid user." });
  }

  try {
    const deletedBranch = await Branch.findByIdAndDelete(id);

    if (!deletedBranch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    res.status(200).json({ message: "Branch deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const addMultipleBranches = async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;


  // ✅ Allow only school role
  if (role !== "school" && role !== "superAdmin") {
    return res
      .status(403)
      .json({ message: "Only school role can add branches." });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Excel file is required" });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const branches = xlsx.utils.sheet_to_json(sheet);

    let inserted = 0;
    let skipped = [];

    for (const item of branches) {
      const { branchName, username, password, email, address, mobileNo } = item;

      // Basic validation
      if (!branchName || !username || !password) {
        skipped.push({ username, reason: "Missing required fields" });
        continue;
      }

      // Check for duplicate username
      const existing = await findSameUsername(username);
      if (existing.exists) {
        skipped.push({ username, reason: "Username already exists" });
        continue;
      }

      // Encrypt password
      const encryptedPassword = encrypt(password);

      // Store with schoolId from token
      const newBranch = new Branch({
        branchName,
        username,
        password: encryptedPassword,
        email,
        address,
        mobileNo,
        schoolId: id,
      });

      await newBranch.save();
      inserted++;
    }

    res.status(201).json({
      message: `${inserted} branches added successfully.`,
      skipped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const grantSchoolBranchAccess = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin") {
    return res
      .status(403)
      .json({ message: "You are not authorized to change access" });
  }

  const { id } = req.params;
  const { fullAccess } = req.body;

  try {
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // Only allow boolean values to be set
    if (typeof fullAccess !== "boolean") {
      return res.status(400).json({
        message: "Invalid value for fullAccess. Must be true or false.",
      });
    }

    branch.fullAccess = fullAccess;
    await branch.save();

    res.status(200).json({
      message: `Access ${fullAccess ? "granted" : "revoked"} successfully`,
      branch,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



export const getTodayExpiredBranches = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;
  const ObjectId = mongoose.Types.ObjectId;

  try {

      const endOfDay = new Date();
    endOfDay.setHours(29, 29, 59, 999);

    const oneMonthLater = new Date(endOfDay);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

    let query = {
      subscriptionExpirationDate: {
        $lte: oneMonthLater,
      },
    };

    if (role === "superAdmin") {
    }
    else if (role === "school") {
      query.schoolId = new ObjectId(id);
    }
    else if (role === "branchGroup") {
      query._id = { $in: AssignedBranch };
    }else if (role === "branch") {
      query._id = new ObjectId(id);
    }
    else {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const branches = await Branch.aggregate([
      { $match: query },

      {
        $lookup: {
          from: "schools", 
          localField: "schoolId",
          foreignField: "_id",
          as: "school"
        }
      },

      { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          branchName: 1,
          mobileNo: 1,
          subscriptionExpirationDate: 1,
          schoolName: "$school.schoolName",

        remainingDays: {
          $cond: {
            if: { $lte: ["$subscriptionExpirationDate", new Date()] },
            then: 0,
            else: {
              $ceil: {
                $divide: [
                  { $subtract: ["$subscriptionExpirationDate", new Date()] },
                  1000 * 60 * 60 * 24
                ]
              }
            }
          }
        }
        }
      }
    ]);

    if (!branches.length) {
      return res.status(404).json({
        success: false,
        message: "No branches with subscription expiring today",
      });
    }


    res.status(200).json({
      success: true,
      count: branches.length,
      data: branches,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
