# Pre-K Division National Incident & Safety Reporting Portal Backend

> **BRD Reference:** `Pre-K_Incident_Portal_BRD_v1.1.pdf`  
> **Git Branch:** `feature/pre-k-incident-portal-brd-v1.1`  
> **Architecture:** Pure BRD v1.1 Implementation (5-Tier Role Hierarchy, Centralized Incident Management & Analytics)

---

## 1. Executive Summary & Purpose

The **Pre-K Division National Incident & Safety Reporting Portal** is a centralised backend system strictly designed according to **BRD v1.1** for logging, classifying, escalating, and monitoring child-safety and operational incidents across approximately **2,000 pre-K centres** in India.

This system replaces legacy ad-hoc prototype structures and implements:
1. **5-Tier Role-Based Access Control (RBAC)** across ~94 named launch accounts (`AOM`, `BM`, `RSO`, `National Head`, `Central`).
2. **Horizontal Peer Isolation & 1-AOM-per-Centre Allocation:** Same-level peers (AOM vs AOM, BM vs BM) can **never** view or modify each other's reports. Only the supervising hierarchy above can view cross-area records.
3. **Standardized Incident Capture & Auto-routing** with unique Case IDs (`INC-YYYYMMDD-XXXX`).
4. **Strict Escalation Matrix & SLA Timelines** (Critical escalated within 2 hours; non-downgradable rule for POCSO and Corporal Punishment).
5. **Role-Enforced Case Closure Permissions** (Front-line AOMs can only resolve Low-severity cases; only Central can resolve Critical cases).
6. **National & Zone Analytics Dashboards** providing incident rates per 100 centres, state-level tile map with colour-coded rate bands, and ranked "States to Watch".
7. **Enterprise Security, Audit Trail & Account Lockout** (5 failed attempts trigger account lock; all logins, status modifications, and admin actions logged).

---

## 2. 5-Tier User Role Hierarchy & Access Scope

| Role | Approx. Users | Access Scope | Key Permissions & Responsibilities |
|---|---|---|---|
| **Area Operations Manager (AOM)** | ~60 | Own centre(s) / local area (~30–35 centres per AOM) | Report incidents; resolve & close **Low-severity** cases; view own area's case log. |
| **Business Manager (BM)** | ~25 | Cluster of areas within a zone | All AOM permissions; own & resolve **Medium-severity** cases; view cluster-level analytics. |
| **Regional Safety Officer (RSO)** | ~4 | Full zone (one or more regions) | All BM permissions; own **High-severity** cases; view zone dashboard, escalation matrix, case log. |
| **National Head** | ~3 | National (all zones) | View National and all Zone dashboards; strategic oversight and reporting; escalate/reassign any case. |
| **Central (All-Activity Admin)** | ~2 | National (full access) | Own **Critical-severity** cases; full visibility of every case & dashboard; user administration (create/deactivate accounts, assign roles/zones). |

---

## 3. Horizontal Peer Isolation & Centre Allocation Rules

### 3.1 Strict Same-Level Peer Isolation
Users at the same hierarchical tier **cannot view or mutate each other's incident reports**. Visibility is strictly upward:

```
        ┌─────────────────────────────────────────────────────────────┐
        │                 Central & National Head                     │
        │               (National Visibility - All)                   │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        │                Regional Safety Officer (RSO)                │
        │                  (Full Zone Visibility)                     │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        │                    Business Manager (BM)                    │
        │               (Supervises Cluster of Areas)                 │
        └─────────────────┬─────────────────────────┬─────────────────┘
                          │                         │
            ┌─────────────┴─────────────┐ ┌─────────┴─────────────┐
            │           AOM 1           │ │         AOM 2         │
            │     Centres: [A, B]       │ │     Centres: [C, D]   │
            │   ❌ CANNOT VIEW AOM 2    │ │  ❌ CANNOT VIEW AOM 1 │
            └───────────────────────────┘ └───────────────────────┘
```

- **AOM vs AOM:** AOM 1 cannot see reports logged for AOM 2's centres.
- **BM vs BM:** BM 1 (Cluster 1) cannot see reports belonging to BM 2 (Cluster 2).
- **RSO vs RSO:** RSO North cannot see reports belonging to RSO South.
- **Upward Supervisory Visibility:** Only the above hierarchy (BM for AOM, RSO for BM, National Head/Central for all) can view across jurisdictions.

### 3.2 1-AOM-per-Centre Mutual Exclusivity Rule
In the BRD operational model, ~2,000 centres are distributed among ~60 AOMs, giving an average ratio of **~33 centres per AOM**.

To permanently protect same-level data privacy:
1. **A single centre cannot have multiple AOMs.**
2. When creating or updating an AOM via `POST /api/users` or `PUT /api/users/:id`, the backend validates that none of the assigned centres are already allocated to another active AOM.
3. If an allocation overlap is detected, the API rejects the request with **HTTP 400 Bad Request**:
   ```json
   {
     "success": false,
     "message": "Centre allocation conflict: A single centre cannot have multiple AOMs. Conflicting assignments: AOM Mumbai (@aom_mumbai) already manages: Centre Bandra",
     "conflicts": [
       "AOM Mumbai (@aom_mumbai) already manages: Centre Bandra"
     ]
   }
   ```

### 3.3 Multi-Tier Data Visibility Matrix

| Requesting User Role | Own Centre Reports | Peer Centre Reports (Same Tier) | Cluster Reports | Zone Reports | National Reports |
|---|:---:|:---:|:---:|:---:|:---:|
| **AOM** |  **Yes** | ❌ **Blocked** | ❌ **Blocked** | ❌ **Blocked** | ❌ **Blocked** |
| **BM** |  **Yes** | ❌ **Blocked** (Peer BM) |  **Yes** (Supervised AOMs) | ❌ **Blocked** | ❌ **Blocked** |
| **RSO** |  **Yes** | ❌ **Blocked** (Peer RSO) |  **Yes** |  **Yes** (Zone) | ❌ **Blocked** |
| **National Head** |  **Yes** |  **Yes** |  **Yes** |  **Yes** |  **Yes** (All 23 States) |
| **Central** |  **Yes** |  **Yes** |  **Yes** |  **Yes** |  **Yes** (Full Access) |

---

## 4. Fixed Escalation Matrix & Business Rules

### 4.1 Severity, Owner, SLA & Closure Authority

| Severity | Assigned Owner Role | SLA Window | Required Operational Action | Authorized Closure Roles |
|---|---|---|---|---|
| **Low** | Area Operations Manager (`AOM`) | **3 working days** (72 hrs) | Log case, investigate locally, resolve and close. Include in weekly summary to BM. | `AOM`, `BM`, `RSO`, `National Head`, `Central` |
| **Medium** | Business Manager (`BM`) | **48 hours** | Review with AOM, agree corrective action, keep RSO informed via weekly rollup. | `BM`, `RSO`, `National Head`, `Central` |
| **High** | Regional Safety Officer (`RSO`) | **24 hours** | Lead investigation directly, initiate parent communication, notify National Head & Central. | `RSO`, `National Head`, `Central` |
| **Critical** | Central (All-Activity Admin) (`Central`) | **2 hours (immediate)** | RSO, National Head & Central notified simultaneously. Mandatory / statutory reporting triggered. | `Central` only |

### 4.2 Incident Types & Default Severities

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

## 5. Key BRD Functional Implementations

### FR-1.1 to FR-1.6: Authentication & User Administration
- **Unique Accounts (FR-1.1):** Individual email/username and encrypted credentials for all provisioned users.
- **Account Lockout Policy (FR-1.6):** Accounts lock automatically after **5 consecutive failed login attempts**. Return HTTP 403 with lockout message.
- **Audit Logging (FR-1.5):** Asynchronously records all logins (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`), case lifecycle actions (`INCIDENT_CREATED`, `INCIDENT_STATUS_CHANGED`, `INCIDENT_CLOSED`), and user provisioning (`USER_CREATED`, `USER_UPDATED`).
- **Self-Service & Admin Management (FR-1.4):**
  - `POST /auth/reset-password`: Self-service reset endpoint.
  - `POST /api/users`: Central admin creates user (enforces 1-AOM-per-centre validation).
  - `GET /api/users`: List users with role/zone filters.
  - `PUT /api/users/:id`: Reassign roles, zones, clusters, or centres (with conflict detection).
  - `PUT /api/users/:id/unlock`: Unlock locked accounts.
  - `PUT /api/users/:id/status`: Activate / deactivate accounts.

### FR-3.1 to FR-3.5: National Dashboard & Rate Band Analytics
- **Total Centre Baseline (FR-3.1):** Aggregates across the 23-state pre-K network baseline (~2,260 centres across North, South, East, West, and Central zones).
- **Incident Rate per 100 Centres (FR-3.1):** `(totalIncidents / totalCentres) * 100`.
- **State Tile Map & Rate Bands (FR-3.2):**
  - `Low`: Rate < 2.0 per 100 centres
  - `Medium`: 2.0 <= Rate < 5.0
  - `High`: 5.0 <= Rate < 10.0
  - `Critical`: Rate >= 10.0
- **State Selection Drill-down (FR-3.3):** Querying `?state=Maharashtra` returns state-level centre volume, incident count, rate band, recent incidents, and a direct link to the state's zone dashboard (`/api/incident-stats?zone=West`).
- **Zone Comparison (FR-3.4):** Grouped volume and incident rate across North, South, East, West, and Central zones.
- **States to Watch (FR-3.5):** Top 5 ranked states sorted descending by incident rate.

### FR-6.1 to FR-6.4: Incident Reporting
- **Field Capture (FR-6.1):** Zone/region, state, centre, incident date, type, severity, reporter name and role, description, immediate/pending action.
- **Auto-generated Case ID (FR-6.2):** Standardized format `INC-YYYYMMDD-XXXX` (e.g. `INC-20261113-4821`).
- **Validation (FR-6.3):** Pre-submission validation ensuring reporter name and description cannot be blank.
- **Escalation Confirmation (FR-6.4):** The API response confirms the assigned escalation owner and exact SLA deadline immediately on creation.

### FR-7.1 to FR-7.3: Case Log & Permission-Guarded Status Updates
- **Case Search (FR-7.1):** Multi-attribute search by Case ID, description keywords, incident type, reporter, or centre, strictly bounded by the user's role/centre scope using `$and`.
- **Role Permission Enforcement (FR-7.2):**
  - Frontline `AOM` attempting to close Medium, High, or Critical cases receives `403 Forbidden`.
  - `BM` can close Low and Medium cases, but is blocked from High or Critical.
  - `RSO` can close Low, Medium, and High cases, but is blocked from Critical.
  - `Central` (and `National Head`) holds sole authority to close Critical incidents.
- **Escalation Reference Display (FR-7.3):** Every case log entry includes `caseId`, `escalationOwner`, `sla`, `slaDeadline`, `status`, and `history`.

---

## 6. API Endpoints Reference

### 6.1 Authentication & User Management

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticates user credentials. Returns **15-minute Access Token** and **30-day Refresh Token**. Enforces 5-attempt lockout. |
| `POST` | `/auth/refresh-token` | Public | Refreshes session. Takes a valid 30-day refresh token and returns a new 15-minute access token. |
| `POST` | `/auth/logout` | Authenticated / Public | Logs out user and revokes stored 30-day refresh token. |
| `POST` | `/auth/reset-password` | Public | Self-service password reset using username/email and new password. |
| `POST` | `/api/users` | `Central` | Provision a new Pre-K user account. Validates 1-AOM-per-centre allocation. |
| `GET` | `/api/users` | `Central`, `National Head` | List all provisioned Pre-K users with decrypted plain-text passwords for administrator review. |
| `PUT` | `/api/users/:id` | `Central` | Update user details (name, email, password, role, zone, cluster, centres, status). Checks centre conflict. |
| `PUT` | `/api/users/:id/unlock` | `Central` | Unlock an account locked by failed attempts. |
| `PUT` | `/api/users/:id/reset-password` | `Central` | Administrator reset of a user's password. |
| `PUT` | `/api/users/:id/status` | `Central` | Activate / deactivate user account. |

### 6.2 Incident Reporting & Management

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `POST` | `/api/add-incident` | Authenticated | Report an incident. Enforces POCSO/Corporal Punishment as Critical, assigns SLA & owner, generates Case ID. |
| `GET` | `/api/get-incidents` | Authenticated | Scoped case log with search (`search=`), status (`status=Open`), and pagination. Enforces horizontal peer isolation. |
| `PUT` | `/api/update-incident/:id` | Authenticated | Update incident details (blocks downgrade of POCSO & Corporal Punishment; blocks cross-centre edits). |
| `PUT` | `/api/update-incident-status/:id` | Authenticated | Toggle status (`Open`/`Closed`). Enforces RBAC closure matrix and centre authorization. |
| `DELETE` | `/api/delete-incident/:id` | `Central` | Delete incident record. |

### 6.3 Dashboards & Reference Data

| Method | Endpoint | Access / Role | Description |
|---|---|---|---|
| `GET` | `/api/national-dashboard` | Authenticated | **National Dashboard (FR-3.1 - FR-3.5):** National metrics, 23-state tile map with rate bands, zone comparison, states to watch, and state drill-down (`?state=...`). |
| `GET` | `/api/incident-stats` | Authenticated | **Zone Overview Dashboard (FR-4.1 - FR-4.6):** KPI cards, severity trends, severity-mix, region comparison, and Type × Region matrix. |
| `GET` | `/api/escalation-matrix` | Public / All | **Standing Reference (FR-5.3):** Viewable escalation rules, SLAs, required actions, and default type severities. |
| `GET` | `/api/audit-logs` | `Central` | Paginated audit trail of all security and case lifecycle events (FR-1.5). |

---

## 7. Clean Codebase Architecture

```
Prototype-Light-House-Backend/
├── Controllers/
│   ├── Incident.Controller.js    # Incident capture, Case log, Dashboards, Audit logs
│   └── User.Controller.js        # Auth, 5-attempt lockout, Pre-K user management & 1-AOM validation
├── Middleware/
│   └── authMiddleware.js         # JWT verification, Pre-K role injection & in-memory caching
├── Models/
│   ├── incident.js               # Case ID, SLA deadline, non-downgradable hooks, aggregation indexes
│   ├── user.js                   # 5-tier Pre-K user model (AOM, BM, RSO, National Head, Central)
│   └── auditLog.js               # Security and operational audit trail schema
├── Routes/
│   ├── auth.route.js             # Authentication routes (/auth/login, /auth/reset-password)
│   ├── user.route.js             # User management routes (/api/users)
│   └── incident.route.js         # Incident and Dashboard routes
├── Utils/
│   ├── prekConstants.js          # Escalation matrix, 10 types, rate bands, 23-state baseline
│   ├── auditLogger.js            # Non-blocking resilient audit logger
│   ├── roleResolver.js           # 5-tier query scoping & strict peer isolation
│   ├── dashboardHelpers.js       # $facet pipelines, date parsing, explain plan parser
│   └── crypto.js                 # AES-256-CBC encryption/decryption with default key fallbacks
├── tests/
│   ├── incident-dashboard.test.js # Core dashboard & normalization unit tests
│   └── prek-brd-v1.1.test.js     # BRD v1.1 compliance test suite & peer isolation tests
├── server.js                     # Express app setup, clean route mounting & socket init
└── package.json                  # Dependencies & test scripts
```

---

## 8. Installation, Setup & Running

### 8.1 Prerequisites
- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher
- **MongoDB:** (Local or Atlas URI)

### 8.2 Configuration (.env)
Create a `.env` file in the root directory:
```env
PORT=9000
MONGO_URI=mongodb://localhost:27017/prek_incident_db
JWT_SECRET=your_jwt_secret_key_change_in_production
REFRESH_TOKEN_SECRET=your_refresh_token_secret_key
IV=your_16_byte_iv_key_here
ENCRYPTION_KEY=your_32_byte_encryption_key_here
```

### 8.3 Database Seeding (Pre-K Dummy Test Data)
Populate test accounts for every single role and sample incidents across severities:
```powershell
node scripts/seed-dummy-data.js
```

#### Pre-Provisioned Test Accounts (Password: `Password@123`)

| Role | Username | Assigned Scope | Key Test Purpose |
|---|---|---|---|
| **Central Admin** | `central_admin` | National | Full visibility; owns Critical POCSO & Corporal Punishment; user management |
| **National Head** | `national_head` | National | Strategic oversight; National & Zone dashboards |
| **RSO (West)** | `rso_west` | West Zone | Oversees Mumbai & Pune clusters; owns High severity cases |
| **RSO (North)** | `rso_north` | North Zone | Oversees Delhi cluster; owns High severity cases |
| **BM (Mumbai)** | `bm_mumbai` | Mumbai Cluster | Supervises `aom_bandra` & `aom_andheri`; owns Medium cases |
| **BM (Pune)** | `bm_pune` | Pune Cluster | Supervises `aom_pune`; owns Medium cases |
| **BM (Delhi)** | `bm_delhi` | Delhi Cluster | Supervises `aom_delhi`; owns Medium cases |
| **AOM 1 (Bandra)** | `aom_bandra` | Bandra & Juhu Centres | Isolated from AOM Andheri; resolves Low cases only |
| **AOM 2 (Andheri)** | `aom_andheri` | Andheri & Colaba Centres | Isolated from AOM Bandra; resolves Low cases only |
| **AOM 3 (Pune)** | `aom_pune` | Kothrud & Baner Centres | Resolves Low cases in Pune centres |
| **AOM 4 (Delhi)** | `aom_delhi` | Rohini & Saket Centres | Resolves Low cases in Delhi centres |

### 8.4 Start Server
```powershell
# Development mode with hot-reload
npm run dev

# Production start
npm start
```

---

## 9. Automated Testing & Verification

Run all tests:
```powershell
npm test
```

**Total Tests:** **60 passing** across 16 suites (0 failures).
- 5-Tier role normalization and query scoping.
- Horizontal peer isolation (AOM 1 vs AOM 2) and upward hierarchy visibility.
- 1-AOM-per-centre allocation conflict detection.
- Non-downgradable rules for POCSO & Corporal Punishment.
- Fixed escalation matrix and SLA calculation.
- Role-enforced case closure matrix (FR-7.2).
- Unique Case ID generation (`INC-YYYYMMDD-XXXX`).
- National Dashboard rate band calculations and Top 5 "States to Watch".
- 5-attempt account lockout policy and security audit trail.
- 15-minute Access Token & 30-day Refresh Token lifecycles and expiration validation.
