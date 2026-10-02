import Incident, {
  normalizeCategory,
  normalizeRegion,
  normalizeSeverity,
  normalizeStatus,
} from "../Models/incident.js";
import School from "../Models/school.js";
import { buildQueryWithRole, resolveSchoolAndBranch } from "../Utils/roleResolver.js";
import mongoose from "mongoose";
import {
  parseDashboardDateRange,
  parseDashboardMonth,
  buildEffectiveDateFilter,
  getRegionVariants,
  getCategoryVariants,
  safeObjectId,
  buildFacetPipeline,
  formatDashboardResponse,
  parseMongoExplainStats,
} from "../Utils/dashboardHelpers.js";


export const addIncident = async (req, res) => {
  try {
    // ✅ Use common function
    const { schoolId, branchId,parentId } = resolveSchoolAndBranch(req);

    // ✅ Validate School
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const {
      email,
      region,
      category,
      severity,
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
      severity,
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
      parentId
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
    let { page = 1, limit = 10, search = "", status = "", region = "" } = req.query;

    page = Math.max(1, parseInt(page) || 1);
    if (limit === "all" || limit === "All" || limit === 0 || limit === "0") {
      limit = 1000000;
    } else {
      limit = Math.max(1, parseInt(limit) || 10);
    }
    const skip = (page - 1) * limit;

    // ✅ Role-based filter
    let filter = buildQueryWithRole(req);

    if (status && status.toLowerCase() !== "all") {
      if (status === "In-Progress" || status === "In Progress") {
        filter.status = { $in: ["In-Progress", "In Progress"] };
      } else {
        filter.status = { $regex: "^" + status + "$", $options: "i" };
      }
    }

    if (region && region.toLowerCase() !== "all") {
      filter.region = { $regex: "^" + region + "$", $options: "i" };
    }

    // ✅ Convert to ObjectId (VERY IMPORTANT)
    if (filter?.branchId) {
      if (filter.branchId.$in) {
        filter.branchId.$in = filter.branchId.$in.map(
          (id) => new mongoose.Types.ObjectId(id)
        );
      } else {
        filter.branchId = new mongoose.Types.ObjectId(filter.branchId);
      }
    }

    if (filter?.schoolId) {
      filter.schoolId = new mongoose.Types.ObjectId(filter.schoolId);
    }
    if (filter?.parentId) {
      filter.parentId = new mongoose.Types.ObjectId(filter.parentId);
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






//  update incident status only

export const updateIncidentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, escalationStatus, escalatedTo, closureDate } = req.body;

    // validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Incident ID",
      });
    }

    // validate status
    const allowedStatus = ["Open", "In Progress", "In-Progress", "Resolved", "Closed", "Close"];
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const incident = await Incident.findById(id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found",
      });
    }

    // update fields
    if (status) incident.status = status;
    if (remarks) incident.remarks = remarks;
    if (escalationStatus) incident.escalationStatus = escalationStatus;
    if (escalatedTo) incident.escalatedTo = escalatedTo;

    // auto set closure date when closed
    if (status === "Closed" || status === "Close") {
      incident.closureDate = closureDate || new Date();
    }

    await incident.save();

    res.status(200).json({
      success: true,
      message: "Incident status updated successfully",
      data: incident,
    });

  } catch (error) {
    console.error("Error updating incident:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
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

// ✅ Incident Dashboard / Stats (Total Incidents, Open Cases, High/Critical, Closure Rate)
export const getIncidentDashboard = async (req, res) => {
  try {
    // 1. Role-based filter
    let filter;
    try {
      filter = buildQueryWithRole(req);
    } catch (roleErr) {
      return res.status(403).json({
        success: false,
        message: roleErr.message || "Unauthorized access.",
      });
    }

    // Remove status from base filter so summary cards reflect overall totals
    delete filter.status;

    // 2. Direct Matching for Region & Category using indexed variants (no regex)
    if (filter.region) {
      if (String(filter.region).trim().toLowerCase() === "all") {
        delete filter.region;
      } else {
        filter.region = { $in: getRegionVariants(filter.region) };
      }
    }

    if (filter.category) {
      if (String(filter.category).trim().toLowerCase() === "all") {
        delete filter.category;
      } else {
        filter.category = { $in: getCategoryVariants(filter.category) };
      }
    }

    // 3. Validate incoming date and month filters and standardize timezone handling
    const { startDate, endDate, month } = req.query;
    if (month && String(month).trim().toLowerCase() !== "all") {
      const parsedMonth = parseDashboardMonth(month);
      if (parsedMonth?.error) {
        return res.status(400).json({
          success: false,
          message: parsedMonth.error,
        });
      }
      if (parsedMonth) {
        const dateFilter = buildEffectiveDateFilter(parsedMonth.start, parsedMonth.end);
        if (dateFilter) {
          if (filter.$or) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: filter.$or }, dateFilter);
            delete filter.$or;
          } else {
            filter.$or = dateFilter.$or;
          }
        }
      }
    } else if (startDate !== undefined || endDate !== undefined) {
      const { start, end, error: dateError } = parseDashboardDateRange(startDate, endDate);
      if (dateError) {
        return res.status(400).json({
          success: false,
          message: dateError,
        });
      }

      const dateFilter = buildEffectiveDateFilter(start, end);
      if (dateFilter) {
        if (filter.$or) {
          filter.$and = filter.$and || [];
          filter.$and.push({ $or: filter.$or }, dateFilter);
          delete filter.$or;
        } else {
          filter.$or = dateFilter.$or;
        }
      }

      delete filter.startDate;
      delete filter.endDate;
    }
    delete filter.month;

    // 4. Safely validate and convert IDs to ObjectId
    if (filter?.branchId) {
      if (filter.branchId.$in) {
        const converted = [];
        for (const id of filter.branchId.$in) {
          const casted = safeObjectId(id);
          if (!casted) {
            return res.status(400).json({
              success: false,
              message: `Invalid branchId format: ${id}`,
            });
          }
          converted.push(casted);
        }
        filter.branchId.$in = converted;
      } else {
        const casted = safeObjectId(filter.branchId);
        if (!casted) {
          return res.status(400).json({
            success: false,
            message: `Invalid branchId format: ${filter.branchId}`,
          });
        }
        filter.branchId = casted;
      }
    }

    if (filter?.schoolId) {
      const casted = safeObjectId(filter.schoolId);
      if (!casted) {
        return res.status(400).json({
          success: false,
          message: `Invalid schoolId format: ${filter.schoolId}`,
        });
      }
      filter.schoolId = casted;
    }

    if (filter?.parentId) {
      const casted = safeObjectId(filter.parentId);
      if (!casted) {
        return res.status(400).json({
          success: false,
          message: `Invalid parentId format: ${filter.parentId}`,
        });
      }
      filter.parentId = casted;
    }

    // 5. Build optimized single-pass $facet aggregation pipeline
    const pipeline = buildFacetPipeline(filter);

    // 6. Benchmark using .explain("executionStats") if authorized
    const isAuthorizedForExplain =
      req.user?.role === "superAdmin" || process.env.NODE_ENV !== "production";
    const shouldExplain =
      isAuthorizedForExplain &&
      (req.query.explain === "true" || req.query.benchmark === "true");

    let executionStats = undefined;
    if (shouldExplain) {
      try {
        const explainResult = await Incident.aggregate(pipeline, { allowDiskUse: true }).explain("executionStats");
        executionStats = parseMongoExplainStats(explainResult);
      } catch (explainErr) {
        console.warn("Dashboard explain benchmark error:", explainErr.message);
      }
    }

    // 7. Execute single-pass aggregation
    const results = await Incident.aggregate(pipeline, { allowDiskUse: true });

    // 8. Format structured dashboard response
    const dashboardData = formatDashboardResponse(results);

    const response = {
      success: true,
      data: dashboardData,
    };

    if (executionStats) {
      response.benchmark = executionStats;
    }

    return res.status(200).json(response);

  } catch (err) {
    console.error("GET INCIDENT DASHBOARD ERROR:", err);
    const isProd = process.env.NODE_ENV === "production";
    return res.status(err.status || 500).json({
      success: false,
      message: isProd
        ? "An internal server error occurred while generating the incident dashboard."
        : err.message,
    });
  }
};
