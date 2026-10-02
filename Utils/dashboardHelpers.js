import mongoose from "mongoose";

/**
 * Canonical Incident Type Mapping
 */
export const TYPE_NAME_MAP = {
  accident: "Accident",
  "behavioural issue": "Behavioural Issue",
  "behavioral issue": "Behavioural Issue",
  "near miss": "Near Miss",
  "unsubstantiated claims": "Unsubstantiated Claims",
  "unsubstantiated claim": "Unsubstantiated Claims",
  "health problem": "Health Problem",
  misconduct: "Misconduct",
  theft: "Theft",
  "corporal punishment": "Corporal Punishment",
  pocso: "POCSO",
  other: "Other",
};

export const STANDARD_REGIONS = ["North", "South", "East", "West"];

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Status Normalization Expression (for MongoDB Aggregation)
 * Maps known status variations to lowercase canonical tokens:
 * "open", "in progress", "closed", "resolved", or "unknown"
 * NOTE: Missing, null, or invalid statuses normalize to "unknown" (NOT "open")
 */
export const STATUS_NORMALIZATION_EXPR = {
  $let: {
    vars: {
      rawStatus: {
        $toLower: {
          $trim: {
            input: {
              $cond: [
                { $eq: [{ $type: "$status" }, "string"] },
                "$status",
                "",
              ],
            },
          },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          { case: { $eq: ["$$rawStatus", "open"] }, then: "open" },
          {
            case: {
              $in: [
                "$$rawStatus",
                ["in progress", "in-progress", "inprogress"],
              ],
            },
            then: "in progress",
          },
          {
            case: {
              $in: ["$$rawStatus", ["closed", "close"]],
            },
            then: "closed",
          },
          { case: { $eq: ["$$rawStatus", "resolved"] }, then: "resolved" },
        ],
        default: "unknown",
      },
    },
  },
};

/**
 * Severity Normalization Expression (for MongoDB Aggregation)
 * Maps known severity variations to lowercase tokens:
 * "low", "medium", "high", "critical", or "unknown"
 * NOTE: Missing, null, or invalid severities normalize to "unknown" (NOT "low")
 */
export const SEVERITY_NORMALIZATION_EXPR = {
  $let: {
    vars: {
      rawSev: {
        $toLower: {
          $trim: {
            input: {
              $cond: [
                { $eq: [{ $type: "$severity" }, "string"] },
                "$severity",
                "",
              ],
            },
          },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          { case: { $eq: ["$$rawSev", "low"] }, then: "low" },
          { case: { $eq: ["$$rawSev", "medium"] }, then: "medium" },
          { case: { $eq: ["$$rawSev", "high"] }, then: "high" },
          { case: { $eq: ["$$rawSev", "critical"] }, then: "critical" },
        ],
        default: "unknown",
      },
    },
  },
};

/**
 * Resolved Type Expression (for MongoDB Aggregation)
 * Checks subCategory -> incidentType -> type -> category -> "Other"
 */
export const TYPE_NORMALIZATION_EXPR = {
  $let: {
    vars: {
      rawType: {
        $trim: {
          input: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $type: "$subCategory" }, "string"] },
                  { $gt: [{ $strLenCP: { $trim: { input: "$subCategory" } } }, 0] },
                ],
              },
              "$subCategory",
              {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: "$incidentType" }, "string"] },
                      { $gt: [{ $strLenCP: { $trim: { input: "$incidentType" } } }, 0] },
                    ],
                  },
                  "$incidentType",
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $type: "$type" }, "string"] },
                          { $gt: [{ $strLenCP: { $trim: { input: "$type" } } }, 0] },
                        ],
                      },
                      "$type",
                      {
                        $cond: [
                          {
                            $and: [
                              { $eq: [{ $type: "$category" }, "string"] },
                              { $gt: [{ $strLenCP: { $trim: { input: "$category" } } }, 0] },
                            ],
                          },
                          "$category",
                          "Other",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
    in: {
      $cond: [{ $eq: ["$$rawType", ""] }, "Other", "$$rawType"],
    },
  },
};

/**
 * Resolved Region Expression (for MongoDB Aggregation)
 * Trims and lowercases region; defaults to "unknown" if missing
 */
export const REGION_NORMALIZATION_EXPR = {
  $toLower: {
    $trim: {
      input: {
        $cond: [
          { $eq: [{ $type: "$region" }, "string"] },
          "$region",
          "unknown",
        ],
      },
    },
  },
};

/**
 * Parse and validate incoming dashboard date range filters
 * Supports:
 * - startDate only, endDate only, or both
 * - YYYY-MM-DD date-only inputs (using UTC midnight boundaries, with $lt next-day midnight UTC)
 * - Full ISO 8601 timestamps with explicit timezone offsets
 * - Rejects invalid dates and startDate > endDate
 */
/**
 * Parse and validate incoming dashboard month filter
 * Supports:
 * - YYYY-MM (e.g. 2026-08)
 * - Mon-YY or Mon-YYYY (e.g. Aug-26 or Aug-2026)
 * - Returns null for "All" or empty
 */
export const parseDashboardMonth = (monthStr) => {
  if (!monthStr || typeof monthStr !== "string") return null;
  const trimmed = monthStr.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;

  let year, monthIndex;
  const yyyyMmMatch = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (yyyyMmMatch) {
    year = parseInt(yyyyMmMatch[1], 10);
    monthIndex = parseInt(yyyyMmMatch[2], 10) - 1;
  } else {
    const mmmYyMatch = trimmed.match(/^([a-zA-Z]{3})-(\d{2,4})$/);
    if (mmmYyMatch) {
      const mName = mmmYyMatch[1].toLowerCase();
      monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === mName);
      year = parseInt(mmmYyMatch[2], 10);
      if (year < 100) year += 2000;
    }
  }

  if (monthIndex === undefined || monthIndex < 0 || monthIndex > 11 || isNaN(year)) {
    return { error: `Invalid month format: "${monthStr}". Expected YYYY-MM or Mon-YY (e.g. 2026-08 or Aug-26).` };
  }

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = { value: new Date(Date.UTC(year, monthIndex + 1, 1)), op: "$lt" };
  return { start, end };
};

export const parseDashboardDateRange = (startDateStr, endDateStr) => {
  let start = null;
  let end = null;

  if (startDateStr !== undefined && startDateStr !== null && startDateStr !== "") {
    if (typeof startDateStr !== "string") {
      return { error: "Invalid startDate format. Please use ISO 8601 or YYYY-MM-DD format." };
    }
    const trimmed = startDateStr.trim();
    if (!trimmed) {
      return { error: "Invalid startDate format. Please use ISO 8601 or YYYY-MM-DD format." };
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      start = new Date(`${trimmed}T00:00:00.000Z`);
    } else {
      start = new Date(trimmed);
    }

    if (isNaN(start.getTime())) {
      return { error: "Invalid startDate format. Please use ISO 8601 or YYYY-MM-DD format." };
    }
  }

  if (endDateStr !== undefined && endDateStr !== null && endDateStr !== "") {
    if (typeof endDateStr !== "string") {
      return { error: "Invalid endDate format. Please use ISO 8601 or YYYY-MM-DD format." };
    }
    const trimmed = endDateStr.trim();
    if (!trimmed) {
      return { error: "Invalid endDate format. Please use ISO 8601 or YYYY-MM-DD format." };
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsedEnd = new Date(`${trimmed}T00:00:00.000Z`);
      if (isNaN(parsedEnd.getTime())) {
        return { error: "Invalid endDate format. Please use ISO 8601 or YYYY-MM-DD format." };
      }
      // Exclusive upper bound: next day midnight UTC ($lt)
      parsedEnd.setUTCDate(parsedEnd.getUTCDate() + 1);
      end = { value: parsedEnd, op: "$lt" };
    } else {
      const parsedEnd = new Date(trimmed);
      if (isNaN(parsedEnd.getTime())) {
        return { error: "Invalid endDate format. Please use ISO 8601 or YYYY-MM-DD format." };
      }
      end = { value: parsedEnd, op: "$lte" };
    }
  }

  // Validate start <= end
  if (start && end) {
    if (end.op === "$lt") {
      if (start >= end.value) {
        return { error: "startDate cannot be later than endDate." };
      }
    } else {
      if (start > end.value) {
        return { error: "startDate cannot be later than endDate." };
      }
    }
  }

  return { start, end };
};

/**
 * Build index-friendly effective date filter condition
 * Logic:
 * Effective date uses `date` if present, falling back to `createdAt`.
 * Creates an $or query that can utilize indexes on `date` and `createdAt`
 */
export const buildEffectiveDateFilter = (start, end) => {
  if (!start && !end) return null;

  const rangeCond = {};
  if (start) rangeCond.$gte = start;
  if (end) rangeCond[end.op] = end.value;

  return {
    $or: [
      { date: rangeCond },
      { date: null, createdAt: rangeCond },
    ],
  };
};

/**
 * Generate case-insensitive variants for direct B-Tree index matching
 * Avoids slow un-anchored regex scans while supporting historical unnormalized entries
 */
export const getRegionVariants = (region) => {
  if (!region) return [];
  const trimmed = String(region).trim();
  const lower = trimmed.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  const upper = lower.toUpperCase();
  return Array.from(new Set([trimmed, lower, capitalized, upper]));
};

export const getCategoryVariants = (category) => {
  if (!category) return [];
  const lower = String(category).trim().toLowerCase();
  if (lower === "incident") {
    return ["Incident", "incident", "INCIDENT"];
  }
  if (lower === "near miss" || lower === "near-miss" || lower === "nearmiss") {
    return ["Near Miss", "near miss", "Near-Miss", "near-miss", "nearmiss", "NEAR MISS"];
  }
  if (lower === "hazard & risk" || lower === "hazard and risk" || lower === "hazard") {
    return [
      "Hazard & Risk", "hazard & risk", "Hazard and Risk", "hazard and risk",
      "Hazard", "hazard", "HAZARD & RISK"
    ];
  }
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return Array.from(new Set([String(category).trim(), lower, capitalized, String(category).toUpperCase()]));
};

/**
 * Validate and safely cast an ID to mongoose.Types.ObjectId
 */
export const safeObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const str = String(id).trim();
  if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
    return new mongoose.Types.ObjectId(str);
  }
  return null;
};

/**
 * Build single-pass $facet aggregation pipeline with shared pre-normalization stage
 * Reuses the same filtered dataset across all aggregation branches without redundant scans
 */
export const buildFacetPipeline = (filter) => {
  return [
    { $match: filter },
    {
      $addFields: {
        effectiveDate: { $ifNull: ["$date", "$createdAt"] },
        normalizedSeverity: SEVERITY_NORMALIZATION_EXPR,
        normalizedStatus: STATUS_NORMALIZATION_EXPR,
        resolvedType: TYPE_NORMALIZATION_EXPR,
        resolvedRegion: REGION_NORMALIZATION_EXPR,
      },
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalIncidents: { $sum: 1 },
              openCases: {
                $sum: {
                  $cond: [
                    { $in: ["$normalizedStatus", ["open", "in progress"]] },
                    1,
                    0,
                  ],
                },
              },
              closedCases: {
                $sum: {
                  $cond: [
                    { $in: ["$normalizedStatus", ["closed", "resolved"]] },
                    1,
                    0,
                  ],
                },
              },
              highOrCritical: {
                $sum: {
                  $cond: [
                    { $in: ["$normalizedSeverity", ["high", "critical"]] },
                    1,
                    0,
                  ],
                },
              },
              lowSeverity: {
                $sum: { $cond: [{ $eq: ["$normalizedSeverity", "low"] }, 1, 0] },
              },
              mediumSeverity: {
                $sum: { $cond: [{ $eq: ["$normalizedSeverity", "medium"] }, 1, 0] },
              },
              highSeverity: {
                $sum: { $cond: [{ $eq: ["$normalizedSeverity", "high"] }, 1, 0] },
              },
              criticalSeverity: {
                $sum: { $cond: [{ $eq: ["$normalizedSeverity", "critical"] }, 1, 0] },
              },
            },
          },
        ],
        trends: [
          {
            $group: {
              _id: {
                year: { $year: "$effectiveDate" },
                month: { $month: "$effectiveDate" },
              },
              total: { $sum: 1 },
              open: {
                $sum: {
                  $cond: [
                    { $in: ["$normalizedStatus", ["open", "in progress"]] },
                    1,
                    0,
                  ],
                },
              },
              closed: {
                $sum: {
                  $cond: [
                    { $in: ["$normalizedStatus", ["closed", "resolved"]] },
                    1,
                    0,
                  ],
                },
              },
              low: { $sum: { $cond: [{ $eq: ["$normalizedSeverity", "low"] }, 1, 0] } },
              medium: { $sum: { $cond: [{ $eq: ["$normalizedSeverity", "medium"] }, 1, 0] } },
              high: { $sum: { $cond: [{ $eq: ["$normalizedSeverity", "high"] }, 1, 0] } },
              critical: { $sum: { $cond: [{ $eq: ["$normalizedSeverity", "critical"] }, 1, 0] } },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ],
        typeByRegion: [
          {
            $group: {
              _id: {
                type: "$resolvedType",
                region: "$resolvedRegion",
              },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];
};

/**
 * Format raw aggregation results into the standardized Dashboard response contract
 */
export const formatDashboardResponse = (rawResult) => {
  const facetData = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const stats = facetData?.summary?.[0] || {};
  const trendResults = facetData?.trends || [];
  const typeByRegionResults = facetData?.typeByRegion || [];

  const totalIncidents = stats.totalIncidents || 0;
  const openCases = stats.openCases || 0;
  const closedCases = stats.closedCases || 0;
  const highOrCritical = stats.highOrCritical || 0;
  const lowSeverity = stats.lowSeverity || 0;
  const mediumSeverity = stats.mediumSeverity || 0;
  const highSeverity = stats.highSeverity || 0;
  const criticalSeverity = stats.criticalSeverity || 0;

  const closureRate = totalIncidents > 0
    ? `${Math.round((closedCases / totalIncidents) * 100)}%`
    : "0%";

  const severitySplit = [
    { name: "Low", value: lowSeverity },
    { name: "Medium", value: mediumSeverity },
    { name: "High", value: highSeverity },
    { name: "Critical", value: criticalSeverity },
  ];

  const incidentTrendBySeverity = trendResults.map((item) => {
    const year = item._id?.year;
    const monthNum = item._id?.month;
    const monthName =
      monthNum && monthNum >= 1 && monthNum <= 12
        ? MONTH_NAMES[monthNum - 1]
        : "Unknown";
    const shortYear = year ? String(year).slice(-2) : "";
    const monthLabel = `${monthName}-${shortYear}`;
    const monthKey = year && monthNum ? `${year}-${String(monthNum).padStart(2, "0")}` : monthLabel;
    const total = item.total || 0;
    const open = item.open || 0;
    const closed = item.closed || 0;
    const closureRate = total > 0 ? `${Math.round((closed / total) * 100)}%` : "0%";
    const low = item.low || 0;
    const medium = item.medium || 0;
    const high = item.high || 0;
    const critical = item.critical || 0;

    return {
      month: monthLabel,
      monthKey,
      key: monthKey,
      label: monthLabel,
      total,
      open,
      closed,
      closureRate,
      low,
      medium,
      high,
      critical,
      Low: low,
      Medium: medium,
      High: high,
      Critical: critical,
    };
  });

  // Calculate incidentTypeByRegion matrix, incidentsByType, and regionComparison
  const matrixMap = new Map();
  const typeCountMap = new Map();
  const regionCountMap = new Map(STANDARD_REGIONS.map((r) => [r, 0]));

  typeByRegionResults.forEach((item) => {
    const rawType = String(item._id?.type || "").trim();
    const rawRegion = String(item._id?.region || "").trim().toLowerCase();
    const count = item.count || 0;
    if (!rawType) return;

    const canonicalType = TYPE_NAME_MAP[rawType.toLowerCase()] || rawType;

    // 1. Matrix row
    if (!matrixMap.has(canonicalType)) {
      matrixMap.set(canonicalType, {
        type: canonicalType,
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        central: 0,
        total: 0,
      });
    }
    const row = matrixMap.get(canonicalType);
    if (rawRegion === "north") row.north += count;
    else if (rawRegion === "south") row.south += count;
    else if (rawRegion === "east") row.east += count;
    else if (rawRegion === "west") row.west += count;
    else if (rawRegion === "central") row.central += count;
    row.total += count;

    // 2. Incident by type total
    typeCountMap.set(canonicalType, (typeCountMap.get(canonicalType) || 0) + count);

    // 3. Region comparison (North, South, East, West - excluding central and other)
    const stdRegionMatch = STANDARD_REGIONS.find((r) => r.toLowerCase() === rawRegion);
    if (stdRegionMatch) {
      regionCountMap.set(stdRegionMatch, regionCountMap.get(stdRegionMatch) + count);
    }
  });

  const incidentsByType = Array.from(typeCountMap.entries())
    .map(([name, count]) => ({ name, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const regionComparison = Array.from(regionCountMap.entries())
    .map(([region, count]) => ({ region, count }));

  const incidentTypeByRegion = Array.from(matrixMap.values())
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));

  return {
    totalIncidents,
    openCases,
    highOrCritical,
    closureRate,
    severitySplit,
    incidentTrendBySeverity,
    incidentsByType,
    regionComparison,
    incidentTypeByRegion,
  };
};

/**
 * Safely parse MongoDB explain plan output across different MongoDB versions and topologies
 */
export const parseMongoExplainStats = (explainResult) => {
  if (!explainResult) return null;

  const cursorStats = explainResult?.stages?.[0]?.["$cursor"]?.executionStats;
  const topStats = explainResult?.executionStats;
  const statsBlock = cursorStats || topStats;

  const executionTimeMillis =
    statsBlock?.executionTimeMillis ??
    explainResult?.stages?.[0]?.executionTimeMillisEstimate ??
    explainResult?.stages?.[0]?.["$cursor"]?.executionTimeMillisEstimate ??
    0;

  const totalDocsExamined = statsBlock?.totalDocsExamined ?? 0;
  const totalKeysExamined = statsBlock?.totalKeysExamined ?? 0;

  let stage =
    statsBlock?.executionStages?.stage ||
    explainResult?.stages?.[0]?.stage ||
    "AGGREGATE";

  // Discover indexes used from query planner or execution stages
  const indexesUsed = new Set();
  const searchTree = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.indexName && typeof node.indexName === "string") {
      indexesUsed.add(node.indexName);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          child.forEach(searchTree);
        } else {
          searchTree(child);
        }
      }
    }
  };

  searchTree(explainResult?.queryPlanner);
  searchTree(explainResult?.stages?.[0]?.["$cursor"]?.queryPlanner);
  searchTree(statsBlock?.executionStages);

  return {
    executionTimeMillis,
    totalDocsExamined,
    totalKeysExamined,
    stage,
    indexesUsed: Array.from(indexesUsed),
  };
};
