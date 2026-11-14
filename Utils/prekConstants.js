/**
 * ============================================================================
 * Pre-K Incident Portal - BRD v1.1 Business Constants & Rules
 * ============================================================================
 * Reference: Pre-K_Incident_Portal_BRD_v1.1.pdf
 * 
 * Core Architectural Modules:
 *  1. 5-Tier User Role Hierarchy & Aliases Normalization (Section 5, FR-1.2)
 *  2. Incident Types & Default Severities (Section 9)
 *  3. Non-Downgradable Safety Classification Rules for POCSO / CP (FR-5.2)
 *  4. Fixed Escalation Matrix, Operational Ownership & SLAs (Section 8)
 *  5. Role-Enforced Case Closure Permission Matrix (Section 5, FR-7.2)
 *  6. Canonical Case ID Generator (FR-6.2)
 *  7. National Dashboard Incident Rate Bands (Section 6.3, FR-3.2)
 *  8. 23-State Pre-K Centre Network Baseline & Totals (FR-3.1 - FR-3.5)
 * ============================================================================
 */

// ============================================================================
// 1. 5-TIER USER ROLES & ROLE NORMALIZATION (BRD Section 5, FR-1.2)
// ============================================================================

/**
 * Canonical 5-tier role definitions across ~94 launch accounts
 */
export const PREK_ROLES = Object.freeze({
  AOM: "AOM",                     // Area Operations Manager (~60 users)
  BM: "BM",                       // Business Manager (~25 users)
  RSO: "RSO",                     // Regional Safety Officer (~4 users)
  NATIONAL_HEAD: "National Head", // National Head (~3 users)
  CENTRAL: "Central",             // Central / Software Super Admin (~2 users)
});

/**
 * Role alias mapping lookup table for high-performance normalization
 */
const ROLE_ALIASES = Object.freeze({
  // AOM
  "aom": PREK_ROLES.AOM,
  "area operations manager": PREK_ROLES.AOM,

  // BM
  "bm": PREK_ROLES.BM,
  "business manager": PREK_ROLES.BM,

  // RSO
  "rso": PREK_ROLES.RSO,
  "regional safety officer": PREK_ROLES.RSO,

  // National Head
  "national head": PREK_ROLES.NATIONAL_HEAD,
  "nationalhead": PREK_ROLES.NATIONAL_HEAD,
  "national_head": PREK_ROLES.NATIONAL_HEAD,

  // Central / Software Super Admin
  "central": PREK_ROLES.CENTRAL,
  "central admin": PREK_ROLES.CENTRAL,
  "central (all-activity admin)": PREK_ROLES.CENTRAL,
  "all-activity admin": PREK_ROLES.CENTRAL,
  "software admin": PREK_ROLES.CENTRAL,
  "software_admin": PREK_ROLES.CENTRAL,
  "superadmin": PREK_ROLES.CENTRAL,
  "super admin": PREK_ROLES.CENTRAL,
  "admin": PREK_ROLES.CENTRAL,
});

/**
 * Standardizes an incoming role string to a canonical Pre-K role.
 *
 * @param {string} role - Raw role input from client or database
 * @returns {string|null} Canonical Pre-K role string or trimmed original string
 */
export const normalizePrekRole = (role) => {
  if (!role || typeof role !== "string") return null;
  const cleaned = role.trim().toLowerCase();
  return ROLE_ALIASES[cleaned] || role.trim();
};


// ============================================================================
// 2. INCIDENT TYPES & DEFAULT SEVERITIES (BRD Section 9)
// ============================================================================

/**
 * Standard Pre-K incident types with their default initial severity
 */
export const INCIDENT_TYPE_DEFAULTS = Object.freeze({
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
});

/**
 * High-sensitivity types that CANNOT be downgraded from Critical by any user (FR-5.2)
 */
export const NON_DOWNGRADABLE_CRITICAL_TYPES = Object.freeze([
  "Corporal Punishment",
  "POCSO",
]);

/**
 * Checks whether an incident type is strictly protected under non-downgradable rules
 *
 * @param {string} type - Incident category/type name
 * @returns {boolean} True if type is POCSO or Corporal Punishment
 */
export const isNonDowngradable = (type) => {
  if (!type || typeof type !== "string") return false;
  const normalized = type.trim().toLowerCase();
  return (
    normalized === "corporal punishment" ||
    normalized === "pocso" ||
    normalized.includes("corporal") ||
    normalized.includes("pocso")
  );
};


// ============================================================================
// 3. SEVERITY RULES & ENFORCEMENT
// ============================================================================

/**
 * Determines the default severity for an incident type
 *
 * @param {string} type - Incident type
 * @returns {string} Severity string ("Critical" | "High" | "Medium" | "Low")
 */
export const getDefaultSeverityForType = (type) => {
  if (!type || typeof type !== "string") return "Low";
  const target = type.trim().toLowerCase();
  for (const [key, severity] of Object.entries(INCIDENT_TYPE_DEFAULTS)) {
    if (key.toLowerCase() === target) {
      return severity;
    }
  }
  return "Medium";
};

/**
 * Validates and enforces severity according to BRD business rules:
 * - If type is POCSO or Corporal Punishment, force "Critical" regardless of input (FR-5.2).
 * - Otherwise, honours valid requested severity ("Critical", "High", "Medium", "Low").
 * - Falls back to default severity for the type.
 *
 * @param {string} type - Incident type
 * @param {string} [requestedSeverity] - User-supplied severity
 * @returns {string} Enforced severity
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


// ============================================================================
// 4. FIXED ESCALATION MATRIX & SLA RULES (BRD Section 8)
// ============================================================================

/**
 * Fixed operational escalation hierarchy, SLAs, and closure permissions
 */
export const ESCALATION_MATRIX = Object.freeze({
  Low: Object.freeze({
    severity: "Low",
    owner: "Area Operations Manager (AOM)",
    ownerRole: "AOM",
    sla: "3 working days",
    slaHours: 72,
    action: "Log the case, investigate locally, resolve and close. Include in weekly summary to Business Manager.",
    canCloseRoles: Object.freeze(["AOM", "BM", "RSO", "National Head", "Central", "superAdmin"]),
  }),
  Medium: Object.freeze({
    severity: "Medium",
    owner: "Business Manager (BM)",
    ownerRole: "BM",
    sla: "48 hours",
    slaHours: 48,
    action: "Review with AOM, agree corrective action, keep RSO informed via weekly rollup.",
    canCloseRoles: Object.freeze(["BM", "RSO", "National Head", "Central", "superAdmin"]),
  }),
  High: Object.freeze({
    severity: "High",
    owner: "Regional Safety Officer (RSO)",
    ownerRole: "RSO",
    sla: "24 hours",
    slaHours: 24,
    action: "Lead investigation directly, initiate parent/guardian communication, notify National Head and Central.",
    canCloseRoles: Object.freeze(["RSO", "National Head", "Central", "superAdmin"]),
  }),
  Critical: Object.freeze({
    severity: "Critical",
    owner: "Central (All-Activity Admin)",
    ownerRole: "Central",
    sla: "2 hours (immediate)",
    slaHours: 2,
    action: "RSO, National Head and Central notified simultaneously. Mandatory / statutory reporting triggered (e.g. POCSO, Corporal Punishment).",
    canCloseRoles: Object.freeze(["Central", "superAdmin"]),
  }),
});

/**
 * Retrieves the escalation configuration for a given severity
 *
 * @param {string} severity - Severity level ("Critical" | "High" | "Medium" | "Low")
 * @returns {object} Escalation configuration object
 */
export const getEscalationDetails = (severity) => {
  const normSev = (severity || "").trim().toLowerCase();
  if (normSev === "critical") return ESCALATION_MATRIX.Critical;
  if (normSev === "high") return ESCALATION_MATRIX.High;
  if (normSev === "medium") return ESCALATION_MATRIX.Medium;
  return ESCALATION_MATRIX.Low;
};

/**
 * Calculates the exact SLA resolution deadline based on creation date and severity
 *
 * @param {Date|string} [baseDate] - Incident creation timestamp (defaults to Date.now())
 * @param {string} severity - Severity level
 * @returns {Date} Calculated SLA deadline timestamp
 */
export const calculateSlaDeadline = (baseDate, severity) => {
  const start = baseDate ? new Date(baseDate) : new Date();
  const escalation = getEscalationDetails(severity);
  const hours = escalation.slaHours || 72;
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
};


// ============================================================================
// 5. ROLE-BASED CASE CLOSURE PERMISSION MATRIX (BRD Section 5, FR-7.2)
// ============================================================================

/**
 * Verifies whether a given user role is authorized to resolve/close a case:
 *  - AOM: Can ONLY close Low-severity cases.
 *  - BM: Can close Medium and Low severity cases.
 *  - RSO: Can close High, Medium, and Low severity cases.
 *  - Central (Software Admin) & National Head: Full closure authority including Critical cases.
 *
 * @param {string} userRole - User's role
 * @param {string} severity - Incident severity level
 * @returns {boolean} True if user is authorized to close the case
 */
export const canRoleCloseIncident = (userRole, severity) => {
  if (!userRole) return false;
  const normalizedRole = normalizePrekRole(userRole) || userRole;
  const escalation = getEscalationDetails(severity);
  return escalation.canCloseRoles.includes(normalizedRole);
};


// ============================================================================
// 6. CANONICAL CASE ID GENERATOR (BRD FR-6.2)
// ============================================================================

/**
 * Generates a unique, standardized Pre-K Case ID matching canonical pattern:
 * Format: INC-YYYYMMDD-XXXX (e.g. INC-20261114-4921)
 *
 * @returns {string} Unique Case ID
 */
export const generateCaseId = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `INC-${year}${month}${day}-${randomSuffix}`;
};


// ============================================================================
// 7. NATIONAL DASHBOARD INCIDENT RATE BANDS (BRD Section 6.3, FR-3.2)
// ============================================================================

/**
 * Standard incident rate band classifications per 100 centres
 */
export const RATE_BANDS = Object.freeze({
  LOW: "Low",           // Rate < 2.0 per 100 centres
  MEDIUM: "Medium",     // 2.0 <= Rate < 5.0
  HIGH: "High",         // 5.0 <= Rate < 10.0
  CRITICAL: "Critical", // Rate >= 10.0
});

/**
 * Classifies an incident rate per 100 centres into its standard colour-coded rate band
 *
 * @param {number|string} ratePer100Centres - Calculated incident rate
 * @returns {string} Rate band ("Low" | "Medium" | "High" | "Critical")
 */
export const getRateBand = (ratePer100Centres) => {
  const rate = Number(ratePer100Centres) || 0;
  if (rate < 2.0) return RATE_BANDS.LOW;
  if (rate < 5.0) return RATE_BANDS.MEDIUM;
  if (rate < 10.0) return RATE_BANDS.HIGH;
  return RATE_BANDS.CRITICAL;
};


// ============================================================================
// 8. 23-STATE PRE-K NETWORK BASELINE (BRD Section 6.3, FR-3.1 - FR-3.5)
// ============================================================================

/**
 * Reference distribution across 23 Indian states / UTs (~2,260 pre-K centres).
 * Used for National Dashboard aggregation, state tile map baselines, and Top 5 ranking.
 */
export const PREK_STATE_BASELINE = Object.freeze([
  // ── North Zone (7 states / UTs, 820 centres) ──────────────────────────────
  { state: "Delhi",            zone: "North",   centreCount: 120 },
  { state: "Uttar Pradesh",    zone: "North",   centreCount: 280 },
  { state: "Punjab",           zone: "North",   centreCount: 90  },
  { state: "Haryana",          zone: "North",   centreCount: 110 },
  { state: "Rajasthan",        zone: "North",   centreCount: 150 },
  { state: "Uttarakhand",      zone: "North",   centreCount: 40  },
  { state: "Himachal Pradesh", zone: "North",   centreCount: 30  },

  // ── West Zone (4 states, 560 centres) ─────────────────────────────────────
  { state: "Maharashtra",      zone: "West",    centreCount: 260 },
  { state: "Gujarat",          zone: "West",    centreCount: 160 },
  { state: "Madhya Pradesh",   zone: "West",    centreCount: 120 },
  { state: "Goa",              zone: "West",    centreCount: 20  },

  // ── South Zone (5 states, 540 centres) ────────────────────────────────────
  { state: "Karnataka",        zone: "South",   centreCount: 150 },
  { state: "Tamil Nadu",       zone: "South",   centreCount: 140 },
  { state: "Telangana",        zone: "South",   centreCount: 100 },
  { state: "Andhra Pradesh",   zone: "South",   centreCount: 90  },
  { state: "Kerala",           zone: "South",   centreCount: 60  },

  // ── East Zone (5 states, 280 centres) ─────────────────────────────────────
  { state: "West Bengal",      zone: "East",    centreCount: 100 },
  { state: "Odisha",           zone: "East",    centreCount: 50  },
  { state: "Bihar",            zone: "East",    centreCount: 60  },
  { state: "Jharkhand",        zone: "East",    centreCount: 40  },
  { state: "Assam",            zone: "East",    centreCount: 30  },

  // ── Central Zone & North UT (2 entities, 80 centres) ─────────────────────
  { state: "Chhattisgarh",     zone: "Central", centreCount: 60  },
  { state: "Chandigarh",       zone: "North",   centreCount: 20  },
]);

/**
 * Pre-calculated total network centre baseline (~2,260 centres)
 */
export const TOTAL_NETWORK_CENTRES = PREK_STATE_BASELINE.reduce(
  (sum, s) => sum + s.centreCount,
  0
);
