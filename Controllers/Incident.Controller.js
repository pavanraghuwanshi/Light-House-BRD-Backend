import Incident, {
  normalizeCategory,
  normalizeRegion,
  normalizeSeverity,
  normalizeStatus,
} from "../Models/incident.js";
import AuditLog from "../Models/auditLog.js";
import { buildQueryWithRole } from "../Utils/roleResolver.js";
import mongoose from "mongoose";
import {
  parseDashboardDateRange,
  parseDashboardMonth,
  buildEffectiveDateFilter,
  getRegionVariants,
  getCategoryVariants,
  buildFacetPipeline,
  formatDashboardResponse,
  parseMongoExplainStats,
} from "../Utils/dashboardHelpers.js";
import {
  PREK_ROLES,
  normalizePrekRole,
  INCIDENT_TYPE_DEFAULTS,
  NON_DOWNGRADABLE_CRITICAL_TYPES,
  isNonDowngradable,
  enforceSeverityRules,
  ESCALATION_MATRIX,
  getEscalationDetails,
  calculateSlaDeadline,
  canRoleCloseIncident,
  generateCaseId,
  PREK_STATE_BASELINE,
  TOTAL_NETWORK_CENTRES,
  getRateBand,
} from "../Utils/prekConstants.js";
import recordAuditLog from "../Utils/auditLogger.js";

/**
 * FR-6.1 - FR-6.4: Incident Reporting Controller
 * - Captures: zone/region, state, centre, date, type, severity, reporter name & role, description.
 * - Auto-generates unique Case ID (FR-6.2).
 * - Validates reporter name & description (FR-6.3).
 * - Auto-routes to escalation owner & SLA, enforces non-downgradable rules (FR-5.2, FR-6.4).
 * - Confirms escalation owner & SLA to submitter (FR-6.4).
 */
export const addIncident = async (req, res) => {
  try {
    const {
      zone,
      region,
      state,
      centreName,
      incidentType,
      subCategory,
      severity: requestedSeverity,
      reporterName,
      reportedBy,
      reporterRole,
      description,
      briefDescription,
      immediateActionTaken,
      pendingAction,
      date,
      stakeholders,
    } = req.body;

    // FR-6.3: Pre-submission validation
    const finalReporterName = String(
      reporterName || reportedBy || req.user?.name || req.user?.username || ""
    ).trim();
    const finalDescription = String(description || briefDescription || "").trim();

    if (!finalReporterName) {
      return res.status(400).json({
        success: false,
        message: "Reporter name is required (FR-6.3).",
      });
    }

    if (!finalDescription) {
      return res.status(400).json({
        success: false,
        message: "Incident description is required (FR-6.3).",
      });
    }

    // Determine type and enforce severity rules (FR-5.2)
    const finalType = incidentType || subCategory || "Other";
    const finalSeverity = enforceSeverityRules(finalType, requestedSeverity);
    const escalation = getEscalationDetails(finalSeverity);
    const incidentDate = date ? new Date(date) : new Date();
    const slaDeadline = calculateSlaDeadline(incidentDate, finalSeverity);
    const caseId = generateCaseId();

    const newIncident = new Incident({
      caseId,
      incidentType: finalType,
      subCategory: finalType,
      severity: finalSeverity,
      zone: zone || region || req.user?.zone || "North",
      region: region || zone || req.user?.zone || "North",
      state: state || "",
      centreName: centreName || req.user?.centres?.[0] || "",
      date: incidentDate,
      reporterName: finalReporterName,
      reportedBy: finalReporterName,
      reporterRole: reporterRole || req.user?.role || "Staff",
      description: finalDescription,
      briefDescription: finalDescription,
      immediateActionTaken: immediateActionTaken || "",
      pendingAction: pendingAction || "",
      stakeholders: Array.isArray(stakeholders) ? stakeholders : [],
      status: "Open",
      escalationOwner: escalation.owner,
      escalationOwnerRole: escalation.ownerRole,
      sla: escalation.sla,
      slaHours: escalation.slaHours,
      slaAction: escalation.action,
      slaDeadline,
    });

    await newIncident.save();

    // FR-1.5: Audit Log
    await recordAuditLog({
      req,
      action: "INCIDENT_CREATED",
      entityType: "Incident",
      entityId: newIncident._id,
      details: {
        caseId: newIncident.caseId,
        incidentType: newIncident.incidentType,
        severity: newIncident.severity,
        escalationOwner: escalation.owner,
        sla: escalation.sla,
      },
    });

    // FR-6.4: Confirm escalation owner and SLA to submitter
    return res.status(201).json({
      success: true,
      message: `Incident ${newIncident.caseId} reported successfully. Escalated to ${escalation.owner} with ${escalation.sla} SLA.`,
      caseId: newIncident.caseId,
      escalationOwner: escalation.owner,
      escalationOwnerRole: escalation.ownerRole,
      sla: escalation.sla,
      slaHours: escalation.slaHours,
      slaDeadline: newIncident.slaDeadline,
      requiredAction: escalation.action,
      data: newIncident,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * FR-7.1, FR-7.3: Case Log with Search, Filter & Role Scoping
 */
export const getIncidents = async (req, res) => {
  try {
    let { page = 1, limit = 10, search = "", status = "", zone = "", region = "" } = req.query;

    page = Math.max(1, parseInt(page) || 1);
    if (limit === "all" || limit === "All" || limit === 0 || limit === "0") {
      limit = 1000000;
    } else {
      limit = Math.max(1, parseInt(limit) || 10);
    }
    const skip = (page - 1) * limit;

    // 5-Tier Role Scoping Filter (FR-1.3)
    let filter = buildQueryWithRole(req);

    if (status && status.toLowerCase() !== "all") {
      if (status === "In-Progress" || status === "In Progress") {
        filter.status = { $in: ["In-Progress", "In Progress"] };
      } else {
        filter.status = { $regex: "^" + status + "$", $options: "i" };
      }
    }

    const targetZone = zone || region;
    if (targetZone && targetZone.toLowerCase() !== "all") {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { zone: { $regex: "^" + targetZone + "$", $options: "i" } },
        { region: { $regex: "^" + targetZone + "$", $options: "i" } }
      );
    }

    // FR-7.1: Multi-field search
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      filter.$or = filter.$or || [];
      filter.$or.push(
        { caseId: searchRegex },
        { description: searchRegex },
        { briefDescription: searchRegex },
        { incidentType: searchRegex },
        { reporterName: searchRegex },
        { reportedBy: searchRegex },
        { centreName: searchRegex },
        { state: searchRegex }
      );
    }

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Incident.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      data: incidents,
    });
  } catch (err) {
    console.error("GET INCIDENTS ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * FR-7.2: Role-Enforced Case Closure Authority
 * - Area Operations Manager (AOM) can ONLY resolve and close Low-severity cases.
 * - Business Manager (BM) can resolve and close Medium & Low severity cases.
 * - Regional Safety Officer (RSO) can resolve High, Medium & Low severity cases.
 * - Central (All-Activity Admin) & National Head can resolve all cases including Critical.
 */
export const updateIncidentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, closureDate } = req.body;

    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { caseId: id };

    const incident = await Incident.findOne(query);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found.",
      });
    }

    const allowedStatus = ["Open", "In Progress", "In-Progress", "Resolved", "Closed", "Close"];
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value.",
      });
    }

    const nextStatus = status ? normalizeStatus(status) : incident.status;
    const isClosing = nextStatus === "Closed" || nextStatus === "Resolved";

    // FR-7.2 RBAC Check
    if (isClosing) {
      const userRole = req.user?.role;
      const canClose = canRoleCloseIncident(userRole, incident.severity);

      if (!canClose) {
        const escalation = getEscalationDetails(incident.severity);
        return res.status(403).json({
          success: false,
          message: `Permission denied: ${userRole || "User"} is not authorized to close ${incident.severity}-severity incidents. ${incident.severity} incidents must be resolved by ${escalation.owner}.`,
          severity: incident.severity,
          escalationOwner: escalation.owner,
          allowedRoles: escalation.canCloseRoles,
        });
      }

      incident.closureDate = closureDate || new Date();
      incident.closedBy = {
        userId: req.user?.id || req.user?._id || "unknown",
        userName: req.user?.name || req.user?.username || "unknown",
        userRole: req.user?.role || "unknown",
        closedAt: new Date(),
      };
    }

    const prevStatus = incident.status;
    if (status) incident.status = nextStatus;
    if (remarks) incident.remarks = remarks;

    // Record in history (auditable trail)
    incident.history = incident.history || [];
    incident.history.push({
      changedBy: req.user?.username || req.user?.name || "unknown",
      userRole: req.user?.role || "unknown",
      action: isClosing ? "INCIDENT_CLOSED" : "STATUS_UPDATED",
      previousStatus: prevStatus,
      newStatus: incident.status,
      timestamp: new Date(),
      remarks: remarks || "",
    });

    await incident.save();

    // FR-1.5: Audit Log
    await recordAuditLog({
      req,
      action: isClosing ? "INCIDENT_CLOSED" : "INCIDENT_STATUS_CHANGED",
      entityType: "Incident",
      entityId: incident._id,
      details: {
        caseId: incident.caseId,
        previousStatus: prevStatus,
        newStatus: incident.status,
        severity: incident.severity,
        remarks,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Incident ${incident.caseId || incident._id} status updated to ${incident.status} successfully.`,
      data: incident,
    });
  } catch (error) {
    console.error("Error updating incident status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating incident status.",
    });
  }
};

/**
 * Update incident details (FR-5.2: enforces non-downgradable rule)
 */
export const updateIncident = async (req, res) => {
  try {
    const { id } = req.params;

    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: id }
      : { caseId: id };

    let filter = buildQueryWithRole(req, query);
    delete req.body.caseId; // Prevent modifying unique Case ID

    const existingIncident = await Incident.findOne(filter);
    if (!existingIncident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found or not authorized.",
      });
    }

    // FR-5.2: Non-downgradable rule
    const targetType = req.body.incidentType || req.body.subCategory || existingIncident.incidentType;
    if (isNonDowngradable(targetType) && req.body.severity && req.body.severity !== "Critical") {
      req.body.severity = "Critical"; // Block downgrade
    }

    if (req.body.severity) {
      const escalation = getEscalationDetails(req.body.severity);
      req.body.escalationOwner = escalation.owner;
      req.body.escalationOwnerRole = escalation.ownerRole;
      req.body.sla = escalation.sla;
      req.body.slaHours = escalation.slaHours;
      req.body.slaAction = escalation.action;
    }

    const updatedIncident = await Incident.findOneAndUpdate(
      filter,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    // FR-1.5: Audit Log
    await recordAuditLog({
      req,
      action: "INCIDENT_UPDATED",
      entityType: "Incident",
      entityId: updatedIncident._id,
      details: {
        caseId: updatedIncident.caseId,
        updatedFields: Object.keys(req.body),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Incident updated successfully.",
      data: updatedIncident,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Delete Incident (Central Only)
 */
export const deleteIncident = async (req, res) => {
  try {
    const rawRole = req.user?.role;
    const prekRole = normalizePrekRole(rawRole);
    if (prekRole !== PREK_ROLES.CENTRAL && rawRole !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can delete incidents.",
      });
    }

    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: id }
      : { caseId: id };

    const deletedIncident = await Incident.findOneAndDelete(query);
    if (!deletedIncident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found.",
      });
    }

    // FR-1.5: Audit Log
    await recordAuditLog({
      req,
      action: "INCIDENT_DELETED",
      entityType: "Incident",
      entityId: deletedIncident._id,
      details: { caseId: deletedIncident.caseId },
    });

    return res.status(200).json({
      success: true,
      message: `Incident ${deletedIncident.caseId || id} deleted successfully.`,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * FR-3.1 - FR-3.5: National Dashboard Controller
 * - Aggregate centre count, total incidents & national incident rate per 100 centres (FR-3.1)
 * - State-level tile map colour-coded by rate band (Low/Medium/High/Critical) (FR-3.2)
 * - State selection drill-down with link to state's zone dashboard (FR-3.3)
 * - Zone-level comparison of centre volume and incident rate (FR-3.4)
 * - Ranked list of states with highest incident rate ("states to watch") (FR-3.5)
 */
export const getNationalDashboard = async (req, res) => {
  try {
    let filter = {};
    try {
      filter = buildQueryWithRole(req);
    } catch (err) {
      // Default to open filter for National Head / Central
    }

    delete filter.status;

    // Aggregate incidents by state & zone
    const stateIncidentsAgg = await Incident.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            state: { $ifNull: ["$state", "Unknown"] },
            zone: { $ifNull: ["$zone", { $ifNull: ["$region", "North"] }] },
          },
          incidentCount: { $sum: 1 },
          openCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["Open", "open", "In Progress", "In-Progress"]] },
                1,
                0,
              ],
            },
          },
          closedCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["Closed", "closed", "Resolved", "resolved"]] },
                1,
                0,
              ],
            },
          },
          criticalOrHighCount: {
            $sum: {
              $cond: [
                { $in: ["$severity", ["Critical", "critical", "High", "high"]] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const stateCountMap = new Map();
    let totalIncidents = 0;
    let totalOpen = 0;
    let totalClosed = 0;
    let totalCriticalOrHigh = 0;

    stateIncidentsAgg.forEach((item) => {
      const stateName = String(item._id.state || "").trim();
      const count = item.incidentCount || 0;
      totalIncidents += count;
      totalOpen += item.openCount || 0;
      totalClosed += item.closedCount || 0;
      totalCriticalOrHigh += item.criticalOrHighCount || 0;

      if (stateName && stateName.toLowerCase() !== "unknown") {
        stateCountMap.set(stateName.toLowerCase(), count);
      }
    });

    // Compute State Tile Map (FR-3.2)
    const stateTileMap = PREK_STATE_BASELINE.map((baseState) => {
      const incidentCount = stateCountMap.get(baseState.state.toLowerCase()) || 0;
      const incidentRate =
        baseState.centreCount > 0
          ? Number(((incidentCount / baseState.centreCount) * 100).toFixed(2))
          : 0;
      const rateBand = getRateBand(incidentRate);

      return {
        state: baseState.state,
        zone: baseState.zone,
        centreCount: baseState.centreCount,
        incidentCount,
        incidentRate,
        rateBand,
      };
    });

    // Zone-level comparison of centre volume & incident rate (FR-3.4)
    const zoneMap = new Map();
    stateTileMap.forEach((s) => {
      if (!zoneMap.has(s.zone)) {
        zoneMap.set(s.zone, { zone: s.zone, centreCount: 0, incidentCount: 0 });
      }
      const z = zoneMap.get(s.zone);
      z.centreCount += s.centreCount;
      z.incidentCount += s.incidentCount;
    });

    const zoneComparison = Array.from(zoneMap.values()).map((z) => {
      const incidentRate =
        z.centreCount > 0
          ? Number(((z.incidentCount / z.centreCount) * 100).toFixed(2))
          : 0;
      return {
        zone: z.zone,
        centreCount: z.centreCount,
        incidentCount: z.incidentCount,
        incidentRate,
      };
    });

    // FR-3.5: States to watch (Ranked by highest incident rate)
    const statesToWatch = [...stateTileMap]
      .sort((a, b) => b.incidentRate - a.incidentRate || b.incidentCount - a.incidentCount)
      .slice(0, 5)
      .map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

    // FR-3.1: National Metrics
    const totalCentres = TOTAL_NETWORK_CENTRES;
    const nationalIncidentRate =
      totalCentres > 0
        ? Number(((totalIncidents / totalCentres) * 100).toFixed(2))
        : 0;
    const closureRate =
      totalIncidents > 0
        ? `${Math.round((totalClosed / totalIncidents) * 100)}%`
        : "0%";

    // FR-3.3: Selected state drill-down
    let selectedStateDetails = null;
    const requestedState = req.query.state;
    if (requestedState) {
      const matched = stateTileMap.find(
        (s) => s.state.toLowerCase() === String(requestedState).trim().toLowerCase()
      );
      if (matched) {
        const stateIncidents = await Incident.find({
          state: { $regex: `^${matched.state}$`, $options: "i" },
        })
          .sort({ date: -1, createdAt: -1 })
          .limit(10)
          .select("caseId incidentType severity status date reporterName description escalationOwner");

        selectedStateDetails = {
          ...matched,
          zoneDashboardUrl: `/api/incident-stats?zone=${encodeURIComponent(matched.zone)}`,
          recentIncidents: stateIncidents,
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        nationalMetrics: {
          totalCentres,
          totalIncidents,
          nationalIncidentRatePer100Centres: nationalIncidentRate,
          openCases: totalOpen,
          closedCases: totalClosed,
          highOrCriticalCount: totalCriticalOrHigh,
          closureRate,
        },
        stateTileMap,
        zoneComparison,
        statesToWatch,
        selectedStateDetails,
      },
    });
  } catch (err) {
    console.error("GET NATIONAL DASHBOARD ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * FR-5.3: Standing Reference Endpoint for Escalation Matrix & Incident Types
 */
export const getEscalationMatrixReference = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        escalationMatrix: ESCALATION_MATRIX,
        incidentTypes: INCIDENT_TYPE_DEFAULTS,
        nonDowngradableCriticalTypes: NON_DOWNGRADABLE_CRITICAL_TYPES,
        roles: PREK_ROLES,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-1.5: Audit Logs retrieval for Central administrators
 */
export const getAuditLogs = async (req, res) => {
  try {
    const rawRole = req.user?.role;
    const prekRole = normalizePrekRole(rawRole);

    if (prekRole !== PREK_ROLES.CENTRAL && rawRole !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central administrators can view audit logs (FR-1.5).",
      });
    }

    let { page = 1, limit = 20, action, entityType } = req.query;
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.max(1, parseInt(limit) || 20);
    const skip = (page - 1) * limit;

    const query = {};
    if (action) query.action = action;
    if (entityType) query.entityType = entityType;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      data: logs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * FR-4.1 - FR-4.6: Zone Overview Dashboard / Stats
 */
export const getIncidentDashboard = async (req, res) => {
  try {
    let filter;
    try {
      filter = buildQueryWithRole(req);
    } catch (roleErr) {
      return res.status(403).json({
        success: false,
        message: roleErr.message || "Unauthorized access.",
      });
    }

    delete filter.status;

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

    const pipeline = buildFacetPipeline(filter);

    const isAuthorizedForExplain =
      req.user?.role === "Central" || req.user?.role === "superAdmin" || process.env.NODE_ENV !== "production";
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

    const results = await Incident.aggregate(pipeline, { allowDiskUse: true });
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
