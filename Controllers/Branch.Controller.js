import School from "../Models/school.js";
import findSameUsername from "../Utils/findSameUsername.js";
import { decrypt, encrypt, comparePassword } from "../Utils/crypto.js";
import Branch from "../Models/branch.js";
import BranchGroup from "../Models/branchGroup.js";
import Parent from "../Models/parents.js";
import Superadmin from "../Models/superAdmin.js";
import Supervisor from "../Models/supervisor.js";
import Driver from "../Models/driver.js";
import mongoose from "mongoose";
import xlsx from "xlsx";

export const addBranch = async (req, res) => {
  const {
    safetyHeadName,
    branchName,
    name,
    username,
    password,
    email,
    address,
    mobileNo,
    schoolId,
    fullAccess,
    fas,
    subscriptionExpirationDate,
    notificationsEnabled = {},
  } = req.body;

  const actualBranchName = name || branchName;

  const role = req.user.role;

  if (role !== "school" && role !== "superAdmin") {
    return res.status(403).json({ message: "You are not a valid user." });
  }

  try {
    if (fas === undefined || fas === null || isNaN(Number(fas))) {
      return res.status(400).json({ message: "fas field is required and must be a number." });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const existingUserByUsername = await findSameUsername(username);
    if (existingUserByUsername.exists) {
      return res.status(400).json({ message: "This username already exists" });
    }

    const existingFas = await Branch.findOne({ fas: Number(fas) });
    if (existingFas) {
      return res.status(400).json({ message: "This FAS already exists" });
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
      safetyHeadName,
      branchName: actualBranchName,
      username,
      password: encryptedPassword,
      email,
      address,
      mobileNo,
      schoolId,
      fullAccess,
      fas,
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
  const { fas, search } = req.query;

  const ObjectId = mongoose.Types.ObjectId;
  let Branches;

  try {
    let queryFilter = {};

    if (fas !== undefined && fas !== "") {
      const fasNumber = Number(fas);
      if (!isNaN(fasNumber)) {
        queryFilter.fas = fasNumber;
      }
    } else if (search) {
      const fasNumber = Number(search);
      if (!isNaN(fasNumber)) {
        queryFilter.$or = [
          { fas: fasNumber },
          { branchName: { $regex: search, $options: "i" } },
        ];
      } else {
        queryFilter.branchName = { $regex: search, $options: "i" };
      }
    }

    if (role === "superAdmin") {
      Branches = await Branch.find(queryFilter)
        .select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v")
        .populate("schoolId", "schoolName");
    } else if (role === "school") {
      Branches = await Branch.find({ ...queryFilter, schoolId: new ObjectId(id) })
        .select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v")
        .populate("schoolId", "schoolName");
    } else if (role === "branchGroup") {
      Branches = await Branch.find({ ...queryFilter, _id: { $in: AssignedBranch } })
        .select("-fcmToken -lastNotifiedDate -notificationsEnabled -__v")
        .populate("schoolId", "schoolName");
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
  const { role, id, schoolId: tokenSchoolId, AssignedBranch } = req.user;
  const { schoolId: querySchoolId, fas, search } = req.query;
  const schoolId = tokenSchoolId || querySchoolId;

  try {
    let filter = {};
    if (role === "superAdmin") {
      if (schoolId) {
        filter.schoolId = new mongoose.Types.ObjectId(schoolId);
      }
    } else if (role === "school") {
      const targetSchoolId = schoolId || id;
      filter.schoolId = new mongoose.Types.ObjectId(targetSchoolId);
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

    if (fas !== undefined && fas !== "") {
      const fasNumber = Number(fas);
      if (!isNaN(fasNumber)) {
        filter.fas = fasNumber;
      }
    } else if (search) {
      const fasNumber = Number(search);
      if (!isNaN(fasNumber)) {
        filter.$or = [
          { fas: fasNumber },
          { branchName: { $regex: search, $options: "i" } },
        ];
      } else {
        filter.branchName = { $regex: search, $options: "i" };
      }
    }

    const branches = await Branch.find(filter)
      .select("_id branchName fas")
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
    safetyHeadName,
    branchName,
    name,
    username,
    password,
    email,
    address,
    schoolId,
    mobileNo,
    fullAccess,
    fas,
    subscriptionExpirationDate,
    notificationsEnabled = {},
  } = req.body;

  const actualBranchName = name || branchName;

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

    if (fas !== undefined && fas !== null) {
      const existingFas = await Branch.findOne({ fas: Number(fas), _id: { $ne: id } });
      if (existingFas) {
        return res.status(400).json({ message: "FAS already exists" });
      }
    }

    const mergedNotifications = {
      ...branch.notificationsEnabled, // previous values
      ...notificationsEnabled, // new updates
    };

    const updateData = {
      safetyHeadName,
      ...(actualBranchName ? { branchName: actualBranchName } : {}),
      username,
      email,
      ...(password ? { password: encrypt(password) } : {}),
      address,
      mobileNo,
      schoolId,
      fullAccess,
      fas,
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
  const { schoolId: querySchoolId } = req.query;

  // ✅ Allow only school role or superAdmin
  if (role !== "school" && role !== "superAdmin") {
    return res
      .status(403)
      .json({ message: "Only school role can add branches." });
  }

  const file = req.file || (req.files && req.files[0]);
  if (!file) {
    return res.status(400).json({ message: "Excel file is required" });
  }

  try {
    const workbook = xlsx.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const branches = xlsx.utils.sheet_to_json(sheet);

    if (!branches.length) {
      return res.status(400).json({ message: "Excel file is empty" });
    }

    const getValue = (obj, ...keys) => {
      for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null) return obj[key];
      }
      const objKeys = Object.keys(obj);
      for (const key of keys) {
        const normalizedKey = key.toLowerCase().replace(/[\s_]/g, "");
        const foundKey = objKeys.find(
          (k) => k.toLowerCase().replace(/[\s_]/g, "") === normalizedKey
        );
        if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null) {
          return obj[foundKey];
        }
      }
      return undefined;
    };

    // 1. Collect all usernames, FAS values, and BranchGroup IDs from Excel
    const allUsernames = [];
    const allFasValues = [];
    const allBranchGroupIds = [];

    branches.forEach((item) => {
      const u = getValue(item, "username", "Username");
      if (u) allUsernames.push(String(u).toLowerCase().trim());

      const fasVal = getValue(item, "fas", "FAS");
      if (fasVal !== undefined && fasVal !== null && !isNaN(Number(fasVal))) {
        allFasValues.push(Number(fasVal));
      }

      const bgId = getValue(item, "branchGroupId");
      if (bgId && mongoose.Types.ObjectId.isValid(bgId)) {
        allBranchGroupIds.push(bgId);
      }
    });

    // 2. Pre-fetch existing data in parallel across all collections
    const [
      existingSuperadmins,
      existingSchools,
      existingBranchGroups,
      existingBranches,
      existingSupervisors,
      existingDrivers,
      existingParents,
      existingFasDocs,
      branchGroupsDocs,
    ] = await Promise.all([
      allUsernames.length ? Superadmin.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? School.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? BranchGroup.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? Branch.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? Supervisor.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? Driver.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allUsernames.length ? Parent.find({ username: { $in: allUsernames } }).select("username").lean() : [],
      allFasValues.length ? Branch.find({ fas: { $in: allFasValues } }).select("fas").lean() : [],
      allBranchGroupIds.length ? BranchGroup.find({ _id: { $in: allBranchGroupIds } }).select("_id schoolId").lean() : [],
    ]);

    const existingUsernamesSet = new Set([
      ...existingSuperadmins.map((u) => u.username.toLowerCase()),
      ...existingSchools.map((u) => u.username.toLowerCase()),
      ...existingBranchGroups.map((u) => u.username.toLowerCase()),
      ...existingBranches.map((u) => u.username.toLowerCase()),
      ...existingSupervisors.map((u) => u.username.toLowerCase()),
      ...existingDrivers.map((u) => u.username.toLowerCase()),
      ...existingParents.map((u) => u.username.toLowerCase()),
    ]);

    const existingFasSet = new Set(existingFasDocs.map((d) => d.fas));
    const branchGroupMap = new Map(branchGroupsDocs.map((bg) => [bg._id.toString(), bg.schoolId ? bg.schoolId.toString() : null]));

    const seenInBatchUsernames = new Set();
    const seenInBatchFas = new Set();

    const branchesToInsert = [];
    const branchGroupAssignments = []; // { docIndex, branchGroupId }
    const skipped = [];

    // 3. Perform in-memory validation for each row
    branches.forEach((item, index) => {
      const rowNumber = index + 2; // Excel row number (header is row 1)
      const branchName = getValue(item, "name", "Name");
      const rawUsername = getValue(item, "username", "Username");
      const rawPassword = getValue(item, "password", "Password");
      const email = getValue(item, "email", "Email") || "";
      const address = getValue(item, "address", "Address") || "";
      const mobileNo = getValue(item, "mobileNo") || "";
      const safetyHeadName = getValue(item, "safetyHeadName") || "N/A";
      const excelSchoolId = getValue(item, "schoolId");
      const branchGroupId = getValue(item, "branchGroupId");
      const fasVal = getValue(item, "fas", "FAS");

      let targetSchoolId = excelSchoolId || id || querySchoolId;

      if (!targetSchoolId && branchGroupId && branchGroupMap.has(branchGroupId)) {
        targetSchoolId = branchGroupMap.get(branchGroupId);
      }

      if (!targetSchoolId && req.user && req.user.role === "school") {
        targetSchoolId = req.user.id;
      }

      const parsedFas =
        fasVal !== undefined && fasVal !== null && !isNaN(Number(fasVal))
          ? Number(fasVal)
          : null;

      const usernameStr = rawUsername ? String(rawUsername).trim() : "";
      const usernameLower = usernameStr.toLowerCase();

      // Check required fields
      if (!branchName || !usernameStr || !rawPassword || !targetSchoolId || parsedFas === null) {
        const missingFields = [];
        if (!branchName) missingFields.push("name");
        if (!usernameStr) missingFields.push("username");
        if (!rawPassword) missingFields.push("password");
        if (!targetSchoolId) missingFields.push("schoolId");
        if (parsedFas === null) missingFields.push("fas");

        skipped.push({
          row: rowNumber,
          branchName: branchName || "N/A",
          username: usernameStr || "N/A",
          fas: fasVal !== undefined && fasVal !== null ? fasVal : "N/A",
          category: "Missing Required Fields",
          reason: `Missing required field(s): ${missingFields.join(", ")}`,
          missingFields,
        });
        return;
      }

      // Check username uniqueness
      if (existingUsernamesSet.has(usernameLower) || seenInBatchUsernames.has(usernameLower)) {
        skipped.push({
          row: rowNumber,
          branchName,
          username: usernameStr,
          fas: parsedFas,
          category: "Username Already Exists",
          reason: `Username '${usernameStr}' already exists`,
        });
        return;
      }

      // Check FAS uniqueness
      if (existingFasSet.has(parsedFas) || seenInBatchFas.has(parsedFas)) {
        skipped.push({
          row: rowNumber,
          branchName,
          username: usernameStr,
          fas: parsedFas,
          category: "FAS Already Exists",
          reason: `FAS '${parsedFas}' already exists`,
        });
        return;
      }

      // Mark as seen in this batch
      seenInBatchUsernames.add(usernameLower);
      seenInBatchFas.add(parsedFas);

      const encryptedPassword = encrypt(String(rawPassword));

      const branchDoc = {
        safetyHeadName,
        branchName,
        username: usernameStr,
        password: encryptedPassword,
        email: String(email),
        address: String(address),
        mobileNo: String(mobileNo),
        schoolId: targetSchoolId,
        fas: parsedFas,
      };

      const docIndex = branchesToInsert.length;
      branchesToInsert.push(branchDoc);

      if (branchGroupId && mongoose.Types.ObjectId.isValid(branchGroupId)) {
        branchGroupAssignments.push({ docIndex, branchGroupId });
      }
    });

    // 4. Perform single bulk insert & bulk updates
    let insertedCount = 0;
    if (branchesToInsert.length > 0) {
      const insertedDocs = await Branch.insertMany(branchesToInsert, { ordered: false });
      insertedCount = insertedDocs.length;

      // Update BranchGroups in bulk
      const bulkGroupOps = [];
      branchGroupAssignments.forEach(({ docIndex, branchGroupId }) => {
        const savedDoc = insertedDocs[docIndex];
        if (savedDoc) {
          bulkGroupOps.push({
            updateOne: {
              filter: { _id: branchGroupId },
              update: { $addToSet: { AssignedBranch: savedDoc._id } },
            },
          });
        }
      });

      if (bulkGroupOps.length > 0) {
        await BranchGroup.bulkWrite(bulkGroupOps);
      }
    }

    // Group skipped records by category
    const groupedByReason = {};
    skipped.forEach((item) => {
      const cat = item.category || "Other Error";
      if (!groupedByReason[cat]) {
        groupedByReason[cat] = {
          count: 0,
          items: [],
        };
      }
      groupedByReason[cat].count++;
      const { category, ...cleanItem } = item;
      groupedByReason[cat].items.push(cleanItem);
    });

    res.status(201).json({
      success: true,
      message: `${insertedCount} out of ${branches.length} branches registered successfully.`,
      totalCount: branches.length,
      insertedCount,
      skippedCount: skipped.length,
      groupedByReason,
      skipped,
    });
  } catch (err) {
    console.error("Bulk Add Branches Error:", err);
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
