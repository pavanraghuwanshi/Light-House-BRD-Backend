import { PREK_ROLES, normalizePrekRole } from "./prekConstants.js";

/**
 * Resolve school, branch and parent IDs based on user role
 * Supports Pre-K 5-tier role hierarchy (Central, National Head, RSO, BM, AOM)
 * as well as legacy school management roles.
 */
export const resolveSchoolAndBranch = (req) => {
  const rawRole = req.user?.role;
  const prekRole = normalizePrekRole(rawRole);
  const role = prekRole || rawRole;

  let schoolId = req.body?.schoolId || null;
  let branchId = req.body?.branchId || null;
  let parentId = req.body?.parentId || null;

  // Pre-K 5-Tier Hierarchy (FR-1.2, FR-1.3)
  if (role === PREK_ROLES.CENTRAL || role === "superAdmin") {
    return { schoolId, branchId, parentId };
  }

  if (role === PREK_ROLES.NATIONAL_HEAD) {
    return { schoolId, branchId, parentId };
  }

  if (
    role === PREK_ROLES.RSO ||
    role === PREK_ROLES.BM ||
    role === PREK_ROLES.AOM
  ) {
    return { schoolId, branchId, parentId };
  }

  // Legacy roles
  if (role === "school") {
    schoolId = req.user.id;
    branchId = req.body.branchId;
    parentId = req.body.parentId;

    if (!branchId) {
      throw new Error("branchId is required for school");
    }
  } else if (role === "branchGroup") {
    schoolId = req.user.schoolId;
    branchId = req.body.branchId;
    parentId = req.body.parentId;

    if (!branchId) {
      throw new Error("branchId is required for branchGroup");
    }
  } else if (role === "branch") {
    schoolId = req.user.schoolId;
    branchId = req.user.id;
    parentId = req.body.parentId;
  } else if (role === "parent") {
    schoolId = req.user.schoolId;
    branchId = req.user.branchId;
    parentId = req.user.id;

    if (!branchId || !schoolId) {
      throw new Error("Parent must be associated with a branch and school");
    }
  } else {
    throw new Error("You are not authorized to perform this action.");
  }

  return { schoolId, branchId, parentId };
};

/**
 * Build MongoDB query filter based on user role and data scope
 * Implements FR-1.2 and FR-1.3:
 * - Central & National Head: National visibility (see all zones)
 * - RSO: Scoped to their full zone / region
 * - BM: Scoped to their cluster / assigned centres
 * - AOM: Scoped to their centre(s) / local area
 */
export const buildQueryWithRole = (req, extraFilters = {}) => {
  const rawRole = req.user?.role;
  const prekRole = normalizePrekRole(rawRole);
  const role = prekRole || rawRole;

  let filter = {};

  // Pre-K Hierarchy Roles (FR-1.2, FR-1.3)
  if (role === PREK_ROLES.CENTRAL || role === "superAdmin") {
    // Central has National, full access (sees all zones and cases)
  } else if (role === PREK_ROLES.NATIONAL_HEAD) {
    // National Head has National access (strategic oversight across all zones)
  } else if (role === PREK_ROLES.RSO) {
    // RSO is scoped to full zone (one or more regions)
    if (req.user?.zone) {
      filter.$or = [
        { zone: { $regex: `^${req.user.zone}$`, $options: "i" } },
        { region: { $regex: `^${req.user.zone}$`, $options: "i" } },
      ];
    }
  } else if (role === PREK_ROLES.BM) {
    // Business Manager is scoped to cluster / assigned centres within zone
    const clusterConditions = [];
    if (req.user?.cluster) {
      clusterConditions.push({ cluster: req.user.cluster });
    }
    if (Array.isArray(req.user?.centres) && req.user.centres.length > 0) {
      clusterConditions.push({ centreName: { $in: req.user.centres } });
      clusterConditions.push({ schoolName: { $in: req.user.centres } });
    }
    if (req.user?.zone) {
      clusterConditions.push({ zone: { $regex: `^${req.user.zone}$`, $options: "i" } });
    }
    if (clusterConditions.length > 0) {
      filter.$or = clusterConditions;
    }
  } else if (role === PREK_ROLES.AOM) {
    // AOM is scoped to own centre(s) / local area
    if (Array.isArray(req.user?.centres) && req.user.centres.length > 0) {
      filter.$or = [
        { centreName: { $in: req.user.centres } },
        { schoolName: { $in: req.user.centres } },
      ];
    } else if (req.user?.area) {
      filter.$or = [
        { centreName: req.user.area },
        { schoolName: req.user.area },
      ];
    }
  }
  // Legacy roles
  else if (role === "school") {
    filter.schoolId = req.user.id;
  } else if (role === "branchGroup") {
    filter.branchId = { $in: req.user.AssignedBranch };
  } else if (role === "branch") {
    filter.schoolId = req.user.schoolId;
    filter.branchId = req.user.id;
  } else if (role === "parent") {
    filter.schoolId = req.user.schoolId;
    filter.branchId = req.user.branchId;
    filter.parentId = req.user.id;
  } else {
    throw new Error("You are not authorized to perform this action.");
  }

  // Add query params dynamically
  const queryFilters = { ...req.query };

  // Remove pagination, date range, benchmark, and sort fields
  const excludeFields = [
    "page",
    "limit",
    "search",
    "sort",
    "month",
    "startDate",
    "endDate",
    "explain",
    "benchmark",
  ];
  excludeFields.forEach((field) => delete queryFilters[field]);

  // Merge remaining query filters
  Object.keys(queryFilters).forEach((key) => {
    if (queryFilters[key] !== undefined && queryFilters[key] !== "") {
      filter[key] = queryFilters[key];
    }
  });

  // Merge extra filters
  Object.assign(filter, extraFilters);

  return filter;
};
