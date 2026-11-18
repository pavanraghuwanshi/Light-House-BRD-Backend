import { PREK_ROLES, normalizePrekRole } from "./prekConstants.js";

export const escapeRegex = (str) =>
  String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns normalized role and scope flags for the authenticated user.
 * - Central & National Head: National access (all zones)
 * - RSO: Strict single-zone access (multiple RSOs in the same zone share that zone's data; zero access to other zones)
 * - BM: Strict cluster / zone access
 * - AOM: Strict assigned centre(s) access
 */
export const getUserScope = (req) => {
  const rawRole = req.user?.role;
  const role = normalizePrekRole(rawRole) || rawRole;
  const isNational =
    role === PREK_ROLES.CENTRAL ||
    role === PREK_ROLES.NATIONAL_HEAD ||
    rawRole === "superAdmin";
  const zone = req.user?.zone ? String(req.user.zone).trim() : "";
  const cluster = req.user?.cluster ? String(req.user.cluster).trim() : "";
  const centres = Array.isArray(req.user?.centres)
    ? req.user.centres.map((c) => String(c).trim()).filter(Boolean)
    : [];

  return {
    role,
    rawRole,
    isNational,
    isCentral: role === PREK_ROLES.CENTRAL || rawRole === "superAdmin",
    isRSO: role === PREK_ROLES.RSO,
    isBM: role === PREK_ROLES.BM,
    isAOM: role === PREK_ROLES.AOM,
    zone,
    cluster,
    centres,
  };
};

/**
 * Role-Based Access Control Query Scoping (BRD v1.1 Section 5 & FR-1.3)
 * Enforces data visibility scoped strictly to user's reporting hierarchy:
 * - Central: National, full access (sees all zones)
 * - National Head: National strategic oversight (sees all zones)
 * - Regional Safety Officer (RSO): Full zone only (multiple RSOs in the same zone share access; NEVER sees other zones)
 * - Business Manager (BM): Cluster of areas within a zone
 * - Area Operations Manager (AOM): Own centre(s) / local area
 */
export const buildQueryWithRole = (req, extraFilters = {}) => {
  const { role, rawRole, zone: userZone, cluster: userCluster, centres: userCentres } = getUserScope(req);

  let filter = {};

  if (role === PREK_ROLES.CENTRAL || rawRole === "superAdmin") {
    // National, full access across all zones
  } else if (role === PREK_ROLES.NATIONAL_HEAD) {
    // National visibility across all zones
  } else if (role === PREK_ROLES.RSO) {
    // RSO is strictly scoped to their assigned zone (shared with any co-RSOs in the same zone)
    if (userZone) {
      const escapedZone = escapeRegex(userZone);
      filter.$or = [
        { zone: { $regex: `^${escapedZone}$`, $options: "i" } },
        { region: { $regex: `^${escapedZone}$`, $options: "i" } },
      ];
    } else {
      // Fail-closed: RSO without an assigned zone cannot view any zone's data
      filter.zone = { $in: [] };
    }
  } else if (role === PREK_ROLES.BM) {
    // Business Manager is scoped to cluster / assigned centres within zone
    const clusterConditions = [];
    if (userCluster) {
      clusterConditions.push({ cluster: userCluster });
    }
    if (userCentres.length > 0) {
      clusterConditions.push({ centreName: { $in: userCentres } });
    }
    if (userZone) {
      const escapedZone = escapeRegex(userZone);
      clusterConditions.push({ zone: { $regex: `^${escapedZone}$`, $options: "i" } });
    }
    if (clusterConditions.length > 0) {
      filter.$or = clusterConditions;
    } else {
      // Fail-closed: BM without cluster/centres/zone cannot view any data
      filter.zone = { $in: [] };
    }
  } else if (role === PREK_ROLES.AOM) {
    // AOM is scoped to own centre(s) / local area
    if (userCentres.length > 0) {
      filter.centreName = { $in: userCentres };
    } else if (req.user?.area) {
      filter.centreName = req.user.area;
    } else {
      // AOM without assigned centres cannot view peer or other centres' incidents
      filter.centreName = { $in: [] };
    }
  } else {
    throw new Error("You are not authorized to perform this action.");
  }

  // Merge incoming query parameters dynamically without allowing scope escape
  const queryFilters = { ...(req.query || {}) };

  const excludeFields = [
    "page",
    "limit",
    "search",
    "q",
    "sort",
    "month",
    "startDate",
    "endDate",
    "explain",
    "benchmark",
    "includeStats",
    "summary",
    "centre",
    "school",
    "schoolName",
    "type",
    "incidentType",
    "subCategory",
  ];
  excludeFields.forEach((field) => delete queryFilters[field]);

  const extraAndConditions = [];

  Object.keys(queryFilters).forEach((key) => {
    const val = queryFilters[key];
    if (val === undefined || val === "") return;

    const strVal = String(val).trim();
    if (!strVal || strVal.toLowerCase() === "all") return;

    // Never allow query params to overwrite mandatory RBAC scope keys
    if (key === "zone" || key === "region") {
      if (role === PREK_ROLES.RSO || role === PREK_ROLES.BM || role === PREK_ROLES.AOM) {
        // Intersect requested zone/region with mandatory role scope so cross-zone queries return 0 records
        const escapedVal = escapeRegex(strVal);
        extraAndConditions.push({
          $or: [
            { zone: { $regex: `^${escapedVal}$`, $options: "i" } },
            { region: { $regex: `^${escapedVal}$`, $options: "i" } },
          ],
        });
        return;
      }
    }

    if (key === "centreName" && role === PREK_ROLES.AOM) {
      extraAndConditions.push({
        centreName: { $regex: `^${escapeRegex(strVal)}$`, $options: "i" },
      });
      return;
    }

    filter[key] = val;
  });

  if (extraFilters && Object.keys(extraFilters).length > 0) {
    if (extraFilters.$or && filter.$or) {
      extraAndConditions.push(extraFilters);
    } else {
      Object.assign(filter, extraFilters);
    }
  }

  if (extraAndConditions.length > 0) {
    const baseFilter = { ...filter };
    filter = { $and: [baseFilter, ...extraAndConditions] };
  }

  return filter;
};

export default buildQueryWithRole;
