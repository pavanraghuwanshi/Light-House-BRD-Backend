import Incident from "../Models/incident.js";
import School from "../Models/school.js";
import {buildQueryWithRole, resolveSchoolAndBranch } from "../Utils/roleResolver.js"

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

    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    let match = buildQueryWithRole(req);

    const pipeline = [
      { $match: match },

      {
        $lookup: {
          from: "schools",
          localField: "schoolId",
          foreignField: "_id",
          as: "school",
        },
      },
      { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "branches",
          localField: "branchId",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },

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

      { $sort: { createdAt: -1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $addFields: {
                schoolName: "$school.schoolName",
                branchName: "$branch.branchName",
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
      total: result[0].total[0]?.count || 0,
      page,
      limit,
      data: result[0].data, // ✅ SAME format
    });

  } catch (err) {
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