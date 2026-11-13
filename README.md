# Pre-K Division National Incident & Safety Reporting Portal Backend

> **BRD Reference:** `Pre-K_Incident_Portal_BRD_v1.1.pdf`  
> **Git Branch:** `feature/pre-k-incident-portal-brd-v1.1`  
> **Status:** Production-Ready Implementation & Verified against BRD v1.1

---

## 1. Executive Summary & Purpose

The **Pre-K Division National Incident & Safety Reporting Portal** is a centralized backend system designed for logging, classifying, escalating, and monitoring child-safety and operational incidents across approximately **2,000 pre-K centres** in India.

This release addresses the requirements outlined in **BRD v1.1**, including:
1. **5-Tier Role-Based Access Control (RBAC)** across ~94 named launch accounts (`AOM`, `BM`, `RSO`, `National Head`, `Central`).
2. **Standardized Incident Capture & Auto-routing** with unique Case IDs (`INC-YYYYMMDD-XXXX`).
3. **Strict Escalation Matrix & SLA Timelines** (Critical escalated within 2 hours; non-downgradable rule for POCSO and Corporal Punishment).
4. **Role-Enforced Case Closure Permissions** (Front-line AOMs can only resolve Low-severity cases; only Central can resolve Critical cases).
5. **National & Zone Analytics Dashboards** providing incident rates per 100 centres, state-level tile map with colour-coded rate bands, and ranked "States to Watch".
6. **Enterprise Security, Audit Trail & Account Lockout** (5 failed attempts trigger account lock; all logins and status modifications logged).

---

## 2. 5-Tier User Role Hierarchy & Access Scope

| Role | Approx. Users | Access Scope | Key Permissions & Responsibilities |
|---|---|---|---|
| **Area Operations Manager (AOM)** | ~60 | Own centre(s) / local area | Report incidents; resolve & close **Low-severity** cases; view own area's case log. |
| **Business Manager (BM)** | ~25 | Cluster of areas within a zone | All AOM permissions; own & resolve **Medium-severity** cases; view cluster-level analytics. |
| **Regional Safety Officer (RSO)** | ~4 | Full zone (one or more regions) | All BM permissions; own **High-severity** cases; view zone dashboard, escalation matrix, case log. |
| **National Head** | ~3 | National (all zones) | View National and all Zone dashboards; strategic oversight and reporting; escalate/reassign any case. |
| **Central (All-Activity Admin)** | ~2 | National (full access) | Own **Critical-severity** cases; full visibility of every case & dashboard; user administration (create/deactivate accounts, assign roles/zones). |

---

## 3. Fixed Escalation Matrix & Business Rules

### 3.1 Severity, Owner, SLA & Closure Authority

| Severity | Assigned Owner Role | SLA Window | Required Operational Action | Authorized Closure Roles |
|---|---|---|---|---|
| **Low** | Area Operations Manager (`AOM`) | **3 working days** (72 hrs) | Log case, investigate locally, resolve and close. Include in weekly summary to BM. | `AOM`, `BM`, `RSO`, `National Head`, `Central` |
| **Medium** | Business Manager (`BM`) | **48 hours** | Review with AOM, agree corrective action, keep RSO informed via weekly rollup. | `BM`, `RSO`, `National Head`, `Central` |
| **High** | Regional Safety Officer (`RSO`) | **24 hours** | Lead investigation directly, initiate parent communication, notify National Head & Central. | `RSO`, `National Head`, `Central` |
| **Critical** | Central (All-Activity Admin) (`Central`) | **2 hours (immediate)** | RSO, National Head & Central notified simultaneously. Mandatory / statutory reporting triggered. | `Central` only |

### 3.2 Incident Types & Default Severities

| Incident Type | Default Severity | Compliance / Downgrade Restriction |
|---|---|---|
| **POCSO** | **Critical** | **MANDATORY CRITICAL (FR-5.2):** Non-downgradable by any role. |
| **Corporal Punishment** | **Critical** | **MANDATORY CRITICAL (FR-5.2):** Non-downgradable by any role. |
| **Unsubstantiated Claims** | **High** | User-editable according to verified investigation. |
| **Accident** | **Medium** | User-editable based on injury severity. |
| **Health Problem** | **Medium** | User-editable based on medical attention required. |
| **Misconduct** | **Medium** | User-editable based on nature of infraction. |
| **Other** | **Medium** | User-editable. |
| **Behavioural Issue** | **Low** | User-editable. |
| **Near Miss** | **Low** | User-editable. |
| **Theft** | **Low** | User-editable. |

---

## 4. Key BRD Functional Implementations

### FR-1.1 to FR-1.6: Authentication & User Administration
- **Unique Accounts:** Individual email/username and encrypted credentials for all provisioned users.
- **Account Lockout Policy (FR-1.6):** Accounts lock automatically after **5 consecutive failed login attempts**. Return HTTP 403 with lockout duration or admin reset requirement.
- **Audit Logging (FR-1.5):** Asynchronously records all logins (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`), case lifecycle actions (`INCIDENT_CREATED`, `INCIDENT_STATUS_CHANGED`, `INCIDENT_CLOSED`), and user provisioning.
- **Self-Service & Admin Management (FR-1.4):**
  - `/auth/reset-password`: Self-service reset endpoint.
  - `/api/prek-users`: Central admin endpoints to create, list, reassign zones/centres, and unlock user accounts.

### FR-3.1 to FR-3.5: National Dashboard & Rate Band Analytics
- **Total Centre Baseline (FR-3.1):** Configured against the 23-state pre-K network baseline (~2,260 centres across North, South, East, West, and Central zones).
- **Incident Rate per 100 Centres (FR-3.1):** `(totalIncidents / totalCentres) * 100`.
- **State Tile Map & Rate Bands (FR-3.2):**
  - `Low`: Rate < 2.0 per 100 centres
  - `Medium`: 2.0 <= Rate < 5.0
  - `High`: 5.0 <= Rate < 10.0
  - `Critical`: Rate >= 10.0
- **State Selection Drill-down (FR-3.3):** Querying `?state=Maharashtra` returns state-level centre volume, incident count, rate band, recent incidents, and a direct link to the state's zone dashboard (`/api/incident-stats?region=West`).
- **Zone Comparison (FR-3.4):** Grouped volume and incident rate across North, South, East, West, and Central zones.
- **States to Watch (FR-3.5):** Top 5 ranked states sorted descending by incident rate.

### FR-6.1 to FR-6.4: Incident Reporting
- **Field Capture (FR-6.1):** Region/zone, incident date, type, severity, reporter name and role, description, immediate/pending action.
- **Auto-generated Case ID (FR-6.2):** Standardized format `INC-YYYYMMDD-XXXX` (e.g. `INC-20261112-4821`).
- **Validation (FR-6.3):** Pre-submission validation ensuring reporter name and description cannot be blank.
- **Escalation Confirmation (FR-6.4):** The API response confirms the assigned escalation owner and exact SLA deadline immediately on creation.

### FR-7.1 to FR-7.3: Case Log & Permission-Guarded Status Updates
- **Case Search (FR-7.1):** Multi-attribute search by Case ID, description keywords, incident type, reporter, or centre.
- **Role Permission Enforcement (FR-7.2):**
  - Frontline `AOM` attempting to close Medium, High, or Critical cases receives `403 Forbidden`.
  - `BM` can close Low and Medium cases, but is blocked from High or Critical.
  - `RSO` can close Low, Medium, and High cases, but is blocked from Critical.
  - `Central` (and `superAdmin`) holds sole authority to close Critical incidents.
- **Escalation Reference Display (FR-7.3):** Every case log entry includes `caseId`, `escalationOwner`, `sla`, `slaDeadline`, `status`, and `history`.

---

## 5. API Endpoints Reference

### 5.1 Authentication & User Management

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticates user credentials. Returns JWT with role, zone, cluster, and centres. Enforces 5-attempt lockout. |
| `POST` | `/auth/reset-password` | Public | Self-service password reset using username/email and new password. |
| `POST` | `/api/prek-users` | `Central`, `superAdmin` | Provision a new Pre-K user account (`AOM`, `BM`, `RSO`, `National Head`, `Central`). |
| `GET` | `/api/prek-users` | `Central`, `National Head` | List all provisioned Pre-K users with role and zone filters. |
| `PUT` | `/api/prek-users/:id` | `Central`, `superAdmin` | Update user assignments (role, zone, cluster, centres, active status). |
| `PUT` | `/api/prek-users/:id/unlock` | `Central`, `superAdmin` | Unlock an account locked by failed attempts. |
| `PUT` | `/api/prek-users/:id/reset-password`| `Central`, `superAdmin` | Administrator reset of a user's password. |

### 5.2 Incident Reporting & Management

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `POST` | `/api/add-incident` | Authenticated | Report an incident. Enforces POCSO/Corporal Punishment as Critical, assigns SLA & owner, generates Case ID. |
| `GET` | `/api/get-incidents` | Authenticated | Scoped case log with search (`search=`), status (`status=Open`), and pagination (`page=1&limit=10`). |
| `PUT` | `/api/update-incident/:id` | Authenticated | Update incident details (blocks downgrade of POCSO & Corporal Punishment). |
| `PUT` | `/api/update-incident-status/:id` | Authenticated | Toggle status (`Open`/`Closed`). Enforces RBAC matrix (FR-7.2). |
| `DELETE` | `/api/delete-incident/:id` | `Central`, `superAdmin` | Delete incident record. |

### 5.3 Dashboards & Reference Data

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `GET` | `/api/national-dashboard` | Authenticated | **National Dashboard (FR-3.1 - FR-3.5):** National metrics, 23-state tile map with rate bands, zone comparison, states to watch, and state drill-down (`?state=...`). |
| `GET` | `/api/incident-stats` | Authenticated | **Zone Overview Dashboard (FR-4.1 - FR-4.6):** KPI cards, severity trends, severity-mix, region comparison, and Type × Region matrix. |
| `GET` | `/api/escalation-matrix` | Public / All | **Standing Reference (FR-5.3):** Viewable escalation rules, SLAs, required actions, and default type severities. |
| `GET` | `/api/audit-logs` | `Central`, `superAdmin` | Paginated audit trail of all security and case lifecycle events (FR-1.5). |

---

## 6. Project Architecture

```
Prototype-Light-House-Backend/
├── Controllers/
│   ├── Incident.Controller.js    # Incident lifecycle, National & Zone dashboards, Audit logs
│   ├── User.Controller.js        # Authentication, 5-attempt lockout, Pre-K user administration
│   └── ...
├── Middleware/
│   └── authMiddleware.js         # JWT verification, Pre-K role injection & caching
├── Models/
│   ├── incident.js               # Case ID, SLA deadline, non-downgradable hooks, ESR indexes
│   ├── prekUser.js               # 5-tier Pre-K user model, lockout flags & zone mappings
│   ├── auditLog.js               # Security and operational audit trail schema
│   └── ...
├── Routes/
│   ├── incident.route.js         # Incident and Dashboard routes
│   ├── prekUser.route.js         # Pre-K user admin routes (/api/prek-users)
│   ├── userlogin.route.js        # Auth routes (/auth/login, /auth/reset-password)
│   └── ...
├── Utils/
│   ├── prekConstants.js          # Escalation matrix, 10 types, rate bands, 23-state baseline
│   ├── auditLogger.js            # Non-blocking resilient audit logger
│   ├── roleResolver.js           # 5-tier query scoping & branch resolver
│   ├── dashboardHelpers.js       # $facet pipelines, date parsing, explain plan parser
│   └── crypto.js                 # AES-256-CBC encryption/decryption with default key fallbacks
├── tests/
│   ├── incident-dashboard.test.js # Core dashboard & normalization unit tests (28 tests)
│   └── prek-brd-v1.1.test.js     # BRD v1.1 compliance test suite (25 tests)
├── server.js                     # Express app setup, route mounting & socket init
└── package.json                  # Dependencies & test scripts
```

---

## 7. Installation, Setup & Running

### 7.1 Prerequisites
- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher
- **MongoDB:** (Local or Atlas URI)

### 7.2 Configuration (.env)
Create a `.env` file in the root directory:
```env
PORT=3000
JWT_SECRET=your_secure_jwt_secret_key_2026
ENCRYPTION_KEY=your_32_character_encryption_key_
IV=your_16_character_iv_value_
MONGO_URI_1=mongodb://localhost:27017/prek_db1
MONGO_URI_2=mongodb://localhost:27017/prek_db2
NODE_ENV=development
```
*(Note: Cryptographic helpers and auth middleware include safe fallback keys for offline unit testing without environment variables).*

### 7.3 Start Server
```powershell
# Development mode with hot-reload
npm run dev

# Production start
npm start
```

---

## 8. Automated Testing & Verification

The test suite validates both legacy dashboard contracts and all BRD v1.1 business requirements.

Run all tests:
```powershell
npm test
```

### Test Coverage Summary:
- **`tests/incident-dashboard.test.js` (28 tests):**
  - Normalization of Status (`Open`, `In Progress`, `Closed`, `Resolved`) & Severity.
  - Date Range & Month Parsing (UTC midnight boundaries, ISO 8601, `$lt` next-day upper bound).
  - Index-Friendly Region & Category Variants.
  - Role-Based Query Filtering.
  - Single-pass `$facet` Dashboard aggregation & Explain plan metrics parser.
- **`tests/prek-brd-v1.1.test.js` (25 tests):**
  - 5-Tier Pre-K Role Hierarchy & Alias Normalization (`AOM`, `BM`, `RSO`, `National Head`, `Central`).
  - Scoped Query Filtering (Central: national; National Head: national; RSO: zone; BM: cluster/centres; AOM: local area).
  - Fixed Escalation Matrix (Low: 72h; Medium: 48h; High: 24h; Critical: 2h).
  - Non-downgradable enforcement for `POCSO` and `Corporal Punishment` (FR-5.2).
  - RBAC Case Closure Authority (FR-7.2: AOM blocked from closing Critical; Central authorized).
  - Unique Case ID Generation (`INC-YYYYMMDD-XXXX`).
  - National Dashboard rate calculations per 100 centres & colour-coded rate bands (`Low`, `Medium`, `High`, `Critical`).
  - 23-State pre-K network baseline (~2,260 centres) & "States to Watch" ranking.
  - AES-256-CBC Cryptographic utilities.

**Total Tests:** **53 passing** across 15 suites (0 failures).

