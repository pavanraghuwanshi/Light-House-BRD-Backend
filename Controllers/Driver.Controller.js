import mongoose from "mongoose";
import Driver from "../Models/driver.js";
import School from "../Models/school.js";
import { decrypt, encrypt } from "../Utils/crypto.js";
import findSameUsername from "../Utils/findSameUsername.js";

export const addDriver = async (req, res) => {
  const {
    driverName,
    username,
    password,
    email,
    mobileNo,
    schoolId,
    branchId,
    routeObjId,
    address
  } = req.body;

  const role = req.user.role;

  if (
    role !== "school" &&
    role !== "superAdmin" &&
    role !== "branch" &&
    role !== "branchGroup"
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

    if (routeObjId) {
      await Driver.updateOne(
        { routeObjId },
        { $set: { routeObjId: null } }
      );
    }

    const newDriver = new Driver({
      driverName,
      username,
      password: encryptedPassword,
      email,
      mobileNo,
      schoolId,
      branchId,
      routeObjId: routeObjId || null,
      address
    });

    await newDriver.save();

    res
      .status(201)
      .json({ message: "Driver added successfully", driver: newDriver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getDrivers = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;
  const ObjectId = mongoose.Types.ObjectId;

  const {
    page = 1,
    limit = 10,
    search = "",
    sortBy = "createdAt",
    sortOrder = "desc",
    isApproved,
    schoolId,
    branchId,
  } = req.query;

  try {
    let match = {};

    // ---------------- ROLE FILTER ----------------
    if (role === "superAdmin") match = {};
    else if (role === "school") match.schoolId = new ObjectId(id);
    else if (role === "branchGroup") match.branchId = { $in: AssignedBranch };
    else if (role === "branch") match.branchId = new ObjectId(id);
    else {
      return res.status(403).json({ message: "Not authorized" });
    }

    // ---------------- OPTIONAL FILTERS ----------------
    if (schoolId) match.schoolId = new ObjectId(schoolId);
    if (branchId) match.branchId = new ObjectId(branchId);
    if (isApproved) match.isApproved = isApproved;

    if (search) {
      match.$or = [
        { driverName: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const direction = sortOrder === "asc" ? 1 : -1;

    // ---------------- SORT FIELDS ----------------
    const sortFields = {
      driverName: "driverName",
      mobileNo: "mobileNo",
      isApproved: "isApproved",
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

      // Route (NOW PRIMARY)
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
          driverName: 1,
          username: 1,
          email: 1,
          mobileNo: 1,
          createdAt: 1,
          isApproved: 1,
          password: 1,

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

    const drivers = await Driver.aggregate(pipeline);
    const total = await Driver.countDocuments(match);

    const decryptedDrivers = drivers.map(d => ({
      ...d,
      password: decrypt(d.password),
    }));

    res.status(200).json({
      success: true,
      totalCount: total,
      page: Number(page),
      limit: Number(limit),
      sortBy,
      sortOrder,
      data: decryptedDrivers,
    });
  } catch (err) {
    console.error("Error in getDrivers:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


export const updateDriver = async (req, res) => {
  const { id } = req.params;
  const {
    driverName,
    username,
    password,
    email,
    mobileNo,
    schoolId,
    branchId,
    routeObjId,
    address
  } = req.body;

  try {
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (username && driver.username !== username) {
      const existingUser = await findSameUsername(username);
      if (existingUser.exists) {
        return res.status(400).json({ message: "Username already exists" });
      }
    }

    // ✅ device logic (simple & correct)
    if (routeObjId !== undefined) {
      await Driver.updateOne(
        { routeObjId },
        { $set: { routeObjId: null } }
      );

      driver.routeObjId = routeObjId; // assign or null
    }

    driver.driverName = driverName || driver.driverName;
    driver.username = username || driver.username;
    if (password) driver.password = encrypt(password);
    driver.email = email || driver.email;
    driver.mobileNo = mobileNo || driver.mobileNo;
    driver.schoolId = schoolId || driver.schoolId;
    driver.branchId = branchId || driver.branchId;
    driver.address = address  || driver.address

    await driver.save();

    res.status(200).json({
      message: "Driver updated successfully",
      driver,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const deleteDriver = async (req, res) => {
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
    const driver = await Driver.findByIdAndDelete(id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.status(200).json({ message: "Driver deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const approveDriver = async (req, res) => {
  const { id } = req.params;
  const { isApproved } = req.body; // expecting "Approved" or "Rejected"
  const role = req.user?.role;

  if (
    role !== "superAdmin" &&
    role !== "school" &&
    role !== "branchGroup" &&
    role !== "branch"
  ) {
    return res.status(403).json({
      message: "You are not authorized to approve or reject drivers.",
    });
  }

  if (!["Approved", "Rejected"].includes(isApproved)) {
    return res.status(400).json({
      message:
        'Invalid approval status. Only "Approved" or "Rejected" allowed.',
    });
  }

  try {
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (driver.isApproved === isApproved) {
      return res
        .status(400)
        .json({ message: `Driver is already marked as ${isApproved}` });
    }

    driver.isApproved = isApproved;
    await driver.save();

    res.status(200).json({
      message: `Driver has been ${isApproved.toLowerCase()} successfully.`,
      isApproved:driver.isApproved,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Something went wrong" });
  }
};

export const driverDropdown = async (req, res) => {
  const { id, role, AssignedBranch } = req.user;
  const ObjectId = mongoose.Types.ObjectId;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const search = req.query.search ? req.query.search.trim() : "";
  const { schoolId, branchId } = req.query;

  try {
    let filter = {};

    if (role === "superAdmin") {
      filter = {};
    } else if (role === "school") {
      filter = { schoolId: new ObjectId(id) };
    } else if (role === "branchGroup") {
      filter = { branchId: { $in: AssignedBranch } };
    } else if (role === "branch") {
      filter = { branchId: new ObjectId(id) };
    } else {
      return res
        .status(403)
        .json({ message: "You are not authorized to view drivers" });
    }

    if (search) {
      filter.$or = [
        { driverName: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
      ];
    }

    if (schoolId) {
      filter.schoolId = new ObjectId(schoolId);
    }

    if (branchId) {
      filter.branchId = new ObjectId(branchId);
    }

    const totalCount = await Driver.countDocuments(filter);

    const drivers = await Driver.find(filter) // 👈 FIXED
      .select("_id driverName")
      .sort({ driverName: 1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / Number(limit)),
      data: drivers,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const checkDriverDeviceAssigned = async (req, res) => {
  try {
    const { routeObjId } = req.params;

    if (!routeObjId) {
      return res.status(400).json({
        success: false,
        message: "routeObjId is required",
      });
    }

    const driverAssigned = await Driver.findOne({ routeObjId })
      .select("driverName branchId routeObjId")
      .populate("branchId", "branchName")
      .populate("routeObjId", "routeNumber");

    if (!driverAssigned) {
      return res.status(200).json({
        success: true,
        assigned: false,
        message: "Device is not assigned to any driver",
      });
    }

    return res.status(200).json({
      success: true,
      assigned: true,
      message: `Device ${
        driverAssigned?.routeObjId?.routeNumber
      } is already assigned to driver ${
        driverAssigned.driverName
      } of branch ${
        driverAssigned.branchId?.branchName || "N/A"
      }`,
    });
  } catch (error) {
    console.error("Error checking driver device assignment:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};



//  get driver for mobile app route wise

export const getDriverByRouteObjId = async (req, res) => {
  const { routeObjId } = req.params;
  const ObjectId = mongoose.Types.ObjectId;

  if (!routeObjId) {
    return res.status(400).json({
      success: false,
      message: "routeObjId is required",
    });
  }

  try {
    const driver = await Driver.findOne({ routeObjId: new ObjectId(routeObjId) })
      .select("_id driverName mobileNo email createdAt")
      .populate("branchId","branchName")
      .populate("schoolId","schoolName");

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "No driver found for this route",
      });
    }



    res.status(200).json({
      success: true,
      data: driver,
    });
  } catch (err) {
    console.error("Error in getDriverByRouteObjId:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


