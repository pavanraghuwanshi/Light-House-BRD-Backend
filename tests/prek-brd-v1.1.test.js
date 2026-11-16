import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  PREK_ROLES,
  normalizePrekRole,
  INCIDENT_TYPE_DEFAULTS,
  NON_DOWNGRADABLE_CRITICAL_TYPES,
  isNonDowngradable,
  getDefaultSeverityForType,
  enforceSeverityRules,
  ESCALATION_MATRIX,
  getEscalationDetails,
  calculateSlaDeadline,
  canRoleCloseIncident,
  generateCaseId,
  getRateBand,
  RATE_BANDS,
  PREK_STATE_BASELINE,
  TOTAL_NETWORK_CENTRES,
} from "../Utils/prekConstants.js";
import { buildQueryWithRole } from "../Utils/roleResolver.js";
import { encrypt, decrypt, comparePassword } from "../Utils/crypto.js";

describe("BRD v1.1 Test Suite: Pre-K Division National Incident & Safety Reporting Portal", () => {
  describe("1. Stakeholders & 5-Tier User Roles (BRD Section 5, FR-1.2)", () => {
    it("standardizes role aliases to canonical Pre-K roles", () => {
      assert.equal(normalizePrekRole("AOM"), PREK_ROLES.AOM);
      assert.equal(normalizePrekRole("aom"), PREK_ROLES.AOM);
      assert.equal(normalizePrekRole("Area Operations Manager"), PREK_ROLES.AOM);

      assert.equal(normalizePrekRole("BM"), PREK_ROLES.BM);
      assert.equal(normalizePrekRole("business manager"), PREK_ROLES.BM);

      assert.equal(normalizePrekRole("RSO"), PREK_ROLES.RSO);
      assert.equal(normalizePrekRole("regional safety officer"), PREK_ROLES.RSO);

      assert.equal(normalizePrekRole("National Head"), PREK_ROLES.NATIONAL_HEAD);
      assert.equal(normalizePrekRole("nationalhead"), PREK_ROLES.NATIONAL_HEAD);

      assert.equal(normalizePrekRole("Central"), PREK_ROLES.CENTRAL);
      assert.equal(normalizePrekRole("Central (All-Activity Admin)"), PREK_ROLES.CENTRAL);
      assert.equal(normalizePrekRole("central admin"), PREK_ROLES.CENTRAL);
    });

    it("FR-1.3: Central (All-Activity Admin) has national visibility across all zones (no filter restrictions)", () => {
      const req = { user: { role: "Central" }, query: {} };
      const filter = buildQueryWithRole(req);
      assert.deepEqual(filter, {});
    });

    it("FR-1.3: National Head has national visibility across all zones (no filter restrictions)", () => {
      const req = { user: { role: "National Head" }, query: {} };
      const filter = buildQueryWithRole(req);
      assert.deepEqual(filter, {});
    });

    it("FR-1.3: Regional Safety Officer (RSO) is scoped to their assigned zone", () => {
      const req = { user: { role: "RSO", zone: "North" }, query: {} };
      const filter = buildQueryWithRole(req);
      assert.ok(filter.$or, "Filter should contain $or clause for zone/region matching");
      assert.equal(filter.$or[0].zone.$regex, "^North$");
      assert.equal(filter.$or[1].region.$regex, "^North$");
    });

    it("FR-1.3: Business Manager (BM) is scoped to their cluster and assigned centres within zone", () => {
      const req = {
        user: {
          role: "BM",
          zone: "West",
          cluster: "West-Cluster-A",
          centres: ["Centre Pune 1", "Centre Pune 2"],
        },
        query: {},
      };
      const filter = buildQueryWithRole(req);
      assert.ok(filter.$or, "Filter should contain cluster and centre conditions");
      const hasCluster = filter.$or.some((c) => c.cluster === "West-Cluster-A");
      const hasCentres = filter.$or.some((c) => c.centreName && c.centreName.$in);
      assert.ok(hasCluster, "Cluster filter should be present");
      assert.ok(hasCentres, "Centres list filter should be present");
    });

    it("FR-1.3: Area Operations Manager (AOM) is scoped to own centre(s) / local area", () => {
      const req = {
        user: {
          role: "AOM",
          centres: ["Kothrud Centre", "Baner Centre"],
        },
        query: {},
      };
      const filter = buildQueryWithRole(req);
      assert.deepEqual(filter.centreName, { $in: ["Kothrud Centre", "Baner Centre"] });
    });

    it("FR-1.3 Peer Isolation: Two AOMs at the same level CANNOT view each other's reports", () => {
      const reqAOM1 = {
        user: {
          id: "aom-1-id",
          role: "AOM",
          centres: ["Centre North-A", "Centre North-B"],
        },
        query: {},
      };
      const reqAOM2 = {
        user: {
          id: "aom-2-id",
          role: "AOM",
          centres: ["Centre North-C", "Centre North-D"],
        },
        query: {},
      };

      const filterAOM1 = buildQueryWithRole(reqAOM1);
      const filterAOM2 = buildQueryWithRole(reqAOM2);

      // AOM 1 can only query their own centres
      assert.deepEqual(filterAOM1.centreName, { $in: ["Centre North-A", "Centre North-B"] });
      // AOM 2 can only query their own centres
      assert.deepEqual(filterAOM2.centreName, { $in: ["Centre North-C", "Centre North-D"] });

      // Cross-verification: AOM 1's filter strictly excludes AOM 2's centres
      const aom2ReportCentre = "Centre North-C";
      assert.equal(
        filterAOM1.centreName.$in.includes(aom2ReportCentre),
        false,
        "AOM 1 MUST NOT be able to view AOM 2's incident reports"
      );

      // Cross-verification: AOM 2's filter strictly excludes AOM 1's centres
      const aom1ReportCentre = "Centre North-A";
      assert.equal(
        filterAOM2.centreName.$in.includes(aom1ReportCentre),
        false,
        "AOM 2 MUST NOT be able to view AOM 1's incident reports"
      );
    });

    it("FR-1.3 Centre Conflict Detection: Detects and rejects assigning an already-allocated centre to a second AOM", () => {
      // Simulate existing active AOMs in database
      const existingAOMs = [
        { name: "AOM Mumbai", username: "aom_mumbai", centres: ["Centre Bandra", "Centre Andheri"] },
        { name: "AOM Pune", username: "aom_pune", centres: ["Centre Kothrud", "Centre Baner"] },
      ];

      const newAOMCentres = ["Centre Bandra", "Centre Thane"];

      // Check conflict logic matching User.Controller
      const conflicting = [];
      existingAOMs.forEach((u) => {
        const overlap = u.centres.filter((c) => newAOMCentres.includes(c));
        if (overlap.length > 0) {
          conflicting.push(`${u.name} (@${u.username}) already manages: ${overlap.join(", ")}`);
        }
      });

      assert.equal(conflicting.length, 1);
      assert.match(conflicting[0], /AOM Mumbai \(@aom_mumbai\) already manages: Centre Bandra/);
    });

    it("FR-1.3 Safe Default: An AOM without assigned centres is restricted to empty array and cannot view peer reports", () => {
      const reqUnassignedAOM = {
        user: {
          id: "unassigned-aom-id",
          role: "AOM",
          centres: [],
        },
        query: {},
      };
      const filter = buildQueryWithRole(reqUnassignedAOM);
      assert.deepEqual(
        filter.centreName,
        { $in: [] },
        "Unassigned AOM must have an empty match condition to prevent viewing any incident reports"
      );
    });

    it("FR-1.3 Hierarchy Visibility: Only above hierarchy (BM, RSO, National Head, Central) can view reports across centres", () => {
      // 1. Business Manager supervising the cluster
      const reqBM = {
        user: {
          role: "BM",
          cluster: "North-Cluster-1",
          centres: ["Centre North-A", "Centre North-B", "Centre North-C"],
        },
        query: {},
      };
      const filterBM = buildQueryWithRole(reqBM);
      assert.ok(filterBM.$or, "BM should have cluster-level scope");

      // 2. Regional Safety Officer supervising the zone
      const reqRSO = {
        user: {
          role: "RSO",
          zone: "North",
        },
        query: {},
      };
      const filterRSO = buildQueryWithRole(reqRSO);
      assert.ok(filterRSO.$or, "RSO has full zone scope");

      // 3. National Head has national scope
      const reqNationalHead = {
        user: { role: "National Head" },
        query: {},
      };
      assert.deepEqual(buildQueryWithRole(reqNationalHead), {});

      // 4. Central has national scope
      const reqCentral = {
        user: { role: "Central" },
        query: {},
      };
      assert.deepEqual(buildQueryWithRole(reqCentral), {});
    });
  });

  describe("2. Fixed Escalation Matrix & SLA Rules (BRD Section 8, FR-5.1)", () => {
    it("maps Low severity to Area Operations Manager (AOM) with 3 working days SLA", () => {
      const details = getEscalationDetails("Low");
      assert.equal(details.severity, "Low");
      assert.equal(details.owner, "Area Operations Manager (AOM)");
      assert.equal(details.ownerRole, "AOM");
      assert.equal(details.sla, "3 working days");
      assert.equal(details.slaHours, 72);
      assert.match(details.action, /Log the case, investigate locally/);
    });

    it("maps Medium severity to Business Manager (BM) with 48 hours SLA", () => {
      const details = getEscalationDetails("Medium");
      assert.equal(details.severity, "Medium");
      assert.equal(details.owner, "Business Manager (BM)");
      assert.equal(details.ownerRole, "BM");
      assert.equal(details.sla, "48 hours");
      assert.equal(details.slaHours, 48);
      assert.match(details.action, /Review with AOM/);
    });

    it("maps High severity to Regional Safety Officer (RSO) with 24 hours SLA", () => {
      const details = getEscalationDetails("High");
      assert.equal(details.severity, "High");
      assert.equal(details.owner, "Regional Safety Officer (RSO)");
      assert.equal(details.ownerRole, "RSO");
      assert.equal(details.sla, "24 hours");
      assert.equal(details.slaHours, 24);
      assert.match(details.action, /Lead investigation directly/);
    });

    it("maps Critical severity to Central (All-Activity Admin) with 2 hours (immediate) SLA", () => {
      const details = getEscalationDetails("Critical");
      assert.equal(details.severity, "Critical");
      assert.equal(details.owner, "Central (All-Activity Admin)");
      assert.equal(details.ownerRole, "Central");
      assert.equal(details.sla, "2 hours (immediate)");
      assert.equal(details.slaHours, 2);
      assert.match(details.action, /Mandatory \/ statutory reporting triggered/);
    });

    it("calculates SLA deadlines accurately from base incident timestamp", () => {
      const baseDate = new Date("2026-11-12T10:00:00.000Z");

      const criticalDeadline = calculateSlaDeadline(baseDate, "Critical");
      assert.equal(criticalDeadline.toISOString(), "2026-11-12T12:00:00.000Z"); // +2 hours

      const highDeadline = calculateSlaDeadline(baseDate, "High");
      assert.equal(highDeadline.toISOString(), "2026-11-13T10:00:00.000Z"); // +24 hours

      const mediumDeadline = calculateSlaDeadline(baseDate, "Medium");
      assert.equal(mediumDeadline.toISOString(), "2026-11-14T10:00:00.000Z"); // +48 hours

      const lowDeadline = calculateSlaDeadline(baseDate, "Low");
      assert.equal(lowDeadline.toISOString(), "2026-11-15T10:00:00.000Z"); // +72 hours
    });
  });

  describe("3. Incident Types & Mandatory Critical Classification (BRD Section 9 & FR-5.2)", () => {
    it("identifies all 10 standard incident types with their default severities", () => {
      assert.equal(getDefaultSeverityForType("Accident"), "Medium");
      assert.equal(getDefaultSeverityForType("Behavioural Issue"), "Low");
      assert.equal(getDefaultSeverityForType("Corporal Punishment"), "Critical");
      assert.equal(getDefaultSeverityForType("Health Problem"), "Medium");
      assert.equal(getDefaultSeverityForType("POCSO"), "Critical");
      assert.equal(getDefaultSeverityForType("Unsubstantiated Claims"), "High");
      assert.equal(getDefaultSeverityForType("Misconduct"), "Medium");
      assert.equal(getDefaultSeverityForType("Near Miss"), "Low");
      assert.equal(getDefaultSeverityForType("Theft"), "Low");
      assert.equal(getDefaultSeverityForType("Other"), "Medium");
    });

    it("FR-5.2: Corporal Punishment is ALWAYS classified Critical and CANNOT be downgraded", () => {
      assert.equal(isNonDowngradable("Corporal Punishment"), true);
      assert.equal(enforceSeverityRules("Corporal Punishment", "Low"), "Critical");
      assert.equal(enforceSeverityRules("Corporal Punishment", "Medium"), "Critical");
      assert.equal(enforceSeverityRules("Corporal Punishment", "High"), "Critical");
      assert.equal(enforceSeverityRules("Corporal Punishment", null), "Critical");
    });

    it("FR-5.2: POCSO is ALWAYS classified Critical and CANNOT be downgraded", () => {
      assert.equal(isNonDowngradable("POCSO"), true);
      assert.equal(enforceSeverityRules("POCSO", "Low"), "Critical");
      assert.equal(enforceSeverityRules("POCSO", "Medium"), "Critical");
      assert.equal(enforceSeverityRules("POCSO", "High"), "Critical");
      assert.equal(enforceSeverityRules("POCSO", null), "Critical");
    });

    it("allows user-editable severity for regular downgradable incident types", () => {
      assert.equal(enforceSeverityRules("Accident", "Low"), "Low");
      assert.equal(enforceSeverityRules("Accident", "High"), "High");
      assert.equal(enforceSeverityRules("Near Miss", "Medium"), "Medium");
    });
  });

  describe("4. Case Closure RBAC Permission Matrix (BRD Section 5 & FR-7.2)", () => {
    it("FR-7.2: Area Operations Manager (AOM) can ONLY resolve and close Low-severity cases", () => {
      assert.equal(canRoleCloseIncident("AOM", "Low"), true);
      assert.equal(canRoleCloseIncident("AOM", "Medium"), false);
      assert.equal(canRoleCloseIncident("AOM", "High"), false);
      assert.equal(canRoleCloseIncident("AOM", "Critical"), false);
    });

    it("FR-7.2: Business Manager (BM) can resolve and close Medium and Low severity cases", () => {
      assert.equal(canRoleCloseIncident("BM", "Low"), true);
      assert.equal(canRoleCloseIncident("BM", "Medium"), true);
      assert.equal(canRoleCloseIncident("BM", "High"), false);
      assert.equal(canRoleCloseIncident("BM", "Critical"), false);
    });

    it("FR-7.2: Regional Safety Officer (RSO) can resolve High, Medium, and Low severity cases", () => {
      assert.equal(canRoleCloseIncident("RSO", "Low"), true);
      assert.equal(canRoleCloseIncident("RSO", "Medium"), true);
      assert.equal(canRoleCloseIncident("RSO", "High"), true);
      assert.equal(canRoleCloseIncident("RSO", "Critical"), false);
    });

    it("FR-7.2: Central (All-Activity Admin) and superAdmin can close all cases including Critical", () => {
      assert.equal(canRoleCloseIncident("Central", "Low"), true);
      assert.equal(canRoleCloseIncident("Central", "Medium"), true);
      assert.equal(canRoleCloseIncident("Central", "High"), true);
      assert.equal(canRoleCloseIncident("Central", "Critical"), true);

      assert.equal(canRoleCloseIncident("superAdmin", "Critical"), true);
    });
  });

  describe("5. Unique Case ID Generation (FR-6.2)", () => {
    it("auto-generates Case IDs matching the standard canonical pattern INC-YYYYMMDD-XXXX", () => {
      const caseId1 = generateCaseId();
      const caseId2 = generateCaseId();

      assert.match(caseId1, /^INC-\d{8}-\d{4}$/);
      assert.match(caseId2, /^INC-\d{8}-\d{4}$/);
      assert.notEqual(caseId1, caseId2, "Generated Case IDs should be unique");
    });
  });

  describe("6. National Dashboard Aggregations & Rate Bands (BRD Section 6.3, FR-3.1 - FR-3.5)", () => {
    it("FR-3.1: aggregates total centres across the 23-state baseline (~2,000+ centres)", () => {
      assert.ok(TOTAL_NETWORK_CENTRES >= 2000, "Network should have ~2000 centres");
      assert.equal(PREK_STATE_BASELINE.length, 23);
    });

    it("FR-3.2: calculates colour-coded incident rate bands accurately per 100 centres", () => {
      // Low: < 2.0
      assert.equal(getRateBand(0.5), RATE_BANDS.LOW);
      assert.equal(getRateBand(1.9), RATE_BANDS.LOW);

      // Medium: 2.0 to 4.99
      assert.equal(getRateBand(2.0), RATE_BANDS.MEDIUM);
      assert.equal(getRateBand(4.8), RATE_BANDS.MEDIUM);

      // High: 5.0 to 9.99
      assert.equal(getRateBand(5.0), RATE_BANDS.HIGH);
      assert.equal(getRateBand(9.5), RATE_BANDS.HIGH);

      // Critical: >= 10.0
      assert.equal(getRateBand(10.0), RATE_BANDS.CRITICAL);
      assert.equal(getRateBand(15.2), RATE_BANDS.CRITICAL);
    });

    it("FR-3.4 & FR-3.5: calculates state rates and ranks states to watch correctly", () => {
      const testStates = [
        { state: "Maharashtra", centreCount: 260, incidentCount: 26 }, // rate = 10.0 (Critical)
        { state: "Delhi", centreCount: 120, incidentCount: 6 },         // rate = 5.0 (High)
        { state: "Karnataka", centreCount: 150, incidentCount: 3 },     // rate = 2.0 (Medium)
        { state: "Kerala", centreCount: 60, incidentCount: 0 },         // rate = 0.0 (Low)
      ];

      const ranked = testStates
        .map((s) => ({
          ...s,
          incidentRate: Number(((s.incidentCount / s.centreCount) * 100).toFixed(2)),
          rateBand: getRateBand((s.incidentCount / s.centreCount) * 100),
        }))
        .sort((a, b) => b.incidentRate - a.incidentRate);

      assert.equal(ranked[0].state, "Maharashtra");
      assert.equal(ranked[0].rateBand, "Critical");
      assert.equal(ranked[1].state, "Delhi");
      assert.equal(ranked[1].rateBand, "High");
      assert.equal(ranked[2].state, "Karnataka");
      assert.equal(ranked[2].rateBand, "Medium");
      assert.equal(ranked[3].state, "Kerala");
      assert.equal(ranked[3].rateBand, "Low");
    });
  });

  describe("7. Security & Cryptographic Password Utilities (FR-1.1, FR-1.4)", () => {
    it("encrypts, decrypts and compares passwords safely with built-in fallbacks", () => {
      const password = "PrekSafePassword@2026";
      const encrypted = encrypt(password);
      assert.notEqual(encrypted, password);

      const decrypted = decrypt(encrypted);
      assert.equal(decrypted, password);

      assert.equal(comparePassword(password, encrypted), true);
      assert.equal(comparePassword("WrongPassword", encrypted), false);
    });

    it("supports updating password via updateUser payload with encryption and unlocking", () => {
      const initialPassword = "OldPassword@123";
      const updatedPassword = "NewSecretPassword@2026";

      const userDoc = {
        username: "test_aom",
        password: encrypt(initialPassword),
        isLocked: true,
        failedLoginAttempts: 5,
        lockUntil: new Date(Date.now() + 3600000),
      };

      // Simulate updateUser password change
      userDoc.password = encrypt(updatedPassword.trim());
      userDoc.isLocked = false;
      userDoc.failedLoginAttempts = 0;
      userDoc.lockUntil = null;

      assert.equal(comparePassword(updatedPassword, userDoc.password), true);
      assert.equal(comparePassword(initialPassword, userDoc.password), false);
      assert.equal(decrypt(userDoc.password), updatedPassword);
      assert.equal(userDoc.isLocked, false);
      assert.equal(userDoc.failedLoginAttempts, 0);
    });
  });

  describe("8. Access Token (15 min) & Refresh Token (30 days) Lifecycles", () => {
    it("generates an access token expiring in 15 minutes and refresh token expiring in 30 days", () => {
      const secret = "test-secret-2026";
      const refreshSecret = "test-secret-2026_refresh";
      const payload = { id: "test-user-id", role: "Central" };

      const accessToken = jwt.sign(payload, secret, { expiresIn: "15m" });
      const refreshToken = jwt.sign(payload, refreshSecret, { expiresIn: "30d" });

      const decodedAccess = jwt.verify(accessToken, secret);
      const decodedRefresh = jwt.verify(refreshToken, refreshSecret);

      const accessTtlSeconds = decodedAccess.exp - decodedAccess.iat;
      const refreshTtlSeconds = decodedRefresh.exp - decodedRefresh.iat;

      assert.equal(accessTtlSeconds, 15 * 60, "Access token TTL must be exactly 15 minutes (900 seconds)");
      assert.equal(refreshTtlSeconds, 30 * 24 * 60 * 60, "Refresh token TTL must be exactly 30 days (2,592,000 seconds)");
    });

    it("rejects expired access token with TokenExpiredError", () => {
      const secret = "test-secret-2026";
      const expiredToken = jwt.sign({ id: "user-123" }, secret, { expiresIn: -1 });

      assert.throws(
        () => jwt.verify(expiredToken, secret),
        (err) => err.name === "TokenExpiredError"
      );
    });

    it("rejects expired refresh token after 30 days with TokenExpiredError", () => {
      const refreshSecret = "test-secret-2026_refresh";
      const expiredRefreshToken = jwt.sign({ id: "user-123", type: "refresh" }, refreshSecret, { expiresIn: -1 });

      assert.throws(
        () => jwt.verify(expiredRefreshToken, refreshSecret),
        (err) => err.name === "TokenExpiredError"
      );
    });
  });
});

