import { PREK_ROLES, normalizePrekRole } from "./prekConstants.js";

/**
 * Role-Based Access Control Query Scoping (BRD v1.1 Section 5 & FR-1.3)
 * Enforces data visibility scoped strictly to user's reporting hierarchy:
 * - Central: National, full access (sees all zones)
 * - National Head: National strategic oversight (sees all zones)
 * - Regional Safety Officer (RSO): Full zone (one or more regions)
 * - Business Manager (BM): Cluster of areas within a zone
 * - Area Operations Manager (AOM): Own centre(s) / local area
 */
export const buildQueryWithRole = (req, extraFilters = {}) => {
  const rawRole = req.user?.role;
  const role = normalizePrekRole(rawRole) || rawRole;

  let filter = {};

  if (role === PREK_ROLES.CENTRAL || role === "superAdmin") {
    // National, full access across all zones
  } else if (role === PREK_ROLES.NATIONAL_HEAD) {
    // National visibility across all zones
  } else if (role === PREK_ROLES.RSO) {
    // RSO is scoped to full zone
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
      filter.centreName = { $in: req.user.centres };
    } else if (req.user?.area) {
      filter.centreName = req.user.area;
    } else {
      // AOM without assigned centres cannot view peer or other centres' incidents
      filter.centreName = { $in: [] };
    }
  } else {
    throw new Error("You are not authorized to perform this action.");
  }

  // Merge incoming query parameters dynamically
  const queryFilters = { ...req.query };

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

  Object.keys(queryFilters).forEach((key) => {
    if (queryFilters[key] !== undefined && queryFilters[key] !== "") {
      filter[key] = queryFilters[key];
    }
  });

  Object.assign(filter, extraFilters);

  return filter;
};

export default buildQueryWithRole;
