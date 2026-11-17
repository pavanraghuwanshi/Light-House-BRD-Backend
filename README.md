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

> [!TIP]
> For a complete, in-depth architectural breakdown of the 5-tier role hierarchy, jurisdiction scoping, peer isolation, creation rules, case resolution matrix, and clean cURL examples, see the dedicated [PREK_ROLE_HIERARCHY_AND_ACCESS_CONTROL_GUIDE.md](file:///d:/Pavan%20Raghuwanshi/HBG%20Projects/Light%20House%20Project/Prototype-Light-House-Backend/PREK_ROLE_HIERARCHY_AND_ACCESS_CONTROL_GUIDE.md).

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
- **Audit Logging (FR-1.5):** Asynchronously records all logins (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`), case lifecycle actions (`INCIDENT_CREATED`, `INCIDENT_STATUS_CHANGED`, `INCIDENT_CLOSED`), and user provisioning (`USER_CREATED`, `USER_UPDATED`). Supports multi-attribute keyword search (`search=`) across actions, user attributes, entity IDs, reasons, and IPs.
- **Self-Service & Admin Management (FR-1.4):**
  - `POST /auth/login`: Authenticates user credentials. Issues 15-minute access token and 30-day refresh token.
  - `POST /auth/refresh-token`: Generates a new 15-minute access token using a valid 30-day refresh token.
  - `POST /auth/reset-password`: Self-service reset endpoint.
  - `POST /api/users`: Central admin provisions users with strict, explicit field validation:
    - **Missing Field Validation:** Checks `name`, `username`, `email`, `phone`, `password`, and `role`. If any field is missing, returns HTTP 400 with a descriptive message and a `missingFields: [...]` array (e.g. `{"success": false, "message": "Missing required field: email.", "missingFields": ["email"]}`).
    - **Distinct Duplicate Validation:** Returns explicit messages distinguishing whether `username` is already taken (`"Username 'xxx' is already registered"`) or `email` is taken (`"Email 'xxx' is already registered"`).
    - **BRD v1.1 Role Hierarchy Validation:**
      - `AOM`: Requires `zone` and a non-empty `centres` array (enforces 1-AOM-per-centre exclusivity).
      - `BM`: Requires `zone` and `cluster`.
      - `RSO`: Requires `zone`.
      - `National Head` & `Central`: National scope (no zone/cluster required).
    - **Pure Modern Schema:** Completely eliminates deprecated prototype fields (`schoolId`, `branchGroupName`, `AssignedBranch`) for a clean, scalable architecture.
  - `GET /api/users`: Lists active users with role/zone filters and decrypted plain-text passwords for Central Admin review.
  - `GET /api/users/deleted`: Lists all soft-deleted / trashed users with their original usernames, emails, roles, released centre assignments, and deletion timestamps.
  - `PUT /api/users/:id`: Updates user profiles:
    - Supports password updates via `password` or `newPassword` (encrypted via AES-256-CBC, auto-unlocks locked accounts, and resets `failedLoginAttempts: 0`).
    - Supports updates to `phone`, `email` (with duplicate verification against other accounts), `name`, `role`, `zone`, `cluster`, `centres`, and `isActive`.
    - Automatically validates 1-AOM-per-centre allocation whenever centres are reassigned.
  - `DELETE /api/users/:id`: **Soft Delete Account (FR-1.4 / Lifecycle):** Safely deactivates and archives the user account (`isDeleted: true`), frees up assigned centres immediately so replacement staff can take over, and archives original credentials.
  - `PUT /api/users/:id/restore`: **Restore Soft-Deleted Account:** Restores a trashed user account with automated collision prevention:
    - Verifies if an active user already took that `username` while deleted (returns HTTP 409 conflict: *"Cannot restore: An active user with username '@...' already exists. To restore this user, either rename or delete the existing active user first."*).
    - Verifies if an active user already took that `email` while deleted (returns HTTP 409 conflict).
    - If user is an `AOM`, checks if their original centres are currently assigned to another active AOM (returns HTTP 409 conflict).
    - If clean, restores the account to full active status.
  - `PUT /api/users/:id/unlock`: Unlock locked accounts.
  - `PUT /api/users/:id/status`: Activate / deactivate accounts.

### Master Data Architecture: 3-Tier Organizational Hierarchy (Zone -> Cluster -> Centre)
1. **Creation Sequence & Administrative Ownership:**
   - **Tier 1: Zone Master (`POST /api/zones`):** Administrative zones (e.g. `North`, `West`, `South`, `East`, `Central`) are created first with their constituent states. Supervised by **Regional Safety Officers (RSO)**.
   - **Tier 2: Cluster Master (`POST /api/clusters`):** Administrative clusters (e.g. `Mumbai Cluster`, `Pune Cluster`, `Delhi Cluster`) are created under a parent zone. Each cluster is assigned to a **Business Manager (BM)** with strict **1-BM-per-cluster exclusivity**.
   - **Tier 3: Centre / School Master (`POST /api/centres`):** Pre-K centres (e.g. `Centre Bandra`, `Delhi Model School`) are registered under their parent cluster, zone, and state. Managed locally by an **Area Operations Manager (AOM)** with strict **1-AOM-per-centre exclusivity**.
2. **Business Manager (BM) & AOM Supervision Model:**
   - When centres are created under a cluster (e.g. `Bandra Centre` under `Mumbai Cluster`), the Business Manager of `Mumbai Cluster` **automatically supervises all AOMs** managing those centres (`GET /api/clusters/:id/aoms`).
   - All incident reports from those centres roll up to the cluster's BM, and onwards to the Zone's RSO.
3. **Dynamic Personnel Assignment & Replacement Model:**
   - **Centres Assigned to AOM / Clusters to BM:** Personnel are mapped to entities from the master tables.
   - **Incident Ownership Anchored to Masters:** Incident reports belong to the centre, cluster, and zone, **NOT** to temporary personal MongoDB user IDs.
   - **Staff Transitions (Promotions / Resignations / Replacements):**
     - If an AOM leaves or is promoted, their account is soft-deleted, freeing up the centres. The replacement AOM assigned to those centres **instantly and automatically sees all historical, active, and resolved incident reports** for those centres.
     - If a Business Manager leaves or is replaced, the incoming BM assigned to that cluster immediately inherits oversight of that entire cluster, all its centres, and all its AOMs.
     - If a Regional Safety Officer (RSO) leaves, the incoming RSO assigned to that zone immediately inherits oversight of all clusters, centres, and incidents across that zone.
     - If a user is promoted to National Head, their data scope expands nationally across all 23 states.

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

## 6. Comprehensive API Reference (Methods, Payloads & Responses)

---

### 6.1 Authentication, Session & User Lifecycle

#### 1. User Login
- **Endpoint:** `POST /auth/login`
- **Access:** Public
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "username": "central_admin",
    "password": "Password@123"
  }
  ```
  *(Note: `username` accepts either username or registered email address)*
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Login successful.",
    "user": {
      "id": "6af7f267179bd49f9f649892",
      "name": "Central Safety Admin",
      "username": "central_admin",
      "email": "central@lighthouse.com",
      "role": "Central",
      "zone": null,
      "cluster": null,
      "centres": [],
      "loginAccess": true
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Error Responses:**
  - `400 Bad Request` (Invalid credentials / attempts remaining):
    ```json
    { "success": false, "message": "Incorrect password. 2 attempts remaining before account lockout." }
    ```
  - `403 Forbidden` (Account Locked after 5 failed attempts):
    ```json
    { "success": false, "message": "Account locked: 5 consecutive failed login attempts reached. Please reset password or contact Central administrator. (FR-1.6)" }
    ```
  - `403 Forbidden` (Soft-deleted account):
    ```json
    { "success": false, "message": "This account has been deactivated or removed. Please contact your system administrator." }
    ```

#### 2. Refresh Access Token
- **Endpoint:** `POST /auth/refresh-token`
- **Access:** Public (valid 30-day refresh token required)
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Access token refreshed successfully.",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "15m"
  }
  ```

#### 3. User Logout
- **Endpoint:** `POST /auth/logout`
- **Access:** Authenticated / Public
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  { "success": true, "message": "Logged out successfully." }
  ```

#### 4. Self-Service Password Reset
- **Endpoint:** `POST /auth/reset-password`
- **Access:** Public
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "username": "aom_bandra",
    "newPassword": "NewSecurePassword@123"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Password reset successfully. You can now login with your new password."
  }
  ```

---

### 6.2 User Provisioning & Administration (`/api/users`)

#### 1. Provision New User
- **Endpoint:** `POST /api/users`
- **Access:** `Central` (All-Activity Admin)
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`

##### Payloads by Role:
* **Area Operations Manager (AOM):**
  ```json
  {
    "name": "Karan Patel",
    "username": "aom_karan",
    "email": "karan@lighthouse.com",
    "phone": "9876543211",
    "password": "Password@123",
    "role": "AOM",
    "zone": "West",
    "cluster": "Mumbai Cluster",
    "centres": ["Bandra Centre", "Juhu Centre"]
  }
  ```
* **Business Manager (BM):**
  ```json
  {
    "name": "Meera Nair",
    "username": "bm_mumbai",
    "email": "meera@lighthouse.com",
    "phone": "9876543222",
    "password": "Password@123",
    "role": "BM",
    "zone": "West",
    "cluster": "Mumbai Cluster"
  }
  ```
* **Regional Safety Officer (RSO):**
  ```json
  {
    "name": "Vikram Malhotra",
    "username": "rso_west",
    "email": "vikram@lighthouse.com",
    "phone": "9876543233",
    "password": "Password@123",
    "role": "RSO",
    "zone": "West"
  }
  ```
* **National Head:**
  ```json
  {
    "name": "Dr. Ananya Roy",
    "username": "national_head",
    "email": "ananya@lighthouse.com",
    "phone": "9876543244",
    "password": "Password@123",
    "role": "National Head"
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "User aom_karan (AOM) provisioned successfully.",
    "data": {
      "id": "6738f9b9487c53d10034a101",
      "name": "Karan Patel",
      "username": "aom_karan",
      "email": "karan@lighthouse.com",
      "phone": "9876543211",
      "role": "AOM",
      "zone": "West",
      "cluster": "Mumbai Cluster",
      "centres": ["Bandra Centre", "Juhu Centre"],
      "isActive": true,
      "password": "Password@123"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request` (Missing required fields):
    ```json
    {
      "success": false,
      "message": "Missing required fields: email, phone.",
      "missingFields": ["email", "phone"]
    }
    ```
  - `400 Bad Request` (1-AOM-per-centre conflict):
    ```json
    {
      "success": false,
      "message": "Centre allocation conflict: A single centre cannot have multiple AOMs. Conflicting assignments: Pooja (@aom_pooja) already manages: Bandra Centre",
      "conflicts": ["Pooja (@aom_pooja) already manages: Bandra Centre"]
    }
    ```
  - `400 Bad Request` (1-BM-per-cluster conflict):
    ```json
    {
      "success": false,
      "message": "Cluster allocation conflict: A single cluster cannot have multiple Business Managers. Cluster 'Mumbai Cluster' is already managed by Meera Nair (@bm_mumbai)."
    }
    ```

#### 2. List Active Users
- **Endpoint:** `GET /api/users`
- **Access:** `Central`, `National Head`, `BM` (BM automatically scoped to AOMs under their cluster)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `role=AOM`, `zone=West`, `cluster=Mumbai Cluster`, `search=karan`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "data": [
      {
        "_id": "6738f9b9487c53d10034a101",
        "name": "Karan Patel",
        "username": "aom_karan",
        "email": "karan@lighthouse.com",
        "phone": "9876543211",
        "role": "AOM",
        "zone": "West",
        "cluster": "Mumbai Cluster",
        "centres": ["Bandra Centre", "Juhu Centre"],
        "isActive": true,
        "password": "Password@123"
      }
    ]
  }
  ```

#### 3. List Soft-Deleted / Trashed Users
- **Endpoint:** `GET /api/users/deleted`
- **Access:** `Central`, `National Head`
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `role=AOM`, `zone=West`, `search=karan`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "data": [
      {
        "id": "6738f9b9487c53d10034a101",
        "name": "Karan Patel",
        "username": "aom_karan",
        "email": "karan@lighthouse.com",
        "phone": "9876543211",
        "role": "AOM",
        "zone": "West",
        "cluster": "Mumbai Cluster",
        "previousCentres": ["Bandra Centre", "Juhu Centre"],
        "deletedAt": "2026-11-17T08:00:00.000Z",
        "deletedBy": { "name": "Central Safety Admin", "username": "central_admin" },
        "isDeleted": true
      }
    ]
  }
  ```

#### 4. Update User Details & Password
- **Endpoint:** `PUT /api/users/:id`
- **Access:** `Central` (All-Activity Admin)
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "Karan P.",
    "phone": "9876543299",
    "password": "NewUpdatedPassword@123",
    "centres": ["Bandra Centre"],
    "isActive": true
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "User aom_karan updated successfully. Password updated.",
    "data": {
      "id": "6738f9b9487c53d10034a101",
      "name": "Karan P.",
      "username": "aom_karan",
      "email": "karan@lighthouse.com",
      "phone": "9876543299",
      "role": "AOM",
      "centres": ["Bandra Centre"],
      "isActive": true,
      "password": "NewUpdatedPassword@123"
    }
  }
  ```

#### 5. Soft Delete User Account
- **Endpoint:** `DELETE /api/users/:id`
- **Access:** `Central` (All-Activity Admin)
- **Headers:** `Authorization: Bearer <central_token>`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "User 'aom_karan' has been soft deleted successfully. Assigned centres have been released and can now be reassigned.",
    "data": {
      "id": "6738f9b9487c53d10034a101",
      "username": "aom_karan",
      "email": "karan@lighthouse.com",
      "role": "AOM",
      "deletedAt": "2026-11-17T08:00:00.000Z",
      "previousCentres": ["Bandra Centre", "Juhu Centre"]
    }
  }
  ```

#### 6. Restore Soft-Deleted User Account
- **Endpoint:** `PUT /api/users/:id/restore`
- **Access:** `Central` (All-Activity Admin)
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body (Optional, if reassigning centres):**
  ```json
  {
    "centres": ["Bandra Centre"]
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "User '@aom_karan' (AOM) has been restored successfully.",
    "data": {
      "id": "6738f9b9487c53d10034a101",
      "name": "Karan Patel",
      "username": "aom_karan",
      "email": "karan@lighthouse.com",
      "role": "AOM",
      "centres": ["Bandra Centre"],
      "isActive": true
    }
  }
  ```
- **Error Responses:**
  - `409 Conflict` (Active username exists):
    ```json
    {
      "success": false,
      "message": "Cannot restore: An active user with username '@aom_karan' already exists (Karan V., role: AOM). To restore this user, either rename or delete the existing active user first.",
      "conflictType": "USERNAME_EXISTS"
    }
    ```
  - `409 Conflict` (Centres reallocated to another active AOM):
    ```json
    {
      "success": false,
      "message": "Cannot restore AOM with original centres: Centre allocation conflict. Conflicting assignments: Pooja (@aom_pooja) currently manages: Bandra Centre. Please provide new unassigned centres or reassign existing active AOMs first.",
      "conflictType": "CENTRE_ALLOCATION_CONFLICT"
    }
    ```

#### 7. Administrator Unlock User Account
- **Endpoint:** `PUT /api/users/:id/unlock`
- **Access:** `Central`
- **Headers:** `Authorization: Bearer <central_token>`
- **Success Response (`200 OK`):**
  ```json
  { "success": true, "message": "Account for aom_karan has been unlocked successfully." }
  ```

#### 8. Toggle User Active / Inactive Status
- **Endpoint:** `PUT /api/users/:id/status`
- **Access:** `Central`
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body:** `{ "active": false }`
- **Success Response (`200 OK`):**
  ```json
  { "success": true, "message": "Account for aom_karan deactivated successfully." }
  ```

---

### 6.3 Zone Master Management (`/api/zones`)

#### 1. Create Zone
- **Endpoint:** `POST /api/zones`
- **Access:** `Central`
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "West",
    "code": "ZN-WEST",
    "description": "Western Administrative Zone",
    "states": ["Maharashtra", "Goa", "Gujarat"]
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Zone 'West' created successfully.",
    "data": {
      "_id": "6738f9...",
      "name": "West",
      "code": "ZN-WEST",
      "description": "Western Administrative Zone",
      "states": ["Maharashtra", "Goa", "Gujarat"],
      "isActive": true
    }
  }
  ```

#### 2. List All Zones
- **Endpoint:** `GET /api/zones`
- **Access:** Authenticated (All Roles)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `search=west`, `isActive=true`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "data": [
      {
        "_id": "6738f9...",
        "name": "West",
        "code": "ZN-WEST",
        "states": ["Maharashtra", "Goa", "Gujarat"],
        "centreCount": 7,
        "activeRSO": {
          "id": "6738f9...",
          "name": "Vikram Malhotra",
          "username": "rso_west",
          "email": "rso.west@lighthouse.com",
          "phone": "9876543233"
        }
      }
    ]
  }
  ```

#### 3. Get Zone by ID or Code
- **Endpoint:** `GET /api/zones/:id` *(or `/api/zones/ZN-WEST`)*
- **Success Response (`200 OK`):** Returns zone details with attached centres array and active RSO.

#### 4. Update Zone
- **Endpoint:** `PUT /api/zones/:id`
- **Request Body:** `{ "description": "Updated Zone Description", "states": ["Maharashtra", "Goa", "Gujarat"] }`
- **Success Response (`200 OK`):** `{ "success": true, "message": "Zone 'West' updated successfully." }`

#### 5. Soft Delete Zone
- **Endpoint:** `DELETE /api/zones/:id`
- **Success Response (`200 OK`):** `{ "success": true, "message": "Zone 'West' has been soft deleted successfully." }`
*(Note: Blocked with HTTP 400 if active centres are still attached).*

---

### 6.4 Cluster Master Management (`/api/clusters`)

#### 1. Create Cluster
- **Endpoint:** `POST /api/clusters`
- **Access:** `Central`
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "Mumbai Cluster",
    "code": "CL-MUM",
    "zone": "West",
    "description": "Mumbai Metropolitan Area Pre-K Cluster"
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Cluster 'Mumbai Cluster' created successfully in Zone 'West'.",
    "data": {
      "_id": "6738f9...",
      "name": "Mumbai Cluster",
      "code": "CL-MUM",
      "zone": "West",
      "isActive": true
    }
  }
  ```

#### 2. List All Clusters
- **Endpoint:** `GET /api/clusters`
- **Access:** Authenticated (All Roles)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `zone=West`, `search=mumbai`, `unassigned=true`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "data": [
      {
        "_id": "6738f9...",
        "name": "Mumbai Cluster",
        "code": "CL-MUM",
        "zone": "West",
        "centreCount": 4,
        "centres": ["Bandra Centre", "Andheri Centre", "Juhu Centre", "Colaba Centre"],
        "assignedBM": {
          "id": "6738f9...",
          "name": "Meera Nair",
          "username": "bm_mumbai",
          "email": "bm.mumbai@lighthouse.com",
          "phone": "9876543222"
        },
        "aomCount": 2,
        "supervisedAOMs": [
          {
            "id": "6738f9...",
            "name": "Karan Patel",
            "username": "aom_bandra",
            "managedCentres": ["Bandra Centre", "Juhu Centre"]
          }
        ]
      }
    ]
  }
  ```

#### 3. Get Supervised AOMs within a Cluster
- **Endpoint:** `GET /api/clusters/:id/aoms`
- **Access:** Authenticated (BM, Central, National Head)
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "cluster": "Mumbai Cluster",
    "zone": "West",
    "totalAOMs": 2,
    "data": [
      {
        "id": "6738f9...",
        "name": "Karan Patel",
        "username": "aom_bandra",
        "email": "karan@lighthouse.com",
        "phone": "9876543211",
        "centresInThisCluster": ["Bandra Centre", "Juhu Centre"],
        "allCentres": ["Bandra Centre", "Juhu Centre"]
      }
    ]
  }
  ```

#### 4. Update Cluster
- **Endpoint:** `PUT /api/clusters/:id`
- **Request Body:** `{ "description": "Updated Cluster Description" }`
- **Success Response (`200 OK`):** Automatically cascades and updates Centre and BM records if name changes.

#### 5. Soft Delete Cluster
- **Endpoint:** `DELETE /api/clusters/:id`
- **Success Response (`200 OK`):** Soft deletes cluster and frees BM assignment.

---

### 6.5 Centre / School Master Management (`/api/centres`)

#### 1. Create Centre / School
- **Endpoint:** `POST /api/centres`
- **Access:** `Central`
- **Headers:** `Authorization: Bearer <central_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "Bandra Centre",
    "code": "C-BND-01",
    "zone": "West",
    "cluster": "Mumbai Cluster",
    "state": "Maharashtra",
    "city": "Mumbai",
    "address": "Hill Road, Bandra West",
    "pincode": "400050",
    "contactPhone": "022-26400111",
    "contactEmail": "bandra@lighthouse.com"
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Centre 'Bandra Centre' created successfully.",
    "data": {
      "_id": "6738f9...",
      "name": "Bandra Centre",
      "code": "C-BND-01",
      "zone": "West",
      "cluster": "Mumbai Cluster",
      "state": "Maharashtra",
      "city": "Mumbai",
      "isActive": true
    }
  }
  ```

#### 2. List Centres / Schools
- **Endpoint:** `GET /api/centres`
- **Access:** Authenticated (All Roles)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `zone=West`, `state=Maharashtra`, `cluster=Mumbai Cluster`, `search=bandra`, `unassigned=true`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "data": [
      {
        "_id": "6738f9...",
        "name": "Bandra Centre",
        "code": "C-BND-01",
        "zone": "West",
        "cluster": "Mumbai Cluster",
        "state": "Maharashtra",
        "city": "Mumbai",
        "assignedAOM": {
          "id": "6738f9...",
          "name": "Karan Patel",
          "username": "aom_bandra",
          "email": "aom.bandra@lighthouse.com"
        },
        "isAssigned": true
      }
    ]
  }
  ```

#### 3. Get Centre Details by ID or Code
- **Endpoint:** `GET /api/centres/:id` *(or `/api/centres/C-BND-01`)*
- **Success Response (`200 OK`):** Returns centre record with assigned AOM details and total incident count.

#### 4. Update Centre / School
- **Endpoint:** `PUT /api/centres/:id`
- **Request Body:** `{ "address": "New Address", "contactPhone": "022-26400999" }`
- **Success Response (`200 OK`):** If name changes, automatically syncs active AOM centre assignments.

#### 5. Soft Delete Centre / School
- **Endpoint:** `DELETE /api/centres/:id`
- **Success Response (`200 OK`):** Soft deletes centre and automatically pulls it from any active AOM's allocation.

---

### 6.6 Incident Reporting, Reports & Case Management

#### 1. Report Incident
- **Endpoint:** `POST /api/add-incident`
- **Access:** Authenticated (All Provisioned Staff)
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "zone": "West",
    "centreName": "Bandra Centre",
    "state": "Maharashtra",
    "incidentType": "POCSO",
    "reporterName": "Karan Patel",
    "reporterRole": "AOM",
    "description": "Child reported inappropriate contact by unauthorized visitor on school premises.",
    "immediateActionTaken": "Child immediately moved to safety and evaluated by school counselor. Parents informed.",
    "pendingAction": "Police FIR to be registered under POCSO Act.",
    "stakeholders": ["Parents", "Local Police", "School Principal"]
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Incident report logged successfully.",
    "data": {
      "caseId": "INC-20261117-4821",
      "incidentType": "POCSO",
      "severity": "Critical",
      "status": "Open",
      "escalationOwner": "Central",
      "escalationOwnerRole": "Central",
      "sla": "2 hours (immediate)",
      "slaDeadline": "2026-11-17T16:14:42.000Z",
      "zone": "West",
      "state": "Maharashtra",
      "centreName": "Bandra Centre",
      "reporterName": "Karan Patel",
      "reporterRole": "AOM"
    }
  }
  ```

#### 2. Get Scoped Incidents Case Log
- **Endpoint:** `GET /api/get-incidents`
- **Access:** Authenticated (Role Scoped: AOM sees own centres; BM sees cluster; RSO sees zone; National/Central see national)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:**
  - `zone=West`: Filter by zone
  - `centreName=Bandra Centre`: Filter by centre/school
  - `state=Maharashtra`: Filter by state
  - `cluster=Mumbai Cluster`: Filter by cluster
  - `severity=Critical`: Filter by `Low`, `Medium`, `High`, or `Critical`
  - `status=Open`: Filter by `Open`, `In Progress`, `Resolved`, or `Closed`
  - `incidentType=POCSO`: Filter by type
  - `startDate=2026-01-01&endDate=2026-03-31`: Filter by date range
  - `search=playground`: Multi-field search across Case ID, description, centre, reporter, state
  - `page=1&limit=10`: Pagination
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "6738f9...",
        "caseId": "INC-20261117-4821",
        "incidentType": "POCSO",
        "severity": "Critical",
        "status": "Open",
        "zone": "West",
        "state": "Maharashtra",
        "centreName": "Bandra Centre",
        "escalationOwner": "Central",
        "sla": "2 hours (immediate)",
        "slaDeadline": "2026-11-17T16:14:42.000Z"
      }
    ]
  }
  ```

#### 3. Incident Reports with Summary Metrics Breakdown
- **Endpoint:** `GET /api/incident-reports`
- **Access:** Authenticated (Role Scoped)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** Same rich filters as `GET /api/get-incidents` (`zone`, `centreName`, `state`, `severity`, `status`, `startDate`, `endDate`, `search`)
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 42,
    "page": 1,
    "limit": 10,
    "summary": {
      "total": 42,
      "open": 8,
      "inProgress": 4,
      "resolved": 12,
      "closed": 18,
      "critical": 3,
      "high": 9,
      "medium": 15,
      "low": 15
    },
    "data": [ ...incidents... ]
  }
  ```

#### 4. Update Incident Details
- **Endpoint:** `PUT /api/update-incident/:id`
- **Access:** Authenticated (Authorized for that centre)
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "description": "Updated incident report notes",
    "immediateActionTaken": "Child counseling initiated.",
    "pendingAction": "Police follow-up on Friday."
  }
  ```
- **Downgrade Restriction Rule (FR-5.2):** If a user tries to downgrade severity of POCSO or Corporal Punishment:
  ```json
  {
    "success": false,
    "message": "POCSO and Corporal Punishment incidents are legally mandated as Critical severity and cannot be downgraded by any user role (FR-5.2)."
  }
  ```

#### 5. Update Incident Status & Case Closure
- **Endpoint:** `PUT /api/update-incident-status/:id`
- **Access:** Authenticated (Role Closure Authority Enforced: FR-7.2)
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "status": "Closed",
    "remarks": "Investigation complete. Mandatory reporting executed and child safely in school."
  }
  ```
- **Permission Block Error (`403 Forbidden`):**
  ```json
  {
    "success": false,
    "message": "Unauthorized: Role Area Operations Manager (AOM) cannot close Critical incidents. Mandatory closure authority: Central (FR-7.2)."
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Incident INC-20261117-4821 status updated to Closed.",
    "data": { "caseId": "INC-20261117-4821", "status": "Closed", "closedBy": "Central Safety Admin" }
  }
  ```

#### 6. Delete Incident
- **Endpoint:** `DELETE /api/delete-incident/:id`
- **Access:** `Central` (All-Activity Admin)
- **Success Response (`200 OK`):** `{ "success": true, "message": "Incident INC-20261117-4821 deleted successfully." }`

---

### 6.7 Analytics Dashboards, Escalation Matrix & Audit Trail

#### 1. National Analytics Dashboard
- **Endpoint:** `GET /api/national-dashboard`
- **Access:** Authenticated (Central, National Head)
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `?state=Maharashtra` (Drill-down for specific state)
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "nationalOverview": {
        "totalCentres": 2260,
        "totalIncidents": 142,
        "nationalIncidentRatePer100Centres": "6.28",
        "nationalRateBand": "High"
      },
      "stateTileMap": [
        {
          "state": "Maharashtra",
          "totalCentres": 260,
          "incidentCount": 24,
          "ratePer100Centres": "9.23",
          "rateBand": "High"
        }
      ],
      "statesToWatch": [
        { "state": "Maharashtra", "incidentCount": 24, "ratePer100Centres": "9.23", "rateBand": "High" }
      ],
      "zoneComparison": [
        { "zone": "West", "centreCount": 350, "incidentCount": 32, "ratePer100Centres": "9.14" }
      ]
    }
  }
  ```

#### 2. Zone Overview Dashboard
- **Endpoint:** `GET /api/incident-stats`
- **Access:** Authenticated (RSO, BM, Central, National Head)
- **Query Parameters:** `zone=West`, `startDate=2026-01-01`, `endDate=2026-03-31`
- **Success Response (`200 OK`):** KPI summary cards, monthly severity trend line, severity-mix donut, and Type × Region cross-tabulation matrix.

#### 3. Standing Escalation Matrix Reference
- **Endpoint:** `GET /api/escalation-matrix`
- **Access:** Public / All Authenticated
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "escalationMatrix": {
      "Critical": { "ownerRole": "Central", "sla": "2 hours (immediate)", "closureAuthority": ["Central"] },
      "High": { "ownerRole": "RSO", "sla": "24 hours", "closureAuthority": ["RSO", "National Head", "Central"] },
      "Medium": { "ownerRole": "BM", "sla": "48 hours", "closureAuthority": ["BM", "RSO", "National Head", "Central"] },
      "Low": { "ownerRole": "AOM", "sla": "3 working days (72 hrs)", "closureAuthority": ["AOM", "BM", "RSO", "National Head", "Central"] }
    },
    "incidentTypes": {
      "POCSO": { "defaultSeverity": "Critical", "nonDowngradable": true },
      "Corporal Punishment": { "defaultSeverity": "Critical", "nonDowngradable": true }
    }
  }
  ```

#### 4. Audit Trail Search
- **Endpoint:** `GET /api/audit-logs`
- **Access:** `Central` (All-Activity Admin)
- **Headers:** `Authorization: Bearer <central_token>`
- **Query Parameters:** `search=aom_bandra`, `action=INCIDENT_CREATED`, `startDate=2026-11-01`, `endDate=2026-11-17`, `page=1`, `limit=20`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "6738f9...",
        "action": "INCIDENT_CREATED",
        "username": "aom_bandra",
        "userRole": "AOM",
        "entityType": "Incident",
        "entityId": "6738fa...",
        "details": { "caseId": "INC-20261117-4821", "severity": "Critical" },
        "ipAddress": "127.0.0.1",
        "createdAt": "2026-11-17T12:00:00.000Z"
      }
    ]
  }
  ```

---

## 7. Clean Codebase Architecture

```
Prototype-Light-House-Backend/
├── Controllers/
│   ├── Incident.Controller.js    # Incident capture, Case log, Multi-filter reports, Dashboards, Audit logs
│   ├── User.Controller.js        # Auth, 5-attempt lockout, Pre-K user management, Soft delete & Restore
│   ├── Zone.Controller.js        # Zone Master management with RSO enrichment & centre counts
│   ├── Cluster.Controller.js     # Cluster Master management with BM enrichment & supervised AOMs
│   └── Centre.Controller.js      # Centre/School Master management with dynamic AOM enrichment
├── Middleware/
│   └── authMiddleware.js         # JWT verification, Pre-K role injection & in-memory caching
├── Models/
│   ├── incident.js               # Case ID, SLA deadline, non-downgradable hooks, aggregation indexes
│   ├── user.js                   # 5-tier Pre-K user model with soft delete & lifecycle management
│   ├── zone.js                   # Zone Master schema (name, code, states, RSO reference)
│   ├── cluster.js                # Cluster Master schema (name, code, zone, BM reference)
│   ├── centre.js                 # Centre/School Master schema (name, code, zone, state, cluster)
│   └── auditLog.js               # Security and operational audit trail schema
├── Routes/
│   ├── auth.route.js             # Authentication routes (/auth/login, /auth/reset-password)
│   ├── user.route.js             # User management routes (/api/users, /api/users/deleted, restore)
│   ├── incident.route.js         # Incident and Dashboard routes (/api/get-incidents, /api/incident-reports)
│   ├── zone.route.js             # Zone Master routes (/api/zones)
│   ├── cluster.route.js          # Cluster Master routes (/api/clusters)
│   └── centre.route.js           # Centre/School Master routes (/api/centres)
├── Utils/
│   ├── prekConstants.js          # Escalation matrix, 10 types, rate bands, 23-state baseline
│   ├── auditLogger.js            # Non-blocking resilient audit logger with multi-field search
│   ├── roleResolver.js           # 5-tier query scoping & strict peer isolation
│   ├── dashboardHelpers.js       # $facet pipelines, date parsing, explain plan parser
│   └── crypto.js                 # AES-256-CBC encryption/decryption with default key fallbacks
├── tests/
│   ├── incident-dashboard.test.js # Core dashboard & normalization unit tests
│   └── prek-brd-v1.1.test.js     # BRD v1.1 compliance test suite, peer isolation, master data & lifecycle tests
├── PREK_ROLE_HIERARCHY_AND_ACCESS_CONTROL_GUIDE.md # 5-Tier role hierarchy, jurisdiction & cURL guide
├── server.js                     # Express app setup, clean route mounting & socket init
└── package.json                  # Dependencies & test scripts
```
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

**Total Tests:** **78 passing** across 22 suites (0 failures).
- 5-Tier role normalization and query scoping.
- Horizontal peer isolation (AOM 1 vs AOM 2) and upward hierarchy visibility.
- 1-AOM-per-centre allocation conflict detection.
- 1-BM-per-cluster exclusivity rule and dynamic AOM supervision.
- Zone Master, Cluster Master & Centre / School Master schema validations and uppercase code normalization.
- User soft delete: centre release, timestamp prefixing, and trashed user listing.
- User restore: duplicate active username/email conflict detection, cluster conflict detection, and AOM centre conflict detection.
- Dynamic personnel transition: automatic linking of incidents to incoming AOMs and role promotion scoping.
- Multi-filter incident reports and breakdown summary calculations.
- Non-downgradable rules for POCSO & Corporal Punishment.
- Fixed escalation matrix and SLA calculation.
- Role-enforced case closure matrix (FR-7.2).
- Unique Case ID generation (`INC-YYYYMMDD-XXXX`).
- National Dashboard rate band calculations and Top 5 "States to Watch".
- 5-attempt account lockout policy and security audit trail.
- 15-minute Access Token & 30-day Refresh Token lifecycles and expiration validation.

---

## 10. Architecture Guides & Reference Documents

| Document | Description |
|---|---|
| [PREK_ROLE_HIERARCHY_AND_ACCESS_CONTROL_GUIDE.md](file:///d:/Pavan%20Raghuwanshi/HBG%20Projects/Light%20House%20Project/Prototype-Light-House-Backend/PREK_ROLE_HIERARCHY_AND_ACCESS_CONTROL_GUIDE.md) | **Comprehensive Role Hierarchy & Access Control Guide:** 5-tier role breakdown (`AOM`, `BM`, `RSO`, `National Head`, `Central`), ASCII hierarchy tree, jurisdiction scoping rules, peer isolation matrix, 1-AOM-per-centre allocation logic, case closure authority, clean cURL payloads for every role, and missing field troubleshooting. |
| `Pre-K_Incident_Portal_BRD_v1.1.pdf` | **Business Requirement Document (BRD v1.1):** Official Pre-K specification for the national incident reporting system. |
