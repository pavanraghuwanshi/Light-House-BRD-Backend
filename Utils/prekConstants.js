/**
 * Pre-K Incident Portal - BRD v1.1 Business Constants and Rules
 * Implements:
 * - 5-Tier Role Hierarchy (AOM, BM, RSO, National Head, Central)
 * - Incident Types & Default Severities (Section 9)
 * - Fixed Escalation Matrix & SLA Rules (Section 8)
 * - Non-downgradable Rules for POCSO & Corporal Punishment (FR-5.2)
 * - Incident Rate Bands & 23 States Centre Baseline (Section 6.3, FR-3.1 - FR-3.5)
 */

export const PREK_ROLES = {
  AOM: "AOM", // Area Operations Manager (~60 users)
  BM: "BM",   // Business Manager (~25 users)
  RSO: "RSO", // Regional Safety Officer (~4 users)
  NATIONAL_HEAD: "National Head", // National Head (~3 users)
  CENTRAL: "Central", // Central (All-Activity Admin) (~2 users)
};

/**
 * Standardize input role string to canonical Pre-K role or legacy role
 */
export const normalizePrekRole = (role) => {
  if (!role || typeof role !== "string") return null;
  const r = role.trim().toLowerCase();
  if (r === "aom" || r === "area operations manager") return PREK_ROLES.AOM;
  if (r === "bm" || r === "business manager") return PREK_ROLES.BM;
  if (r === "rso" || r === "regional safety officer") return PREK_ROLES.RSO;
  if (r === "national head" || r === "nationalhead" || r === "national_head") return PREK_ROLES.NATIONAL_HEAD;
  if (r === "central" || r === "central (all-activity admin)" || r === "central admin" || r === "all-activity admin") {
    return PREK_ROLES.CENTRAL;
  }
  return role.trim();
};

/**
 * Section 9: Incident Types & Default Severity
 */
export const INCIDENT_TYPE_DEFAULTS = {
  "Accident": "Medium",
  "Behavioural Issue": "Low",
  "Corporal Punishment": "Critical", // Mandatory Critical - cannot be downgraded
  "Health Problem": "Medium",
  "POCSO": "Critical",               // Mandatory Critical - cannot be downgraded
  "Unsubstantiated Claims": "High",
  "Misconduct": "Medium",
  "Near Miss": "Low",
  "Theft": "Low",
  "Other": "Medium",
};

/**
 * Types that CANNOT be downgraded from Critical by any user role (FR-5.2)
 */
export const NON_DOWNGRADABLE_CRITICAL_TYPES = [
  "Corporal Punishment",
  "POCSO",
];

export const isNonDowngradable = (type) => {
  if (!type || typeof type !== "string") return false;
  const t = type.trim().toLowerCase();
  return (
    t === "corporal punishment" ||
    t === "pocso" ||
    t.includes("corporal") ||
    t.includes("pocso")
  );
};

/**
 * Determine default severity for incident type
 */
export const getDefaultSeverityForType = (type) => {
  if (!type || typeof type !== "string") return "Low";
  const trimmed = type.trim();
  for (const [key, val] of Object.entries(INCIDENT_TYPE_DEFAULTS)) {
    if (key.toLowerCase() === trimmed.toLowerCase()) {
      return val;
    }
  }
  return "Medium";
};

/**
 * Validates and enforces severity according to BRD business rules
 * If type is POCSO or Corporal Punishment, returns "Critical" always
 */
export const enforceSeverityRules = (type, requestedSeverity) => {
  if (isNonDowngradable(type)) {
    return "Critical";
  }
  if (!requestedSeverity) {
    return getDefaultSeverityForType(type);
  }
  const s = String(requestedSeverity).trim().toLowerCase();
  if (s === "critical") return "Critical";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return getDefaultSeverityForType(type);
};

/**
 * Section 8: Escalation Matrix (Business Rules)
 */
export const ESCALATION_MATRIX = {
  Low: {
    severity: "Low",
    owner: "Area Operations Manager (AOM)",
    ownerRole: "AOM",
    sla: "3 working days",
    slaHours: 72,
    action: "Log the case, investigate locally, resolve and close. Include in weekly summary to Business Manager.",
    canCloseRoles: ["AOM", "BM", "RSO", "National Head", "Central", "superAdmin"],
  },
  Medium: {
    severity: "Medium",
    owner: "Business Manager (BM)",
    ownerRole: "BM",
    sla: "48 hours",
    slaHours: 48,
    action: "Review with AOM, agree corrective action, keep RSO informed via weekly rollup.",
    canCloseRoles: ["BM", "RSO", "National Head", "Central", "superAdmin"],
  },
  High: {
    severity: "High",
    owner: "Regional Safety Officer (RSO)",
    ownerRole: "RSO",
    sla: "24 hours",
    slaHours: 24,
    action: "Lead investigation directly, initiate parent/guardian communication, notify National Head and Central.",
    canCloseRoles: ["RSO", "National Head", "Central", "superAdmin"],
  },
  Critical: {
    severity: "Critical",
    owner: "Central (All-Activity Admin)",
    ownerRole: "Central",
    sla: "2 hours (immediate)",
    slaHours: 2,
    action: "RSO, National Head and Central notified simultaneously. Mandatory / statutory reporting triggered (e.g. POCSO, Corporal Punishment).",
    canCloseRoles: ["Central", "superAdmin"],
  },
};

/**
 * Retrieve escalation details for a severity
 */
export const getEscalationDetails = (severity) => {
  const normSev = (severity || "").trim().toLowerCase();
  if (normSev === "critical") return ESCALATION_MATRIX.Critical;
  if (normSev === "high") return ESCALATION_MATRIX.High;
  if (normSev === "medium") return ESCALATION_MATRIX.Medium;
  return ESCALATION_MATRIX.Low;
};

/**
 * Calculate SLA deadline from base date
 */
export const calculateSlaDeadline = (baseDate, severity) => {
  const start = baseDate ? new Date(baseDate) : new Date();
  const escalation = getEscalationDetails(severity);
  const hours = escalation.slaHours || 72;
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
};

/**
 * FR-7.2: Verify whether user role has permission to resolve/close a case of given severity
 * Enforces Section 5 key permissions:
 * - AOM: resolve & close Low-severity cases
 * - BM: own & resolve Medium-severity cases (and Low)
 * - RSO: own High-severity cases (and Medium, Low)
 * - Central & National Head: own & resolve Critical cases (full visibility)
 */
export const canRoleCloseIncident = (userRole, severity) => {
  if (!userRole) return false;
  const normalizedRole = normalizePrekRole(userRole) || userRole;
  const escalation = getEscalationDetails(severity);
  return escalation.canCloseRoles.includes(normalizedRole);
};

/**
 * Auto-generate unique Case ID (FR-6.2)
 * Format: INC-YYYYMMDD-XXXX (e.g. INC-20261112-9421)
 */
export const generateCaseId = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `INC-${year}${month}${day}-${randomSuffix}`;
};

/**
 * Section 6.3: Rate Bands for National Dashboard (FR-3.2)
 * Incident rate per 100 centres
 */
export const RATE_BANDS = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const getRateBand = (ratePer100Centres) => {
  const rate = Number(ratePer100Centres) || 0;
  if (rate < 2.0) return RATE_BANDS.LOW;
  if (rate < 5.0) return RATE_BANDS.MEDIUM;
  if (rate < 10.0) return RATE_BANDS.HIGH;
  return RATE_BANDS.CRITICAL;
};

/**
 * Reference 23 States pre-K Network Distribution across ~2,000 centres
 * Used for National Dashboard aggregation and state tile map baseline (FR-3.1 - FR-3.5)
 */
export const PREK_STATE_BASELINE = [
  // North Zone (7 states, 820 centres)
  { state: "Delhi", zone: "North", centreCount: 120 },
  { state: "Uttar Pradesh", zone: "North", centreCount: 280 },
  { state: "Punjab", zone: "North", centreCount: 90 },
  { state: "Haryana", zone: "North", centreCount: 110 },
  { state: "Rajasthan", zone: "North", centreCount: 150 },
  { state: "Uttarakhand", zone: "North", centreCount: 40 },
  { state: "Himachal Pradesh", zone: "North", centreCount: 30 },

  // West Zone (4 states, 560 centres)
  { state: "Maharashtra", zone: "West", centreCount: 260 },
  { state: "Gujarat", zone: "West", centreCount: 160 },
  { state: "Madhya Pradesh", zone: "West", centreCount: 120 },
  { state: "Goa", zone: "West", centreCount: 20 },

  // South Zone (5 states, 540 centres)
  { state: "Karnataka", zone: "South", centreCount: 150 },
  { state: "Tamil Nadu", zone: "South", centreCount: 140 },
  { state: "Telangana", zone: "South", centreCount: 100 },
  { state: "Andhra Pradesh", zone: "South", centreCount: 90 },
  { state: "Kerala", zone: "South", centreCount: 60 },

  // East Zone (5 states, 280 centres)
  { state: "West Bengal", zone: "East", centreCount: 100 },
  { state: "Odisha", zone: "East", centreCount: 50 },
  { state: "Bihar", zone: "East", centreCount: 60 },
  { state: "Jharkhand", zone: "East", centreCount: 40 },
  { state: "Assam", zone: "East", centreCount: 30 },

  // Central Zone (2 states, 120 centres)
  { state: "Chhattisgarh", zone: "Central", centreCount: 60 },
  { state: "Chandigarh", zone: "North", centreCount: 20 },
];

export const TOTAL_NETWORK_CENTRES = PREK_STATE_BASELINE.reduce(
  (sum, s) => sum + s.centreCount,
  0
);

