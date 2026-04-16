import Incident from "../Models/incident.js";
import School from "../Models/school.js";
import {buildQueryWithRole, resolveSchoolAndBranch } from "../Utils/roleResolver.js"
import mongoose from "mongoose";


export const addIncident = async (req, res) => {
  try {
    // ✅ Use common function
    const { schoolId, branchId } = resolveSchoolAndBranch(req);

    // ✅ Validate School
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const {
      email,
      region,
      category,
      reportedBy,
      subCategory,
      stakeholders,
      briefDescription,
      immediateActionTaken,
      pendingAction,
      closureDate,
      date,
      status,
      escalationStatus,
      escalatedTo,
      remarks,
    } = req.body;

    const newIncident = new Incident({
      email,
      region,
      category,
      reportedBy,
      subCategory,
      stakeholders,
      briefDescription,
      immediateActionTaken,
      pendingAction,
      closureDate,
      date,
      status,
      escalationStatus,
      escalatedTo,
      remarks,
      schoolId,
      branchId,
    });

    await newIncident.save();

    return res.status(201).json({
      success: true,
      message: "Incident reported successfully",
      data: newIncident,
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};



export const getIncidents = async (req, res) => {
  try {
    let { page = 1, limit = 10, search = "" } = req.query;

    page = Math.max(1, parseInt(page));
    limit = Math.max(1, parseInt(limit));
    const skip = (page - 1) * limit;

    // ✅ Role-based filter
    let filter = buildQueryWithRole(req);

    // ✅ Convert to ObjectId (VERY IMPORTANT)
    if (filter?.branchId) {
      filter.branchId = new mongoose.Types.ObjectId(filter.branchId);
    }
    if (filter?.schoolId) {
      filter.schoolId = new mongoose.Types.ObjectId(filter.schoolId);
    }

    const pipeline = [
      { $match: filter },

      // ✅ School join
      {
        $lookup: {
          from: "schools", // ⚠️ check your actual collection name
          localField: "schoolId",
          foreignField: "_id",
          as: "school",
        },
      },
      { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },

      // ✅ Branch join
      {
        $lookup: {
          from: "branches", // ⚠️ check your actual collection name
          localField: "branchId",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },

      // ✅ Search
      ...(search
        ? [
            {
              $match: {
                $or: [
                  { "school.schoolName": { $regex: search, $options: "i" } },
                  { "branch.branchName": { $regex: search, $options: "i" } },
                  { reportedBy: { $regex: search, $options: "i" } },
                ],
              },
            },
          ]
        : []),

      // ✅ Sort latest first
      { $sort: { createdAt: -1 } },

      // ✅ Pagination + Count
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },

            // ✅ Add flat fields
            {
              $addFields: {
                schoolName: "$school.schoolName",
                branchName: "$branch.branchName",
              },
            },

            // ✅ Remove unwanted lookup data
            {
              $project: {
                school: 0,
                branch: 0,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await Incident.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      total: result[0]?.total[0]?.count || 0,
      page,
      limit,
      data: result[0]?.data || [],
    });

  } catch (err) {
    console.error("GET INCIDENT ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};




export const updateIncident = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Role-based filter (ensures user updates only allowed data)
    let filter = buildQueryWithRole(req, { _id: id });

    // ❌ Prevent updating restricted fields
    delete req.body.schoolId;
    delete req.body.branchId;

    const updatedIncident = await Incident.findOneAndUpdate(
      filter,
      req.body,
      { new: true }
    );

    if (!updatedIncident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found or not authorized",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Incident updated successfully",
      data: updatedIncident,
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};




export const deleteIncident = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Role-based filter
    let filter = buildQueryWithRole(req, { _id: id });

    const deletedIncident = await Incident.findOneAndDelete(filter);

    if (!deletedIncident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found or not authorized",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Incident deleted successfully",
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};