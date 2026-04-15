import { filter } from "compression";
import Parent from "../Models/parents.js";
import School from "../Models/school.js";
import { decrypt, encrypt } from "../Utils/crypto.js";
import findSameUsername from "../Utils/findSameUsername.js";
import mongoose from "mongoose";

export const addParent = async (req, res) => {
  const {
    parentName,
    username,
    password,
    email,
    mobileNo,
    fullAccess,
    schoolId,
    branchId,
  } = req.body;

  const role = req.user.role;

  if (
    role !== "school" &&
    role !== "superAdmin" &&
    role !== "branchGroup" &&
    role !== "branch"
  ) {
    return res
      .status(403)
      .json({ message: "You are not authorized to perform this action." });
  }

  try {
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const existingUser = await findSameUsername(username);
    if (existingUser.exists) {
      return res.status(400).json({ message: "This username already exists" });
    }

    const encryptedPassword = encrypt(password);

    const newParent = new Parent({
      parentName,
      username,
      password: encryptedPassword,
      email,
      mobileNo,
      fullAccess: fullAccess || false,
      schoolId,
      branchId,
    });

    await newParent.save();

    res
      .status(201)
      .json({ message: "Parent added successfully", parent: newParent });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const getParents = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;

  let {
    page = 1,
    limit = 10,
    search = "",
    schoolId,
    branchId,
    startDate,
    endDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  try {
    let match = {};

    // Role based filtering
    switch (role) {
      case "superAdmin":
        break;
      case "school":
        match.schoolId = new mongoose.Types.ObjectId(id);
        break;
      case "branchGroup":
        match.branchId = { $in: AssignedBranch.map(b => new mongoose.Types.ObjectId(b)) };
        break;
      case "branch":
        match.branchId = new mongoose.Types.ObjectId(id);
        break;
      default:
        return res.status(403).json({ message: "Access denied: invalid role" });
    }

    if (schoolId) match.schoolId = new mongoose.Types.ObjectId(schoolId);
    if (branchId) match.branchId = new mongoose.Types.ObjectId(branchId);

    if (search) {
      match.$or = [
        { parentName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
      ];
    }

    if (startDate && endDate) {
      match.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const direction = sortOrder === "asc" ? 1 : -1;

    // Allowed sort fields
    const sortOptions = {
      parentName: "parentName",
      email: "email",
      mobileNo: "mobileNo",
      schoolName: "school.schoolName",
      branchName: "branch.branchName",
      createdAt: "createdAt",
      username: "username",
      password: "password",
    };

    const sortField = sortOptions[sortBy] || "createdAt";

    // Aggregation pipeline
    const pipeline = [
      { $match: match },

      // school lookup
      {
        $lookup: {
          from: "schools",
          localField: "schoolId",
          foreignField: "_id",
          as: "school",
        },
      },
      { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },

      // branch lookup
      {
        $lookup: {
          from: "branches",
          localField: "branchId",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },

      { $sort: { [sortField]: direction } },

      { $skip: skip },
      { $limit: parseInt(limit) },

      // Final projection
      {
        $project: {
          parentName: 1,
          username: 1,
          password: 1,
          email: 1,
          mobileNo: 1,
          createdAt: 1,
          schoolId: {
            _id: "$school._id",
            schoolName: "$school.schoolName"
                },
          branchId: {
            _id: "$branch._id",
            branchName: "$branch.branchName"
          }
        },
      },
    ];

    const data = await Parent.aggregate(pipeline);

    // COUNT documents
    const total = await Parent.countDocuments(match);

    // Decrypt password
    const parentsWithDecrypted = data.map((p) => {
      p.password = decrypt(p.password);
      return p;
    });

    return res.status(200).json({
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      sortBy,
      sortOrder,
      data: parentsWithDecrypted,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


export const updateParent = async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;

  const {
    parentName,
    username,
    password,
    email,
    mobileNo,
    fullAccess,
    schoolId,
    branchId,
  } = req.body;

  if (
    role !== "school" &&
    role !== "superAdmin" &&
    role !== "branchGroup" &&
    role !== "branch"
  ) {
    return res.status(403).json({ message: "You are not a valid user." });
  }

  try {
    const parent = await Parent.findById(id);

    if (username && parent.username !== username) {
      const { exists: usernameExists } = await findSameUsername(username);
      if (usernameExists) {
        return res.status(400).json({ message: "Username already exists" });
      }
    }

    const updateData = {
      parentName,
      username,
      password,
      email,
      mobileNo,
      fullAccess,
      schoolId,
      branchId,
    };

    if (password) {
      updateData.password = encrypt(password);
    }

    const updatedParent = await Parent.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedParent) {
      return res.status(404).json({ message: "Parent not found" });
    }

    res.status(200).json(updatedParent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete parent by ID
export const deleteParent = async (req, res) => {
  const { ids } = req.body;
  const { role } = req.user;

  if (
    !["school", "superAdmin", "branchGroup", "branch", "parent"].includes(role)
  ) {
    return res
      .status(403)
      .json({ message: "You are not authorized to perform this action." });
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res
      .status(400)
      .json({ message: "No parent IDs provided for deletion." });
  }

  try {
    const deletedParents = await Parent.deleteMany({ _id: { $in: ids } });

    if (!deletedParents || deletedParents.deletedCount === 0) {
      return res
        .status(404)
        .json({ message: "No parents found for deletion." });
    }

    res.status(200).json({
      message: `${deletedParents.deletedCount} parent(s) deleted successfully.`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getParentsDropdown = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;
  const { search = "", page = 1, limit = 10, branchId } = req.query;

  try {
    let query = {};
    let roleQuery = {};

    if (role === "school") {
      roleQuery.schoolId = id;
    } else if (role === "branchGroup") {
      roleQuery.branchId = { $in: AssignedBranch };
    } else if (role === "branch") {
      roleQuery.branchId = id;
    } else if (role !== "superAdmin") {
      return res.status(403).json({ message: "Access denied: invalid role" });
    }

    query = { ...roleQuery };

    if (branchId) {
      query.branchId = new mongoose.Types.ObjectId(branchId);
    }

    if (search) {
      query.parentName = { $regex: search, $options: "i" };
    }

    const skip = (page - 1) * limit;

    const parents = await Parent.find(query)
      .select("parentName _id")
      .sort({ parentName: 1 })
      .skip(skip)
      .limit(Number(limit));

    const totalCount = await Parent.countDocuments(roleQuery);

    return res.status(200).json({
      page: Number(page),
      limit: Number(limit),
      totalCount,
      totalPages: Math.ceil(totalCount / Number(limit)),
      data: parents,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const deleteSingleParent = async (req, res) => {
  const { id } = req.params; // single parent ID from URL
  const { role } = req.user;

  // ---------------------------
  // 🛡 Role Authorization Check
  // ---------------------------
  if (
    !["school", "superAdmin", "branchGroup", "branch", "parent"].includes(role)
  ) {
    return res
      .status(403)
      .json({ message: "You are not authorized to perform this action." });
  }

  // ---------------------------
  // 🧪 Validate ID
  // ---------------------------
  if (!id) {
    return res
      .status(400)
      .json({ message: "Parent ID is required for deletion." });
  }

  try {
    // ---------------------------
    // 🗑 Delete Operation
    // ---------------------------
    const deletedParent = await Parent.findByIdAndDelete(id);

    if (!deletedParent) {
      return res.status(404).json({ message: "Parent not found." });
    }

    res.status(200).json({
      message: "Parent deleted successfully.",
      deletedParent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
