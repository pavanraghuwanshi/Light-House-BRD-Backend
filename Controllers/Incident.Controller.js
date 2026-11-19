import Incident, {
  normalizeCategory,
  normalizeRegion,
  normalizeSeverity,
  normalizeStatus,
} from "../Models/incident.js";
import AuditLog from "../Models/auditLog.js";
import Centre from "../Models/centre.js";
import { buildQueryWithRole, getUserScope, escapeRegex } from "../Utils/roleResolver.js";
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
 * Dynamically resolves BM cluster centres from Centre Master so BM queries
 * strictly match their assigned cluster's centres (never peer BM clusters in the same zone).
 */
const resolveRoleFilter = async (req, extraFilters = {}) => {
  const scope = getUserScope(req);
  let clusterCentres = [];

  if (scope.isBM && scope.cluster) {
    const centres = await Centre.find({
      cluster: { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" },
      isDeleted: false,
    })
      .select("name")
      .lean();
    clusterCentres = centres.map((c) => c.name);
  }

  return buildQueryWithRole(req, extraFilters, { clusterCentres });
};

/**
 * FR-6.1 - FR-6.4: Incident Reporting Controller
 * - Captures: zone/region, state, cluster, centre, date, type, severity, reporter name & role, description.
 * - Auto-generates unique Case ID (FR-6.2).
 * - Validates reporter name & description (FR-6.3).
 * - Enforces strict role boundaries (AOM: own centres, BM: own cluster, RSO: own zone).
 * - Auto-routes to escalation owner & SLA, enforces non-downgradable rules (FR-5.2, FR-6.4).
 * - Confirms escalation owner & SLA to submitter (FR-6.4).
 */
export const addIncident = async (req, res) => {
  try {
    const { user } = req;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Valid authentication session is required.",
      });
    }

    const {
      incidentType,
      severity: requestedSeverity,
      description,
      centreName,
      state,
      status = "Open",
      closingRemark,
      closingRemarks,
      closureRemark,
      remarks,
      immediateActionTaken = "",
      pendingAction = "",
      stakeholders = [],
      date,
      incidentDate: rawIncidentDate,
    } = req.body;

    // 1. Mandatory Input Validation (FR-6.3)
    if (!description?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Incident description is required (FR-6.3).",
      });
    }

    if (!incidentType?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Incident type is required (FR-6.3).",
      });
    }

    // Validate status enum: allows "Open" or "Closed" (also accepts "Close")
    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus !== "Open" && normalizedStatus !== "Closed") {
      return res.status(400).json({
        success: false,
        message: `Invalid status: '${status}'. Allowed status values are: Open, Closed.`,
      });
    }

    const isClosed = normalizedStatus === "Closed";
    const resolvedClosingRemark = String(
      closingRemark || closingRemarks || closureRemark || remarks || ""
    ).trim();

    if (isClosed && !resolvedClosingRemark) {
      return res.status(400).json({
        success: false,
        message: "Closing remark is required when closing an incident.",
      });
    }

    // 2. Token-Derived Reporter Identity
    const reporterName = user.name || user.username;
    const reporterRole = user.role;
    const reporterId = user.id;

    if (!reporterName) {
      return res.status(400).json({
        success: false,
        message: "Reporter name could not be resolved from token (FR-6.3).",
      });
    }

    // 3. Resolve Centre and Reporting Hierarchy
    const scope = getUserScope(req);
    const requestedCentre = centreName?.trim() || user.centres?.[0] || "";

    let matchedCentreDoc = null;
    if (requestedCentre) {
      matchedCentreDoc = await Centre.findOne({
        name: { $regex: `^${escapeRegex(requestedCentre)}$`, $options: "i" },
        isDeleted: false,
      })
        .select("name zone state cluster")
        .lean();
    }

    // Derive hierarchy: scoped user token takes precedence, fallback to Centre Master / body for national
    const resolvedZone = scope.zone || matchedCentreDoc?.zone || req.body.zone?.trim() || "North";
    const resolvedCluster = scope.cluster || matchedCentreDoc?.cluster || req.body.cluster?.trim() || "";
    const resolvedState = state?.trim() || matchedCentreDoc?.state || "";

    // 4. Role Hierarchy Boundary Verification
    if (!scope.isNational) {
      if (scope.zone && resolvedZone.toLowerCase() !== scope.zone.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You are only authorized to report incidents within your assigned zone (${scope.zone}).`,
        });
      }

      if (scope.isBM) {
        if (!scope.cluster) {
          return res.status(403).json({
            success: false,
            message: "Access denied: Your Business Manager account has no assigned cluster.",
          });
        }
        if (resolvedCluster && resolvedCluster.toLowerCase() !== scope.cluster.toLowerCase()) {
          return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized to report incidents within your assigned cluster (${scope.cluster}).`,
          });
        }
      }

      if (scope.isAOM) {
        if (scope.centres.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Access denied: Your AOM account has no assigned centres.",
          });
        }
        const isOwnCentre = scope.centres.some(
          (c) => c.toLowerCase() === requestedCentre.toLowerCase()
        );
        if (!requestedCentre || !isOwnCentre) {
          return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized to report incidents for your assigned centre(s): ${scope.centres.join(", ")}.`,
          });
        }
      }
    }

    // 5. Determine Severity and Escalation Rules (FR-5.2)
    const finalType = incidentType.trim();
    const finalSeverity = enforceSeverityRules(finalType, requestedSeverity);
    const escalation = getEscalationDetails(finalSeverity);

    // If reporting with Closed status, verify user role closure authorization (FR-7.2)
    if (isClosed) {
      const canClose = canRoleCloseIncident(user.role, finalSeverity);
      if (!canClose) {
        return res.status(403).json({
          success: false,
          message: `Permission denied: ${user.role || "User"} is not authorized to close ${finalSeverity}-severity incidents. ${finalSeverity} incidents must be resolved by ${escalation.owner}.`,
          severity: finalSeverity,
          escalationOwner: escalation.owner,
          allowedRoles: escalation.canCloseRoles,
        });
      }
    }

    // Accept any previous/past or current date for incident reporting
    const inputDate = date ?? rawIncidentDate;
    let incidentDate = new Date();
    if (inputDate) {
      const parsedDate = new Date(inputDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format for incident date.",
        });
      }
      incidentDate = parsedDate;
    }

    const slaDeadline = calculateSlaDeadline(incidentDate, finalSeverity);
    const caseId = generateCaseId();
    const cleanDescription = description.trim();

    const closureDate = isClosed ? incidentDate : null;
    const closedBy = isClosed
      ? {
          userId: user.id || "unknown",
          userName: reporterName,
          userRole: reporterRole,
          closedAt: new Date(),
        }
      : undefined;

    const history = [
      {
        changedBy: reporterName,
        userRole: reporterRole,
        action: isClosed ? "INCIDENT_CREATED_AND_CLOSED" : "INCIDENT_CREATED",
        previousStatus: "None",
        newStatus: normalizedStatus,
        timestamp: new Date(),
        remarks: isClosed ? resolvedClosingRemark : "Incident initially logged",
      },
    ];

    // 6. Build and Save Incident Document
    const newIncident = new Incident({
      caseId,
      incidentType: finalType,
      subCategory: finalType,
      severity: finalSeverity,
      zone: resolvedZone,
      region: resolvedZone,
      state: resolvedState,
      cluster: resolvedCluster,
      centreName: requestedCentre,
      date: incidentDate,
      incidentDate: incidentDate,
      reporterId,
      reporterName,
      reportedBy: reporterName,
      reporterRole,
      description: cleanDescription,
      briefDescription: cleanDescription,
      immediateActionTaken: immediateActionTaken?.trim() || "",
      pendingAction: pendingAction?.trim() || "",
      stakeholders: Array.isArray(stakeholders) ? stakeholders : [],
      status: normalizedStatus,
      closureDate,
      closedBy,
      remarks: isClosed ? resolvedClosingRemark : "",
      closingRemark: isClosed ? resolvedClosingRemark : "",
      history,
      escalationOwner: escalation.owner,
      escalationOwnerRole: escalation.ownerRole,
      sla: escalation.sla,
      slaHours: escalation.slaHours,
      slaAction: escalation.action,
      slaDeadline,
    });

    await newIncident.save();

    // 7. Record Immutable Audit Log (FR-1.5)
    await recordAuditLog({
      req,
      action: isClosed ? "INCIDENT_CREATED_AND_CLOSED" : "INCIDENT_CREATED",
      entityType: "Incident",
      entityId: newIncident._id,
      details: {
        caseId: newIncident.caseId,
        incidentType: newIncident.incidentType,
        severity: newIncident.severity,
        status: newIncident.status,
        closingRemark: isClosed ? resolvedClosingRemark : undefined,
        escalationOwner: escalation.owner,
        sla: escalation.sla,
      },
    });

    // 8. Confirm Escalation Owner and SLA to Submitter (FR-6.4)
    const successMessage = isClosed
      ? `Incident ${newIncident.caseId} reported and closed successfully.`
      : `Incident ${newIncident.caseId} reported successfully. Escalated to ${escalation.owner} with ${escalation.sla} SLA.`;

    return res.status(201).json({
      success: true,
      message: successMessage,
      caseId: newIncident.caseId,
      date: newIncident.date,
      status: newIncident.status,
      closingRemark: isClosed ? resolvedClosingRemark : undefined,
      closureDate: newIncident.closureDate,
      closedBy: newIncident.closedBy,
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
 * FR-7.1, FR-7.3: Comprehensive Incident Reporting & Case Log
 * Supports rich multi-attribute filtering across the entire organizational hierarchy:
 * - Zone / Region (e.g. North, West, South, East, Central)
 * - Centre / School (e.g. Centre Bandra, Delhi Model School)
 * - State (e.g. Maharashtra, Karnataka, Delhi)
 * - Cluster (e.g. Mumbai Cluster)
 * - Severity (Low, Medium, High, Critical)
 * - Incident Type / Category (POCSO, Corporal Punishment, Accident, etc.)
 * - Status (Open, In Progress, Resolved, Closed)
 * - Date Range (startDate & endDate)
 * - Multi-field full-text search (search= or q=)
 * - Aggregated summary metrics (when includeStats=true or via /api/incident-reports)
 */
export const getIncidents = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search = "",
      q = "",
      status = "",
      zone = "",
      region = "",
      centre = "",
      centreName = "",
      school = "",
      schoolName = "",
      state = "",
      cluster = "",
      severity = "",
      incidentType = "",
      type = "",
      subCategory = "",
      category = "",
      startDate = "",
      endDate = "",
      includeStats = false,
      summary = false,
    } = req.query;

    page = Math.max(1, parseInt(page) || 1);
    if (limit === "all" || limit === "All" || limit === 0 || limit === "0") {
      limit = 1000000;
    } else {
      limit = Math.max(1, parseInt(limit) || 10);
    }
    const skip = (page - 1) * limit;

    // 5-Tier Role Scoping Filter (FR-1.3) with dynamic BM cluster centre resolution
    const roleFilter = await resolveRoleFilter(req);
    const andConditions = [];

    if (Object.keys(roleFilter).length > 0) {
      andConditions.push(roleFilter);
    }

    // Status Filter
    if (status && status.toLowerCase() !== "all") {
      if (status === "In-Progress" || status === "In Progress") {
        andConditions.push({ status: { $in: ["In-Progress", "In Progress"] } });
      } else {
        andConditions.push({ status: { $regex: "^" + status + "$", $options: "i" } });
      }
    }

    // Zone / Region Filter
    const targetZone = zone || region;
    if (targetZone && targetZone.toLowerCase() !== "all") {
      andConditions.push({
        $or: [
          { zone: { $regex: "^" + targetZone + "$", $options: "i" } },
          { region: { $regex: "^" + targetZone + "$", $options: "i" } },
        ],
      });
    }

    // Centre / School Filter
    const targetCentre = centreName || centre || schoolName || school;
    if (targetCentre && targetCentre.toLowerCase() !== "all") {
      andConditions.push({
        $or: [
          { centreName: { $regex: "^" + targetCentre + "$", $options: "i" } },
          { schoolName: { $regex: "^" + targetCentre + "$", $options: "i" } },
        ],
      });
    }

    // State Filter
    if (state && state.toLowerCase() !== "all") {
      andConditions.push({ state: { $regex: "^" + state + "$", $options: "i" } });
    }

    // Cluster Filter
    if (cluster && cluster.toLowerCase() !== "all") {
      andConditions.push({ cluster: { $regex: "^" + cluster + "$", $options: "i" } });
    }

    // Severity Filter
    if (severity && severity.toLowerCase() !== "all") {
      const normSev = normalizeSeverity(severity);
      if (normSev !== "unknown") {
        andConditions.push({ severity: normSev });
      } else {
        andConditions.push({ severity: { $regex: "^" + severity + "$", $options: "i" } });
      }
    }

    // Incident Type / Category Filter
    const targetType = incidentType || type || subCategory;
    if (targetType && targetType.toLowerCase() !== "all") {
      andConditions.push({
        $or: [
          { incidentType: { $regex: "^" + targetType + "$", $options: "i" } },
          { subCategory: { $regex: "^" + targetType + "$", $options: "i" } },
        ],
      });
    }

    if (category && category.toLowerCase() !== "all") {
      andConditions.push({ category: { $regex: "^" + category + "$", $options: "i" } });
    }

    // Date Range Filtering
    if (startDate || endDate) {
      const dateRange = parseDashboardDateRange(startDate, endDate);
      if (dateRange.startDate || dateRange.endDate) {
        andConditions.push(buildEffectiveDateFilter(dateRange.startDate, dateRange.endDate));
      }
    }

    // Multi-field Search
    const term = (search || q || "").trim();
    if (term) {
      const searchRegex = { $regex: term, $options: "i" };
      andConditions.push({
        $or: [
          { caseId: searchRegex },
          { description: searchRegex },
          { briefDescription: searchRegex },
          { incidentType: searchRegex },
          { subCategory: searchRegex },
          { reporterName: searchRegex },
          { reportedBy: searchRegex },
          { centreName: searchRegex },
          { schoolName: searchRegex },
          { state: searchRegex },
          { zone: searchRegex },
        ],
      });
    }

    const filter =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
        ? andConditions[0]
        : { $and: andConditions };

    const shouldIncludeStats =
      includeStats === "true" ||
      includeStats === true ||
      summary === "true" ||
      summary === true;

    const [incidents, total, stats] = await Promise.all([
      Incident.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Incident.countDocuments(filter),
      shouldIncludeStats
        ? Incident.aggregate([
            { $match: filter },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                open: {
                  $sum: { $cond: [{ $eq: ["$status", "Open"] }, 1, 0] },
                },
                inProgress: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["In Progress", "In-Progress"]] },
                      1,
                      0,
                    ],
                  },
                },
                resolved: {
                  $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] },
                },
                closed: {
                  $sum: { $cond: [{ $eq: ["$status", "Closed"] }, 1, 0] },
                },
                critical: {
                  $sum: { $cond: [{ $eq: ["$severity", "Critical"] }, 1, 0] },
                },
                high: {
                  $sum: { $cond: [{ $eq: ["$severity", "High"] }, 1, 0] },
                },
                medium: {
                  $sum: { $cond: [{ $eq: ["$severity", "Medium"] }, 1, 0] },
                },
                low: {
                  $sum: { $cond: [{ $eq: ["$severity", "Low"] }, 1, 0] },
                },
              },
            },
          ])
        : Promise.resolve([]),
    ]);

    const response = {
      success: true,
      total,
      page,
      limit,
      data: incidents,
    };

    if (shouldIncludeStats) {
      const summaryStats = stats[0] || {
        total: 0,
        open: 0,
        inProgress: 0,
        resolved: 0,
        closed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      delete summaryStats._id;
      response.summary = summaryStats;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("GET INCIDENTS ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Incident Reports Endpoint
 * Returns scoped incident data with aggregated summary metrics.
 */
export const getIncidentReports = async (req, res) => {
  req.query.includeStats = "true";
  return getIncidents(req, res);
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

    const filter = await resolveRoleFilter(req, query);
    const incident = await Incident.findOne(filter);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found or not authorized.",
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

    const scope = getUserScope(req);
    let filter = await resolveRoleFilter(req, query);
    delete req.body.caseId; // Prevent modifying unique Case ID
    delete req.body.reporterId;
    delete req.body.reporterName;
    delete req.body.reportedBy;
    delete req.body.reporterRole;

    // Prevent non-national users from reassigning an incident across zones/clusters/centres
    if (!scope.isNational) {
      delete req.body.zone;
      delete req.body.region;
      delete req.body.cluster;
      if (scope.isAOM) {
        delete req.body.centreName;
        delete req.body.schoolName;
      }
    }

    const existingIncident = await Incident.findOne(filter);
    if (!existingIncident) {
      return res.status(404).json({
        success: false,
        message: "Incident not found or not authorized.",
      });
    }

    // Validate and parse date / incidentDate if provided (accepts any previous date)
    const rawUpdateDate = req.body.date ?? req.body.incidentDate;
    if (rawUpdateDate !== undefined && rawUpdateDate !== null) {
      const parsedDate = new Date(rawUpdateDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format for incident date.",
        });
      }
      req.body.date = parsedDate;
      req.body.incidentDate = parsedDate;
    }

    // Synchronize description & incidentType aliases
    if (req.body.description && !req.body.briefDescription) {
      req.body.briefDescription = req.body.description;
    } else if (req.body.briefDescription && !req.body.description) {
      req.body.description = req.body.briefDescription;
    }

    if (req.body.incidentType && !req.body.subCategory) {
      req.body.subCategory = req.body.incidentType;
    } else if (req.body.subCategory && !req.body.incidentType) {
      req.body.incidentType = req.body.subCategory;
    }

    // FR-5.2: Non-downgradable rule
    const targetType = req.body.incidentType || req.body.subCategory || existingIncident.incidentType;
    if (isNonDowngradable(targetType) && req.body.severity && req.body.severity !== "Critical") {
      req.body.severity = "Critical"; // Block downgrade
    }

    // Recalculate SLA and escalation parameters if severity or date is updated
    if (req.body.severity || req.body.date) {
      const targetSeverity = req.body.severity || existingIncident.severity;
      const escalation = getEscalationDetails(targetSeverity);
      const effectiveDate = req.body.date || existingIncident.date || new Date();

      req.body.escalationOwner = escalation.owner;
      req.body.escalationOwnerRole = escalation.ownerRole;
      req.body.sla = escalation.sla;
      req.body.slaHours = escalation.slaHours;
      req.body.slaAction = escalation.action;
      req.body.slaDeadline = calculateSlaDeadline(effectiveDate, targetSeverity);
    }

    // Status & Closure Handling (Allow closing an open incident or updating status)
    let isClosing = false;
    let isReopening = false;

    if (req.body.status) {
      const normalizedStatus = normalizeStatus(req.body.status);
      if (normalizedStatus !== "Open" && normalizedStatus !== "Closed") {
        return res.status(400).json({
          success: false,
          message: `Invalid status: '${req.body.status}'. Allowed status values are: Open, Closed.`,
        });
      }

      req.body.status = normalizedStatus;
      isClosing = normalizedStatus === "Closed";
      isReopening = normalizedStatus === "Open" && existingIncident.status === "Closed";

      if (isClosing) {
        const targetSeverity = req.body.severity || existingIncident.severity;
        const userRole = req.user?.role;
        const canClose = canRoleCloseIncident(userRole, targetSeverity);

        if (!canClose) {
          const escalation = getEscalationDetails(targetSeverity);
          return res.status(403).json({
            success: false,
            message: `Permission denied: ${userRole || "User"} is not authorized to close ${targetSeverity}-severity incidents. ${targetSeverity} incidents must be resolved by ${escalation.owner}.`,
            severity: targetSeverity,
            escalationOwner: escalation.owner,
            allowedRoles: escalation.canCloseRoles,
          });
        }

        const closingRemark = String(
          req.body.closingRemark ||
          req.body.closingRemarks ||
          req.body.closureRemark ||
          req.body.remarks ||
          ""
        ).trim();

        if (!closingRemark) {
          return res.status(400).json({
            success: false,
            message: "Closing remark is required when closing an incident.",
          });
        }

        req.body.closureDate = req.body.closureDate ? new Date(req.body.closureDate) : new Date();
        req.body.closedBy = {
          userId: req.user?.id || req.user?._id || "unknown",
          userName: req.user?.name || req.user?.username || "unknown",
          userRole: req.user?.role || "unknown",
          closedAt: new Date(),
        };
        req.body.closingRemark = closingRemark;
        req.body.remarks = closingRemark;
      } else if (isReopening) {
        req.body.closureDate = null;
        req.body.closedBy = null;
      }

      // Record in auditable history
      if (req.body.status !== existingIncident.status) {
        const historyEntry = {
          changedBy: req.user?.name || req.user?.username || "unknown",
          userRole: req.user?.role || "unknown",
          action: isClosing ? "INCIDENT_CLOSED" : "INCIDENT_REOPENED",
          previousStatus: existingIncident.status,
          newStatus: req.body.status,
          timestamp: new Date(),
          remarks: req.body.closingRemark || req.body.remarks || "Status updated via incident update",
        };
        const existingHistory = Array.isArray(existingIncident.history) ? existingIncident.history : [];
        req.body.history = [...existingHistory, historyEntry];
      }
    }

    const updatedIncident = await Incident.findOneAndUpdate(
      filter,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    // FR-1.5: Audit Log
    await recordAuditLog({
      req,
      action: isClosing ? "INCIDENT_CLOSED" : "INCIDENT_UPDATED",
      entityType: "Incident",
      entityId: updatedIncident._id,
      details: {
        caseId: updatedIncident.caseId,
        updatedFields: Object.keys(req.body),
        status: updatedIncident.status,
      },
    });

    const successMessage = isClosing
      ? `Incident ${updatedIncident.caseId || id} closed successfully.`
      : "Incident updated successfully.";

    return res.status(200).json({
      success: true,
      message: successMessage,
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
    const scope = getUserScope(req);
    let filter = {};
    try {
      filter = await resolveRoleFilter(req);
    } catch (err) {
      return res.status(403).json({
        success: false,
        message: err.message || "Unauthorized access.",
      });
    }

    delete filter.status;
    // State query param is used for drill-down below, not for excluding other tiles in the map
    delete filter.state;

    // Aggregate incidents by state & zone (strictly within user's RBAC filter)
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
        stateCountMap.set(stateName.toLowerCase(), (stateCountMap.get(stateName.toLowerCase()) || 0) + count);
      }
    });

    // Restrict baseline states & zones strictly to user's assigned zone for non-National roles (RSO/BM/AOM)
    const scopedBaseline = scope.isNational
      ? PREK_STATE_BASELINE
      : scope.zone
      ? PREK_STATE_BASELINE.filter(
          (baseState) => baseState.zone.toLowerCase() === scope.zone.toLowerCase()
        )
      : [];

    // Compute State Tile Map (FR-3.2)
    const stateTileMap = scopedBaseline.map((baseState) => {
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

    // FR-3.5: States to watch (Ranked by highest incident rate within user's scope)
    const statesToWatch = [...stateTileMap]
      .sort((a, b) => b.incidentRate - a.incidentRate || b.incidentCount - a.incidentCount)
      .slice(0, 5)
      .map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

    // FR-3.1: National / Scoped Metrics
    const totalCentres = scope.isNational
      ? TOTAL_NETWORK_CENTRES
      : scopedBaseline.reduce((sum, s) => sum + (s.centreCount || 0), 0);
    const nationalIncidentRate =
      totalCentres > 0
        ? Number(((totalIncidents / totalCentres) * 100).toFixed(2))
        : 0;
    const closureRate =
      totalIncidents > 0
        ? `${Math.round((totalClosed / totalIncidents) * 100)}%`
        : "0%";

    // FR-3.3: Selected state drill-down (strictly constrained to user's RBAC scope!)
    let selectedStateDetails = null;
    const requestedState = req.query.state;
    if (requestedState) {
      const matched = stateTileMap.find(
        (s) => s.state.toLowerCase() === String(requestedState).trim().toLowerCase()
      );
      if (matched) {
        const stateCondition = { state: { $regex: `^${escapeRegex(matched.state)}$`, $options: "i" } };
        const drilldownQuery =
          Object.keys(filter).length > 0 ? { $and: [filter, stateCondition] } : stateCondition;

        const stateIncidents = await Incident.find(drilldownQuery)
          .sort({ date: -1, createdAt: -1 })
          .limit(10)
          .select("caseId incidentType severity status date reporterName description escalationOwner zone centreName");

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
 * FR-1.5: Audit Logs retrieval with multi-field search and filtering for Central administrators
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

    let {
      page = 1,
      limit = 20,
      search = "",
      q = "",
      action,
      entityType,
      username,
      userRole,
      startDate,
      endDate,
    } = req.query;

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.max(1, parseInt(limit) || 20);
    const skip = (page - 1) * limit;

    const andConditions = [];

    if (action && action.trim()) {
      andConditions.push({ action: { $regex: `^${action.trim()}$`, $options: "i" } });
    }

    if (entityType && entityType.trim()) {
      andConditions.push({ entityType: { $regex: `^${entityType.trim()}$`, $options: "i" } });
    }

    if (username && username.trim()) {
      andConditions.push({ username: { $regex: `^${username.trim()}$`, $options: "i" } });
    }

    if (userRole && userRole.trim()) {
      const normalizedRole = normalizePrekRole(userRole.trim()) || userRole.trim();
      andConditions.push({ userRole: normalizedRole });
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) dateFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          if (typeof endDate === "string" && endDate.trim().length === 10) {
            end.setUTCHours(23, 59, 59, 999);
          }
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        andConditions.push({ timestamp: dateFilter });
      }
    }

    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = { $regex: escaped, $options: "i" };
      andConditions.push({
        $or: [
          { action: searchRegex },
          { username: searchRegex },
          { userRole: searchRegex },
          { entityType: searchRegex },
          { entityId: searchRegex },
          { ipAddress: searchRegex },
          { "details.caseId": searchRegex },
          { "details.updatedUsername": searchRegex },
          { "details.targetUsername": searchRegex },
          { "details.remarks": searchRegex },
          { "details.reason": searchRegex },
        ],
      });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

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
      totalPages: Math.ceil(total / limit),
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
      filter = await resolveRoleFilter(req);
    } catch (roleErr) {
      return res.status(403).json({
        success: false,
        message: roleErr.message || "Unauthorized access.",
      });
    }

    delete filter.status;

    if (filter.zone) {
      if (String(filter.zone).trim().toLowerCase() === "all") {
        delete filter.zone;
      } else if (typeof filter.zone === "string") {
        filter.zone = { $in: getRegionVariants(filter.zone) };
      }
    }

    if (filter.region) {
      if (String(filter.region).trim().toLowerCase() === "all") {
        delete filter.region;
      } else if (typeof filter.region === "string") {
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

    const mergeDateFilter = (dateFilter) => {
      if (!dateFilter) return;
      if (filter.$and) {
        filter.$and.push(dateFilter);
      } else if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, dateFilter];
        delete filter.$or;
      } else {
        filter.$or = dateFilter.$or;
      }
    };

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
        mergeDateFilter(buildEffectiveDateFilter(parsedMonth.start, parsedMonth.end));
      }
    } else if (startDate !== undefined || endDate !== undefined) {
      const { start, end, error: dateError } = parseDashboardDateRange(startDate, endDate);
      if (dateError) {
        return res.status(400).json({
          success: false,
          message: dateError,
        });
      }

      mergeDateFilter(buildEffectiveDateFilter(start, end));

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
