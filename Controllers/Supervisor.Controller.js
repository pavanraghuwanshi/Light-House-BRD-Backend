import mongoose from "mongoose";
import School from "../Models/school.js";
import Supervisor from "../Models/supervisor.js";
import { decrypt, encrypt } from "../Utils/crypto.js";
import findSameUsername from "../Utils/findSameUsername.js";

export const addSupervisor = async (req, res) => {
  const {
    supervisorName,
    username,
    password,
    email,
    mobileNo,
    schoolId,
    branchId,
    routeObjId,

  } = req.body;

  const role = req.user.role;

  if (role !== 'school' && role !== 'superAdmin' && role !== 'branch' && role !== 'branchGroup') {
    return res.status(403).json({ message: 'You are not authorized to perform this action.' });
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

    const newParent = new Supervisor({
      supervisorName,
      username,
      password: encryptedPassword,
      email,
      mobileNo,
      schoolId,
      branchId,
      routeObjId,
    });

    await newParent.save();

    res
      .status(201)
      .json({ message: "Supervisor added successfully", parent: newParent });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getSupervisors = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;
  const ObjectId = mongoose.Types.ObjectId;

  const {
    page = 1,
    limit = 10,
    search = "",
    sortBy = "createdAt",
    sortOrder = "desc",
    schoolId,
    branchId,
    status,
  } = req.query;

  const skip = (page - 1) * limit;
  const direction = sortOrder === "asc" ? 1 : -1;

  try {
    let match = {};

    // ---------------- ROLE FILTER ----------------
    if (role === "superAdmin") match = {};
    else if (role === "school") match.schoolId = new ObjectId(id);
    else if (role === "branchGroup")
      match.branchId = { $in: AssignedBranch };
    else if (role === "branch") match.branchId = new ObjectId(id);
    else {
      return res
        .status(403)
        .json({ message: "You are not authorized to view supervisors" });
    }

    // ---------------- OPTIONAL FILTERS ----------------
    if (schoolId) match.schoolId = new ObjectId(schoolId);
    if (branchId) match.branchId = new ObjectId(branchId);
    if (status) match.status = status;

    if (search) {
      match.$or = [
        { supervisorName: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // ---------------- SORTABLE FIELDS ----------------
    const sortFields = {
      supervisorName: "supervisorName",
      mobileNo: "mobileNo",
      email: "email",
      status: "status",
      createdAt: "createdAt",
      schoolName: "school.schoolName",
      branchName: "branch.branchName",
      routeNumber: "route.routeNumber",
      deviceName: "device.name",
    };

    const sortField = sortFields[sortBy] || "createdAt";

    // ---------------- AGGREGATION ----------------
    const pipeline = [
      { $match: match },

      // School
      {
        $lookup: {
          from: "schools",
          localField: "schoolId",
          foreignField: "_id",
          as: "school",
        },
      },
      { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },

      // Branch
      {
        $lookup: {
          from: "branches",
          localField: "branchId",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },

      // Route (PRIMARY)
      {
        $lookup: {
          from: "routes",
          localField: "routeObjId",
          foreignField: "_id",
          as: "route",
        },
      },
      { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },

      // Device (via route)
      {
        $lookup: {
          from: "devices",
          localField: "route.deviceObjId",
          foreignField: "_id",
          as: "device",
        },
      },
      { $unwind: { path: "$device", preserveNullAndEmptyArrays: true } },

      // Sorting
      { $sort: { [sortField]: direction } },

      // Pagination
      { $skip: skip },
      { $limit: Number(limit) },

      // Projection
      {
        $project: {
          _id: 1,
          supervisorName: 1,
          username: 1,
          password: 1,
          mobileNo: 1,
          email: 1,
          status: 1,
          createdAt: 1,

          schoolId: {
            _id: "$school._id",
            schoolName: "$school.schoolName",
          },

          branchId: {
            _id: "$branch._id",
            branchName: "$branch.branchName",
          },

          routeObjId: {
            _id: "$route._id",
            routeNumber: "$route.routeNumber",
          },

          deviceObjId: {
            _id: "$device._id",
            name: "$device.name",
          },
        },
      },
    ];

    const supervisors = await Supervisor.aggregate(pipeline);
    const totalCount = await Supervisor.countDocuments(match);

    const decryptedSupervisors = supervisors.map(s => ({
      ...s,
      password: decrypt(s.password),
    }));

    res.status(200).json({
      success: true,
      totalCount,
      page: Number(page),
      limit: Number(limit),
      sortBy,
      sortOrder,
      data: decryptedSupervisors,
    });
  } catch (err) {
    console.error("Error in getSupervisors:", err);
    res.status(500).json({ message: err.message });
  }
};


export const updateSupervisor = async (req, res) => {
  const { id } = req.params;
  const {
    supervisorName,
    username,
    password,
    email,
    mobileNo,
    schoolId,
    branchId,
    routeObjId,
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
    const supervisor = await Supervisor.findById(id);
    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    if (username && supervisor.username !== username) {
      const existingUser = await findSameUsername(username);
      if (existingUser.exists) {
        return res
          .status(400)
          .json({ message: "This username already exists" });
      }
    }

    supervisor.supervisorName = supervisorName || supervisor.supervisorName;
    supervisor.username = username || supervisor.username;
    if (password) {
      supervisor.password = encrypt(password);
    }
    supervisor.email = email || supervisor.email;
    supervisor.mobileNo = mobileNo || supervisor.mobileNo;
    supervisor.schoolId = schoolId || supervisor.schoolId;
    supervisor.branchId = branchId || supervisor.branchId;
    supervisor.routeObjId = routeObjId || supervisor.routeObjId;

    await supervisor.save();

    res
      .status(200)
      .json({ message: "Supervisor updated successfully", supervisor });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteSupervisor = async (req, res) => {
  const { id } = req.params;

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
    const supervisor = await Supervisor.findByIdAndDelete(id);
    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    res.status(200).json({ message: "Supervisor deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const approveSupervisor = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // expecting "Approved" or "Rejected"
  const role = req.user?.role;

  if (role !== 'superAdmin'&& role !== 'school' && role !== 'branchGroup' && role !== 'branch') {
    return res.status(403).json({ message: 'You are not authorized to approve or reject drivers.' });
  }

  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({
      message:
        'Invalid approval status. Only "Approved" or "Rejected" allowed.',
    });
  }

  try {
    const supervisor = await Supervisor.findById(id);
    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    if (supervisor.status === status) {
      return res
        .status(400)
        .json({ message: `Supervisor is already marked as ${status}` });
    }

    supervisor.status = status;
    await supervisor.save();

    res.status(200).json({
      message: `Supervisor has been ${status.toLowerCase()} successfully.`,
      status: supervisor.status,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Something went wrong" });
  }
};
