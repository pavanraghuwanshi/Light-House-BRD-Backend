import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  parseDashboardDateRange,
  buildEffectiveDateFilter,
  getRegionVariants,
  getCategoryVariants,
  safeObjectId,
  buildFacetPipeline,
  formatDashboardResponse,
  parseMongoExplainStats,
  TYPE_NAME_MAP,
  STANDARD_REGIONS,
} from "../Utils/dashboardHelpers.js";
import {
  normalizeStatus,
  normalizeSeverity,
  normalizeCategory,
  normalizeRegion,
} from "../Models/incident.js";
import { buildQueryWithRole } from "../Utils/roleResolver.js";

describe("1. Status and Severity Normalization (Unit Tests)", () => {
  it("normalizes standard status values correctly", () => {
    assert.equal(normalizeStatus("Open"), "Open");
    assert.equal(normalizeStatus("open"), "Open");
    assert.equal(normalizeStatus(" OPEN "), "Open");
    assert.equal(normalizeStatus("In Progress"), "In Progress");
    assert.equal(normalizeStatus("in-progress"), "In Progress");
    assert.equal(normalizeStatus("inprogress"), "In Progress");
    assert.equal(normalizeStatus("Resolved"), "Resolved");
    assert.equal(normalizeStatus("resolved"), "Resolved");
    assert.equal(normalizeStatus("Closed"), "Closed");
    assert.equal(normalizeStatus("close"), "Closed");
  });

  it("classifies missing or invalid status values as 'unknown' (NOT 'open')", () => {
    assert.equal(normalizeStatus(null), "unknown");
    assert.equal(normalizeStatus(undefined), "unknown");
    assert.equal(normalizeStatus(""), "unknown");
    assert.equal(normalizeStatus("   "), "unknown");
    assert.equal(normalizeStatus("invalid_status"), "unknown");
    assert.equal(normalizeStatus("pending"), "unknown");
  });

  it("normalizes standard severity values correctly", () => {
    assert.equal(normalizeSeverity("Low"), "Low");
    assert.equal(normalizeSeverity("low"), "Low");
    assert.equal(normalizeSeverity(" LOW "), "Low");
    assert.equal(normalizeSeverity("Medium"), "Medium");
    assert.equal(normalizeSeverity("High"), "High");
    assert.equal(normalizeSeverity("Critical"), "Critical");
    assert.equal(normalizeSeverity("critical"), "Critical");
  });

  it("classifies missing or invalid severity values as 'unknown' (NOT 'low')", () => {
    assert.equal(normalizeSeverity(null), "unknown");
    assert.equal(normalizeSeverity(undefined), "unknown");
    assert.equal(normalizeSeverity(""), "unknown");
    assert.equal(normalizeSeverity("   "), "unknown");
    assert.equal(normalizeSeverity("urgent"), "unknown");
    assert.equal(normalizeSeverity("extreme"), "unknown");
  });
});

describe("2. Date Range Parsing and Effective Date Filtering", () => {
  it("parses valid start-date only (YYYY-MM-DD to UTC midnight)", () => {
    const { start, end, error } = parseDashboardDateRange("2026-08-01", null);
    assert.equal(error, undefined);
    assert.equal(start.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(end, null);
  });

  it("parses valid end-date only with exclusive next-day boundary ($lt)", () => {
    const { start, end, error } = parseDashboardDateRange(null, "2026-08-31");
    assert.equal(error, undefined);
    assert.equal(start, null);
    assert.equal(end.op, "$lt");
    assert.equal(end.value.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("parses combined date filter correctly", () => {
    const { start, end, error } = parseDashboardDateRange("2026-08-01", "2026-08-31");
    assert.equal(error, undefined);
    assert.equal(start.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(end.op, "$lt");
    assert.equal(end.value.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("rejects invalid startDate format", () => {
    const { error } = parseDashboardDateRange("not-a-date", "2026-08-31");
    assert.match(error, /Invalid startDate format/);
  });

  it("rejects invalid endDate format", () => {
    const { error } = parseDashboardDateRange("2026-08-01", "2026-99-99");
    assert.match(error, /Invalid endDate format/);
  });

  it("rejects startDate later than endDate", () => {
    const { error } = parseDashboardDateRange("2026-09-01", "2026-08-31");
    assert.equal(error, "startDate cannot be later than endDate.");
  });

  it("handles ISO 8601 with timezone offsets accurately in UTC", () => {
    // 2026-08-01T10:00:00+05:30 -> 2026-08-01T04:30:00.000Z
    const { start, error } = parseDashboardDateRange("2026-08-01T10:00:00+05:30", null);
    assert.equal(error, undefined);
    assert.equal(start.toISOString(), "2026-08-01T04:30:00.000Z");
  });

  it("builds consistent effective date query utilizing date and createdAt fallback", () => {
    const { start, end } = parseDashboardDateRange("2026-08-01", "2026-08-31");
    const dateFilter = buildEffectiveDateFilter(start, end);

    assert.ok(dateFilter.$or, "$or clause must be present");
    assert.equal(dateFilter.$or.length, 2);

    // Branch 1: date in range
    assert.deepEqual(dateFilter.$or[0].date, {
      $gte: new Date("2026-08-01T00:00:00.000Z"),
      $lt: new Date("2026-09-01T00:00:00.000Z"),
    });

    // Branch 2: date is null/missing, createdAt in range
    assert.equal(dateFilter.$or[1].date, null);
    assert.deepEqual(dateFilter.$or[1].createdAt, {
      $gte: new Date("2026-08-01T00:00:00.000Z"),
      $lt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });
});

describe("3. Region and Category Filtering (Index-Friendly Variants)", () => {
  it("generates direct matching variants for region without regex", () => {
    const variants = getRegionVariants("north");
    assert.ok(variants.includes("north"));
    assert.ok(variants.includes("North"));
    assert.ok(variants.includes("NORTH"));
  });

  it("generates direct matching variants for categories including Near Miss and Hazard & Risk", () => {
    const incidentVariants = getCategoryVariants("Incident");
    assert.ok(incidentVariants.includes("Incident"));
    assert.ok(incidentVariants.includes("incident"));

    const nearMissVariants = getCategoryVariants("near-miss");
    assert.ok(nearMissVariants.includes("Near Miss"));
    assert.ok(nearMissVariants.includes("near miss"));
    assert.ok(nearMissVariants.includes("Near-Miss"));

    const hazardVariants = getCategoryVariants("hazard & risk");
    assert.ok(hazardVariants.includes("Hazard & Risk"));
    assert.ok(hazardVariants.includes("hazard and risk"));
  });
});

describe("4. Role-Based Access Control Filtering", () => {
  const schoolObjectId = new mongoose.Types.ObjectId().toString();
  const branchObjectId = new mongoose.Types.ObjectId().toString();
  const parentObjectId = new mongoose.Types.ObjectId().toString();

  it("applies no role restrictions for superAdmin", () => {
    const req = { user: { role: "superAdmin" }, query: {} };
    const filter = buildQueryWithRole(req);
    assert.equal(filter.schoolId, undefined);
    assert.equal(filter.branchId, undefined);
  });

  it("applies schoolId filter for school role", () => {
    const req = { user: { role: "school", id: schoolObjectId }, query: {} };
    const filter = buildQueryWithRole(req);
    assert.equal(filter.schoolId, schoolObjectId);
  });

  it("applies branchId $in filter for branchGroup role", () => {
    const req = {
      user: { role: "branchGroup", AssignedBranch: [branchObjectId] },
      query: {},
    };
    const filter = buildQueryWithRole(req);
    assert.deepEqual(filter.branchId, { $in: [branchObjectId] });
  });

  it("applies schoolId and branchId filters for branch role", () => {
    const req = {
      user: { role: "branch", schoolId: schoolObjectId, id: branchObjectId },
      query: {},
    };
    const filter = buildQueryWithRole(req);
    assert.equal(filter.schoolId, schoolObjectId);
    assert.equal(filter.branchId, branchObjectId);
  });

  it("applies schoolId, branchId, and parentId filters for parent role", () => {
    const req = {
      user: {
        role: "parent",
        schoolId: schoolObjectId,
        branchId: branchObjectId,
        id: parentObjectId,
      },
      query: {},
    };
    const filter = buildQueryWithRole(req);
    assert.equal(filter.schoolId, schoolObjectId);
    assert.equal(filter.branchId, branchObjectId);
    assert.equal(filter.parentId, parentObjectId);
  });

  it("throws unauthorized error for invalid or unknown role", () => {
    const req = { user: { role: "supervisor" }, query: {} };
    assert.throws(() => buildQueryWithRole(req), /not authorized/);
  });
});

describe("5. Dashboard Response Formatting & Summary Aggregation Edge Cases", () => {
  it("formats zero-value defaults when dataset is completely empty", () => {
    const emptyResult = [
      {
        summary: [],
        trends: [],
        typeByRegion: [],
      },
    ];

    const formatted = formatDashboardResponse(emptyResult);
    assert.equal(formatted.totalIncidents, 0);
    assert.equal(formatted.openCases, 0);
    assert.equal(formatted.highOrCritical, 0);
    assert.equal(formatted.closureRate, "0%");
    assert.deepEqual(formatted.severitySplit, [
      { name: "Low", value: 0 },
      { name: "Medium", value: 0 },
      { name: "High", value: 0 },
      { name: "Critical", value: 0 },
    ]);
    assert.deepEqual(formatted.incidentTrendBySeverity, []);
    assert.deepEqual(formatted.incidentsByType, []);
    assert.deepEqual(formatted.regionComparison, [
      { region: "North", count: 0 },
      { region: "South", count: 0 },
      { region: "East", count: 0 },
      { region: "West", count: 0 },
    ]);
    assert.deepEqual(formatted.incidentTypeByRegion, []);
  });

  it("calculates 100% closure rate when all incidents are closed", () => {
    const mockResult = [
      {
        summary: [
          {
            totalIncidents: 10,
            openCases: 0,
            closedCases: 10,
            highOrCritical: 2,
            lowSeverity: 5,
            mediumSeverity: 3,
            highSeverity: 1,
            criticalSeverity: 1,
          },
        ],
        trends: [],
        typeByRegion: [],
      },
    ];

    const formatted = formatDashboardResponse(mockResult);
    assert.equal(formatted.totalIncidents, 10);
    assert.equal(formatted.openCases, 0);
    assert.equal(formatted.closureRate, "100%");
  });

  it("calculates 0% closure rate when all incidents are open", () => {
    const mockResult = [
      {
        summary: [
          {
            totalIncidents: 8,
            openCases: 8,
            closedCases: 0,
            highOrCritical: 4,
            lowSeverity: 2,
            mediumSeverity: 2,
            highSeverity: 2,
            criticalSeverity: 2,
          },
        ],
        trends: [],
        typeByRegion: [],
      },
    ];

    const formatted = formatDashboardResponse(mockResult);
    assert.equal(formatted.totalIncidents, 8);
    assert.equal(formatted.openCases, 8);
    assert.equal(formatted.closureRate, "0%");
  });

  it("handles mixed statuses and correctly derives closureRate", () => {
    const mockResult = [
      {
        summary: [
          {
            totalIncidents: 6,
            openCases: 3,
            closedCases: 3,
            highOrCritical: 2,
            lowSeverity: 1,
            mediumSeverity: 3,
            highSeverity: 1,
            criticalSeverity: 1,
          },
        ],
        trends: [],
        typeByRegion: [],
      },
    ];

    const formatted = formatDashboardResponse(mockResult);
    assert.equal(formatted.totalIncidents, 6);
    assert.equal(formatted.openCases, 3);
    assert.equal(formatted.closureRate, "50%");
  });

  it("correctly derives type x region matrix and region comparison (excluding central from comparison)", () => {
    const mockResult = [
      {
        summary: [{ totalIncidents: 5, closedCases: 2 }],
        trends: [
          {
            _id: { year: 2026, month: 8 },
            total: 5,
            low: 1,
            medium: 2,
            high: 1,
            critical: 1,
          },
        ],
        typeByRegion: [
          { _id: { type: "accident", region: "north" }, count: 2 },
          { _id: { type: "Accident", region: "south" }, count: 1 },
          { _id: { type: "theft", region: "central" }, count: 1 },
          { _id: { type: "near miss", region: "east" }, count: 1 },
        ],
      },
    ];

    const formatted = formatDashboardResponse(mockResult);

    // Verify incidentTrendBySeverity month label formatting
    assert.equal(formatted.incidentTrendBySeverity[0].month, "Aug-26");
    assert.equal(formatted.incidentTrendBySeverity[0].total, 5);

    // Verify incidentsByType canonical naming and sorting
    assert.equal(formatted.incidentsByType[0].name, "Accident");
    assert.equal(formatted.incidentsByType[0].count, 3);

    // Verify regionComparison has North: 2, South: 1, East: 1, West: 0, and does NOT include central
    const northEntry = formatted.regionComparison.find((r) => r.region === "North");
    const southEntry = formatted.regionComparison.find((r) => r.region === "South");
    const eastEntry = formatted.regionComparison.find((r) => r.region === "East");
    const westEntry = formatted.regionComparison.find((r) => r.region === "West");
    const centralEntry = formatted.regionComparison.find((r) => r.region.toLowerCase() === "central");

    assert.equal(northEntry.count, 2);
    assert.equal(southEntry.count, 1);
    assert.equal(eastEntry.count, 1);
    assert.equal(westEntry.count, 0);
    assert.equal(centralEntry, undefined, "Central must be excluded from regionComparison");

    // Verify incidentTypeByRegion matrix contains central counts
    const accidentRow = formatted.incidentTypeByRegion.find((r) => r.type === "Accident");
    const theftRow = formatted.incidentTypeByRegion.find((r) => r.type === "Theft");

    assert.equal(accidentRow.north, 2);
    assert.equal(accidentRow.south, 1);
    assert.equal(accidentRow.total, 3);

    assert.equal(theftRow.central, 1);
    assert.equal(theftRow.total, 1);
  });
});

describe("6. Explain Plan Metric Parser", () => {
  it("extracts performance metrics safely from MongoDB explain plan", () => {
    const mockExplain = {
      stages: [
        {
          $cursor: {
            queryPlanner: {
              winningPlan: {
                stage: "FETCH",
                inputStage: {
                  stage: "IXSCAN",
                  indexName: "schoolId_1_date_-1",
                },
              },
            },
            executionStats: {
              executionTimeMillis: 4,
              totalDocsExamined: 25,
              totalKeysExamined: 25,
              executionStages: {
                stage: "FETCH",
              },
            },
          },
        },
      ],
    };

    const stats = parseMongoExplainStats(mockExplain);
    assert.equal(stats.executionTimeMillis, 4);
    assert.equal(stats.totalDocsExamined, 25);
    assert.equal(stats.totalKeysExamined, 25);
    assert.equal(stats.stage, "FETCH");
    assert.ok(stats.indexesUsed.includes("schoolId_1_date_-1"));
  });
});

describe("7. Safe ObjectId Conversion", () => {
  it("validates valid 24-char hex ObjectIds", () => {
    const validHex = "507f1f77bcf86cd799439011";
    const casted = safeObjectId(validHex);
    assert.ok(casted instanceof mongoose.Types.ObjectId);
    assert.equal(casted.toString(), validHex);
  });

  it("returns null for malformed or invalid IDs", () => {
    assert.equal(safeObjectId("invalid-id"), null);
    assert.equal(safeObjectId("123"), null);
    assert.equal(safeObjectId(""), null);
    assert.equal(safeObjectId(null), null);
    assert.equal(safeObjectId(undefined), null);
  });
});
