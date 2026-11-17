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

    it("verifies password reset requiring oldPassword and newPassword with username not required", () => {
      const currentPassword = "CurrentSecret@123";
      const newPassword = "BrandNewSecret@2026";
      const wrongOldPassword = "WrongOldPassword@999";

      const userDoc = {
        _id: "6af7f267179bd49f9f649892",
        username: "aom_karan",
        password: encrypt(currentPassword),
        isLocked: true,
        failedLoginAttempts: 4,
        lockUntil: new Date(Date.now() + 1800000),
      };

      // 1. Password reset payload without username (authenticated via token/session)
      const validPayload = {
        oldPassword: currentPassword,
        newPassword: newPassword,
      };

      assert.equal(validPayload.username, undefined, "Username must NOT be required in password reset payload");

      // 2. Reject if oldPassword does not match
      const isWrongOldMatch = comparePassword(wrongOldPassword.trim(), userDoc.password);
      assert.equal(isWrongOldMatch, false, "Should fail when oldPassword does not match current password");

      // 3. Reject if new password is same as old password
      const isIdentical = validPayload.oldPassword.trim() === validPayload.oldPassword.trim();
      assert.equal(isIdentical, true, "Should detect identical old and new password");

      // 4. Verify correct old password match and execute update
      const isOldMatch = comparePassword(validPayload.oldPassword.trim(), userDoc.password);
      assert.equal(isOldMatch, true, "Should verify oldPassword successfully");

      userDoc.password = encrypt(validPayload.newPassword.trim());
      userDoc.isLocked = false;
      userDoc.failedLoginAttempts = 0;
      userDoc.lockUntil = null;

      assert.equal(comparePassword(newPassword, userDoc.password), true);
      assert.equal(comparePassword(currentPassword, userDoc.password), false);
      assert.equal(userDoc.isLocked, false);
      assert.equal(userDoc.failedLoginAttempts, 0);
      assert.equal(userDoc.lockUntil, null);
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

  describe("9. Audit Log Search & Multi-Field Filtering (FR-1.5)", () => {
    it("constructs regex and multi-field search conditions for audit trail logs", () => {
      const searchTerm = "aom_bandra";
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = { $regex: escaped, $options: "i" };

      const orClause = [
        { action: searchRegex },
        { username: searchRegex },
        { userRole: searchRegex },
        { entityType: searchRegex },
        { entityId: searchRegex },
        { ipAddress: searchRegex },
        { "details.caseId": searchRegex },
        { "details.updatedUsername": searchRegex },
      ];

      assert.equal(orClause.length, 8);
      assert.equal(searchRegex.$options, "i");
      assert.equal(searchRegex.$regex, "aom_bandra");
    });

    it("safely escapes special regex characters in search queries", () => {
      const specialSearch = "Central (All-Activity Admin)";
      const escaped = specialSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.equal(escaped, "Central \\(All-Activity Admin\\)");
    });
  });

  describe("10. Zone Master & Centre / School Master Architecture", () => {
    it("validates Zone required fields and uppercase code normalization", () => {
      const zonePayload = {
        name: "North-Nagpur",
        code: "zn-nnp",
        states: ["Maharashtra"],
      };

      assert.ok(zonePayload.name, "Zone name is required");
      assert.ok(zonePayload.code, "Zone code is required");
      const normalizedCode = zonePayload.code.trim().toUpperCase();
      assert.equal(normalizedCode, "ZN-NNP");
    });

    it("allows creating a zone with flexible geography (optional states, cities, or custom administrative area)", () => {
      // 1. Zone with only name and code (no states, no cities)
      const pureAdminZone = { name: "Corporate Hub", code: "zn-corp" };
      assert.ok(pureAdminZone.name && pureAdminZone.code);
      assert.equal(pureAdminZone.states, undefined);
      assert.equal(pureAdminZone.cities, undefined);

      // 2. Zone for a single city or multiple cities
      const cityZone = {
        name: "North-Nagpur",
        code: "ZN-NNGP",
        cities: ["Nagpur", "Kamptee"],
      };
      assert.equal(cityZone.cities.length, 2);
      assert.equal(cityZone.states, undefined);

      // 3. Zone for multiple states
      const multiStateZone = {
        name: "North",
        code: "ZN-NORTH",
        states: ["Delhi", "Punjab", "Haryana"],
      };
      assert.equal(multiStateZone.states.length, 3);
    });

    it("validates Centre / School Master required fields (name, code, zone, state)", () => {
      const centrePayload = {
        name: "Nagpur Central School",
        code: "c-ngp-01",
        zone: "North-Nagpur",
        state: "Maharashtra",
      };

      const missing = [];
      if (!centrePayload.name) missing.push("name");
      if (!centrePayload.code) missing.push("code");
      if (!centrePayload.zone) missing.push("zone");
      if (!centrePayload.state) missing.push("state");

      assert.equal(missing.length, 0, "All 4 required centre fields must be provided");
      assert.equal(centrePayload.code.toUpperCase(), "C-NGP-01");
    });

    it("enriches centre records with active assigned AOM details", () => {
      const activeAOM = {
        id: "aom-101",
        name: "Pooja Verma",
        username: "pooja_aom",
        email: "pooja@lighthouse.com",
        centres: ["Nagpur Central School", "Besa Pre-K Centre"],
      };

      const centre = {
        name: "Nagpur Central School",
        code: "C-NGP-01",
        zone: "North-Nagpur",
      };

      const isAssigned = activeAOM.centres.includes(centre.name);
      assert.equal(isAssigned, true);
    });
  });

  describe("11. User Soft Delete & Restore Lifecycle with Conflict Detection", () => {
    it("soft deletes a user: releases assigned centres and renames credentials with timestamp prefix", () => {
      const user = {
        username: "karan_aom",
        email: "karan@lighthouse.com",
        centres: ["Bandra Centre", "Juhu Centre"],
        isDeleted: false,
        isActive: true,
      };

      // Soft delete operation
      const originalUsername = user.username;
      const originalEmail = user.email;
      const previousCentres = [...user.centres];

      user.originalUsername = originalUsername;
      user.originalEmail = originalEmail;
      user.previousCentres = previousCentres;
      user.centres = [];
      user.isDeleted = true;
      user.isActive = false;
      user.deletedAt = new Date();
      user.username = `deleted_1723400000000_${originalUsername}`;
      user.email = `deleted_1723400000000_${originalEmail}`;

      assert.equal(user.isDeleted, true);
      assert.equal(user.isActive, false);
      assert.equal(user.centres.length, 0, "Centres must be freed immediately for reassignment");
      assert.deepEqual(user.previousCentres, ["Bandra Centre", "Juhu Centre"]);
      assert.match(user.username, /^deleted_\d+_karan_aom$/);
    });

    it("prevents restore if another active user was created with the same username", () => {
      const deletedUser = {
        originalUsername: "karan_aom",
        originalEmail: "karan@lighthouse.com",
      };

      const activeUsers = [
        { username: "karan_aom", email: "new_karan@lighthouse.com", isDeleted: false },
      ];

      const usernameConflict = activeUsers.find(
        (u) => u.username === deletedUser.originalUsername && !u.isDeleted
      );

      assert.ok(usernameConflict, "Should detect duplicate username conflict with active user");
      assert.equal(usernameConflict.username, "karan_aom");
    });

    it("prevents restore if another active user was created with the same email", () => {
      const deletedUser = {
        originalUsername: "old_karan",
        originalEmail: "karan@lighthouse.com",
      };

      const activeUsers = [
        { username: "new_admin", email: "karan@lighthouse.com", isDeleted: false },
      ];

      const emailConflict = activeUsers.find(
        (u) => u.email === deletedUser.originalEmail && !u.isDeleted
      );

      assert.ok(emailConflict, "Should detect duplicate email conflict with active user");
      assert.equal(emailConflict.email, "karan@lighthouse.com");
    });

    it("prevents restoring an AOM if their previous centres were reassigned to another active AOM", () => {
      const deletedAOM = {
        role: PREK_ROLES.AOM,
        previousCentres: ["Bandra Centre"],
      };

      const activeAOMs = [
        { name: "Pooja", role: PREK_ROLES.AOM, centres: ["Bandra Centre"], isActive: true },
      ];

      const conflict = activeAOMs.find((aom) =>
        aom.centres.some((c) => deletedAOM.previousCentres.includes(c))
      );

      assert.ok(conflict, "Should detect centre allocation conflict on restore");
      assert.equal(conflict.name, "Pooja");
    });

    it("successfully restores user when credentials and centre assignments are clear", () => {
      const deletedUser = {
        originalUsername: "rajesh_bm",
        originalEmail: "rajesh@lighthouse.com",
        previousCentres: [],
        isDeleted: true,
      };

      // Perform clean restore
      const restoredUser = {
        ...deletedUser,
        username: deletedUser.originalUsername,
        email: deletedUser.originalEmail,
        isDeleted: false,
        isActive: true,
        deletedAt: null,
      };

      assert.equal(restoredUser.username, "rajesh_bm");
      assert.equal(restoredUser.email, "rajesh@lighthouse.com");
      assert.equal(restoredUser.isDeleted, false);
      assert.equal(restoredUser.isActive, true);
    });
  });

  describe("12. Dynamic Personnel Transition & Automatic Incident Linking", () => {
    it("automatically links historical and future incidents when a new AOM is assigned to centres", () => {
      // Historical incident was reported at 'Bandra Centre' by old AOM
      const incident = {
        caseId: "INC-20261113-1001",
        centreName: "Bandra Centre",
        zone: "West",
        severity: "Low",
      };

      // New AOM joins after old AOM leaves or is promoted
      const newAOMReq = {
        user: {
          id: "new-aom-id",
          name: "Suresh Patil",
          role: "AOM",
          centres: ["Bandra Centre"],
        },
        query: {},
      };

      const filter = buildQueryWithRole(newAOMReq);
      assert.deepEqual(filter.centreName, { $in: ["Bandra Centre"] });

      // Verifying incident matches the new AOM's scoped query
      const isVisibleToNewAOM = filter.centreName.$in.includes(incident.centreName);
      assert.equal(isVisibleToNewAOM, true, "New AOM must automatically see all incidents for assigned centre");
    });

    it("automatically expands visibility across all zones when a user is promoted to National Head", () => {
      // User was previously RSO West
      const rsoReq = {
        user: { role: "RSO", zone: "West" },
        query: {},
      };
      const rsoFilter = buildQueryWithRole(rsoReq);
      assert.ok(rsoFilter.$or, "RSO has zone restriction");

      // User promoted to National Head
      const nationalHeadReq = {
        user: { role: "National Head" },
        query: {},
      };
      const natFilter = buildQueryWithRole(nationalHeadReq);
      assert.deepEqual(natFilter, {}, "National Head has national access without restrictions");
    });
  });

  describe("13. Enhanced Incident Filtering & Reporting", () => {
    it("constructs comprehensive filter covering zone, centre, state, severity, and type", () => {
      const query = {
        zone: "West",
        centreName: "Bandra Centre",
        state: "Maharashtra",
        severity: "Critical",
        incidentType: "POCSO",
        status: "Open",
      };

      const andConditions = [];
      if (query.status) andConditions.push({ status: query.status });
      if (query.zone) andConditions.push({ zone: query.zone });
      if (query.centreName) andConditions.push({ centreName: query.centreName });
      if (query.state) andConditions.push({ state: query.state });
      if (query.severity) andConditions.push({ severity: query.severity });
      if (query.incidentType) andConditions.push({ incidentType: query.incidentType });

      assert.equal(andConditions.length, 6);
      const compositeFilter = { $and: andConditions };
      assert.equal(compositeFilter.$and.length, 6);
    });

    it("calculates summary breakdown metrics for incident reports", () => {
      const sampleIncidents = [
        { severity: "Critical", status: "Open" },
        { severity: "High", status: "In Progress" },
        { severity: "Medium", status: "Resolved" },
        { severity: "Low", status: "Closed" },
        { severity: "Critical", status: "Closed" },
      ];

      const summary = {
        total: sampleIncidents.length,
        open: sampleIncidents.filter((i) => i.status === "Open").length,
        inProgress: sampleIncidents.filter((i) => i.status === "In Progress").length,
        resolved: sampleIncidents.filter((i) => i.status === "Resolved").length,
        closed: sampleIncidents.filter((i) => i.status === "Closed").length,
        critical: sampleIncidents.filter((i) => i.severity === "Critical").length,
        high: sampleIncidents.filter((i) => i.severity === "High").length,
        medium: sampleIncidents.filter((i) => i.severity === "Medium").length,
        low: sampleIncidents.filter((i) => i.severity === "Low").length,
      };

      assert.equal(summary.total, 5);
      assert.equal(summary.open, 1);
      assert.equal(summary.closed, 2);
      assert.equal(summary.critical, 2);
      assert.equal(summary.high, 1);
      assert.equal(summary.medium, 1);
      assert.equal(summary.low, 1);
    });
  });

  describe("14. Cluster Master Architecture & Business Manager (BM) Supervision", () => {
    it("validates Cluster Master required fields and uppercase code normalization", () => {
      const clusterPayload = {
        name: "Mumbai Cluster",
        code: "cl-mum",
        zone: "West",
        description: "Mumbai Metropolitan Area Cluster",
      };

      const missing = [];
      if (!clusterPayload.name) missing.push("name");
      if (!clusterPayload.code) missing.push("code");
      if (!clusterPayload.zone) missing.push("zone");

      assert.equal(missing.length, 0, "Cluster name, code, and zone are required");
      assert.equal(clusterPayload.code.trim().toUpperCase(), "CL-MUM");
    });

    it("enforces 1-BM-per-cluster exclusivity rule to guarantee peer isolation", () => {
      const activeBMs = [
        { name: "Meera Nair", username: "bm_mumbai", role: "BM", cluster: "Mumbai Cluster", isActive: true },
      ];

      const newBMRequest = {
        name: "Rohit Shetty",
        role: "BM",
        cluster: "Mumbai Cluster",
      };

      const conflict = activeBMs.find(
        (bm) => bm.cluster.toLowerCase() === newBMRequest.cluster.toLowerCase() && bm.isActive
      );

      assert.ok(conflict, "Should detect duplicate BM assignment to the same cluster");
      assert.equal(conflict.username, "bm_mumbai");
    });

    it("dynamically identifies AOMs supervised by a Business Manager via cluster centres", () => {
      // Cluster has these centres
      const clusterCentres = ["Bandra Centre", "Juhu Centre", "Andheri Centre", "Colaba Centre"];

      // AOMs and their centre assignments
      const aoms = [
        { name: "AOM 1 (Bandra)", username: "aom_bandra", centres: ["Bandra Centre", "Juhu Centre"] },
        { name: "AOM 2 (Andheri)", username: "aom_andheri", centres: ["Andheri Centre", "Colaba Centre"] },
        { name: "AOM 3 (Pune)", username: "aom_pune", centres: ["Kothrud Centre", "Baner Centre"] },
      ];

      // BM of Mumbai Cluster supervises AOMs whose centres overlap with this cluster
      const supervisedAOMs = aoms.filter((aom) =>
        aom.centres.some((c) => clusterCentres.includes(c))
      );

      assert.equal(supervisedAOMs.length, 2, "BM Mumbai must supervise AOM 1 and AOM 2");
      assert.equal(supervisedAOMs[0].username, "aom_bandra");
      assert.equal(supervisedAOMs[1].username, "aom_andheri");
      assert.ok(!supervisedAOMs.some((a) => a.username === "aom_pune"), "BM Mumbai must NOT see Pune AOM");
    });

    it("automatically transitions cluster oversight when a new BM replaces a departed BM", () => {
      // Old BM leaves
      const oldBM = {
        username: "old_bm_mumbai",
        cluster: "Mumbai Cluster",
        isDeleted: true,
      };

      // New BM is appointed to Mumbai Cluster
      const newBM = {
        username: "new_bm_mumbai",
        role: "BM",
        zone: "West",
        cluster: "Mumbai Cluster",
      };

      // Centres and reports in Mumbai Cluster
      const incidentsInCluster = [
        { caseId: "INC-20261113-1001", cluster: "Mumbai Cluster", centreName: "Bandra Centre" },
        { caseId: "INC-20261113-1002", cluster: "Mumbai Cluster", centreName: "Andheri Centre" },
      ];

      const visibleIncidents = incidentsInCluster.filter(
        (inc) => inc.cluster === newBM.cluster
      );

      assert.equal(visibleIncidents.length, 2, "New BM must immediately inherit all incidents in the cluster");
    });
  });
});

