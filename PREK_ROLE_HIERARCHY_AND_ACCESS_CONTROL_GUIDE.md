# Pre-K Division Incident Portal: Role Hierarchy, Access Controls & Account Creation Guide

> **Reference Document:** `Pre-K_Incident_Portal_BRD_v1.1.pdf`  
> **Backend Architecture:** Pure BRD v1.1 5-Tier RBAC & Incident Safety Management

---

## 1. Executive Overview & Purpose

The **Pre-K Division National Incident & Safety Reporting Portal** covers approximately **2,000 pre-K centres** across **23 Indian States** organized into **5 operational zones** (*North, South, East, West, Central*).

To maintain child safety, strict accountability, data privacy, and timely escalation, the portal implements:
1. **5-Tier Strict Hierarchy:** Clear boundaries from frontline pre-K centres up to national leadership.
2. **Horizontal Peer Isolation:** Same-level peers (AOM vs AOM, BM vs BM) can **never** see or modify each other's incident reports.
3. **1-AOM-per-Centre Rule:** A single pre-K centre can **never** be assigned to multiple AOMs.
4. **Role-Enforced Case Closure Matrix:** Frontline managers cannot close severe safety cases. POCSO and Corporal Punishment are **mandatorily Critical** and can **only** be resolved by Central Admin.

---

## 2. Visual Operational Hierarchy

```
                            ┌──────────────────────────────────────────────┐
                            │      CENTRAL (Software Super Admin)          │
                            │              (~2 users)                      │
                            │   • 100% Full software control               │
                            │   • User provisioning & admin management     │
                            │   • Closes Critical cases (POCSO, CP)        │
                            └──────────────────────┬───────────────────────┘
                                                   │
                            ┌──────────────────────┴───────────────────────┐
                            │            NATIONAL HEAD                     │
                            │              (~3 users)                      │
                            │   • Strategic oversight (All 23 States)      │
                            │   • National & Zone Dashboards               │
                            │   • Can reassign any case                    │
                            └──────────────────────┬───────────────────────┘
                                                   │
                    ┌──────────────────────────────┴──────────────────────────────┐
                    │                                                             │
        ┌───────────┴───────────┐                                     ┌───────────┴───────────┐
        │   RSO (West Zone)     │    ... (4 Zone Officers:            │   RSO (North Zone)    │
        │      (~4 users)       │         West, North, South, East)   │      (~4 users)       │
        │ • Owns High Cases     │                                     │ • Owns High Cases     │
        │ • Zone Dashboard      │                                     │ • Zone Dashboard      │
        └───────────┬───────────┘                                     └───────────┬───────────┘
                    │                                                             │
        ┌───────────┴───────────┐                                     ┌───────────┴───────────┐
        │   BM (Mumbai Cluster) │    ... (~25 Business Managers:      │   BM (Delhi Cluster)  │
        │ • Owns Medium Cases   │         each supervises a cluster)  │ • Owns Medium Cases   │
        └───────────┬───────────┘                                     └───────────┬───────────┘
                    │                                                             │
      ┌─────────────┴─────────────┐                                 ┌─────────────┴─────────────┐
      │                           │                                 │                           │
┌─────┴───────────────┐     ┌─────┴───────────────┐           ┌─────┴───────────────┐     ┌─────┴───────────────┐
│  AOM 1 (Bandra)     │     │  AOM 2 (Andheri)    │           │  AOM 3 (Delhi-1)    │     │  AOM 4 (Delhi-2)    │
│ Centres: [Bandra]   │     │ Centres: [Andheri]  │           │ Centres: [Rohini]   │     │ Centres: [Saket]    │
│ • Owns Low Cases    │     │ • Owns Low Cases    │           │ • Owns Low Cases    │     │ • Owns Low Cases    │
│ ❌ CANNOT SEE AOM 2 │     │ ❌ CANNOT SEE AOM 1 │           │ ❌ CANNOT SEE AOM 4 │     │ ❌ CANNOT SEE AOM 3 │
└─────────────────────┘     └─────────────────────┘           └─────────────────────┘     └─────────────────────┘
```

---

## 3. The 5 Roles: Scope, Permissions & Responsibilities

| Tier | Role Name (`role`) | Approx Users | Assigned Scope | Key Responsibilities & Permissions | Case Closure Authority |
|:---:|---|:---:|---|---|---|
| **1** | **Area Operations Manager (`AOM`)** | ~60 | Local pre-K centres (~30–35 centres each) | First respondent. Reports incidents; investigates locally; resolves & closes **Low-severity** cases. | **Low** only |
| **2** | **Business Manager (`BM`)** | ~25 | Cluster of areas within a zone (~70–100 centres) | Supervises 2–3 AOMs. Owns & resolves **Medium-severity** cases; reviews weekly Low incident logs. | **Low, Medium** |
| **3** | **Regional Safety Officer (`RSO`)** | ~4 | Full Zone (e.g. West, North) (~500 centres) | Leads child-safety investigations; owns **High-severity** cases; accesses Zone Overview Dashboard (`/api/incident-stats`). | **Low, Medium, High** |
| **4** | **National Head (`National Head`)** | ~3 | National (All 5 zones, 23 states) | Executive oversight. Accesses National Dashboard (`/api/national-dashboard`); monitors rate bands & States to Watch; can reassign cases. | **All Severities** |
| **5** | **Central Admin (`Central`)** | ~2 | National (Full Software Control) | Software Super Admin. User administration (`POST /api/users`, `PUT /api/users/:id`); unlocks accounts; audit trail access; owns and resolves **Critical** cases (POCSO & Corporal Punishment). | **All Severities (Sole closer of Critical)** |

---

## 4. Same-Level Peer Isolation & Centre Allocation Rules

### 4.1 Strict Horizontal Peer Isolation
- **AOM 1 cannot see AOM 2's cases:** Even though both are in Mumbai, AOM Bandra cannot access reports belonging to AOM Andheri.
- **BM 1 cannot see BM 2's cases:** BM Mumbai cannot view cases in Pune Cluster.
- **RSO West cannot see RSO North's cases.**
- **Visibility is strictly upward:** A supervisor can see everything below them, but never across to another supervisor at the same rank.

### 4.2 1-AOM-per-Centre Mutual Exclusivity Rule
To guarantee horizontal peer isolation:
- **A single centre can have only ONE active AOM.**
- If Central Admin tries to assign `Bandra Centre` to AOM 2 when it is already assigned to AOM 1, the backend rejects it with **HTTP 400 Bad Request**:
  ```json
  {
    "success": false,
    "message": "Centre allocation conflict: A single centre cannot have multiple AOMs. Conflicting assignments: AOM Bandra (@aom_bandra) already manages: Bandra Centre",
    "conflicts": [
      "AOM Bandra (@aom_bandra) already manages: Bandra Centre"
    ]
  }
  ```

---

## 5. Escalation Matrix, SLAs & Case Closure Rules

### 5.1 Escalation Matrix & SLAs

| Severity | Default Incident Types | Escalation Owner | SLA Window | Operational Action Required | Authorized Closure Roles |
|---|---|---|---|---|---|
| **Low** | Behavioural Issue, Near Miss, Theft | `AOM` | **3 working days** (72 hrs) | Log case, investigate locally, resolve and close. Include in weekly summary to BM. | `AOM`, `BM`, `RSO`, `National Head`, `Central` |
| **Medium** | Accident, Health Problem, Misconduct, Other | `BM` | **48 hours** | Review with AOM, agree corrective action, keep RSO informed via weekly rollup. | `BM`, `RSO`, `National Head`, `Central` |
| **High** | Unsubstantiated Claims | `RSO` | **24 hours** | Lead investigation directly, initiate parent communication, notify National Head & Central. | `RSO`, `National Head`, `Central` |
| **Critical** | **POCSO, Corporal Punishment** | `Central` | **2 hours (immediate)** | Mandatory / statutory reporting triggered. Simultaneous notification to RSO, National Head & Central. | **`Central` only** |

### 5.2 Mandatory Critical (Non-Downgradable Rule)
- **POCSO** and **Corporal Punishment** are classified as **Critical** by law and system policy.
- **No user (not even Central Admin)** can downgrade POCSO or Corporal Punishment to High, Medium, or Low.
- Frontline AOMs and BMs **cannot close** Critical cases. If an AOM attempts `PUT /api/update-incident-status/:id` with `status: "Closed"` on a Critical case, the backend returns:
  ```json
  {
    "success": false,
    "message": "Role 'AOM' is not authorized to close 'Critical' incidents. Closure is restricted to: Central, superAdmin"
  }
  ```

---

## 6. How Central Admin Creates Accounts (`POST /api/users`)

Only **Central Admin (`Central`)** can provision accounts.

### 6.1 Creating an Area Operations Manager (AOM)
An AOM requires a list of **unique centres** they manage:
```http
POST /api/users
Authorization: Bearer <central_admin_token>
Content-Type: application/json

{
  "name": "AOM Rajesh Kumar",
  "username": "aom_rajesh",
  "password": "Password@123",
  "email": "rajesh@lighthouse.com",
  "phone": "9876543210",
  "role": "AOM",
  "zone": "West",
  "cluster": "Mumbai Cluster",
  "centres": ["Bandra Centre", "Juhu Centre"]
}
```

### 6.2 Creating a Business Manager (BM)
A BM supervises a cluster of areas:
```http
POST /api/users
Authorization: Bearer <central_admin_token>
Content-Type: application/json

{
  "name": "BM Siddharth Deshmukh",
  "username": "bm_siddharth",
  "password": "Password@123",
  "email": "siddharth@lighthouse.com",
  "phone": "9876543211",
  "role": "BM",
  "zone": "West",
  "cluster": "Mumbai Cluster",
  "centres": []
}
```

### 6.3 Creating a Regional Safety Officer (RSO)
An RSO manages an entire Zone:
```http
POST /api/users
Authorization: Bearer <central_admin_token>
Content-Type: application/json

{
  "name": "Dipu",
  "username": "dipu",
  "password": "Password@123",
  "phone": "6789054321",
  "role": "RSO",
  "zone": "North-Nagpur",
  "centres": []
}
```
*(Note: If `email` is omitted, the backend now automatically defaults to `<username>@lighthouse.com` so creation succeeds seamlessly!)*

### 6.4 Creating a National Head
```http
POST /api/users
Authorization: Bearer <central_admin_token>
Content-Type: application/json

{
  "name": "Dr. Anita Sharma",
  "username": "national_head_anita",
  "password": "Password@123",
  "email": "anita@lighthouse.com",
  "role": "National Head",
  "zone": "",
  "centres": []
}
```

---

## 7. Explaining the Curl Request & Exact Field Validation

### The Original Curl Request:
```bash
curl --url 'http://63.142.251.57:9000/api/users' \
  -H 'Authorization: Bearer <central_admin_token>' \
  -H 'Content-Type: application/json' \
  --data-raw '{"name":"Dipu","username":"dipu","password":"123456","phone":"6789054321","role":"RSO","zone":"North-Nagpur","centres":[],"mobileNo":"6789054321","schoolId":"6afbeb2e7ea953a15914da16","branchGroupName":"North-Nagpur","regionHeadName":"Dipu","AssignedBranch":[]}'
```

### Why It Failed:
1. **Missing `email` field:** The payload contained `name, username, password, phone, role, zone`, but had **no `email`**.
2. **Old Prototype Legacy Fields:** The payload included legacy parameters (`schoolId`, `branchGroupName`, `regionHeadName`, `AssignedBranch`) from the obsolete school-management prototype rather than the new scalable Pre-K BRD v1.1 model.

---

### Modern Pure BRD v1.1 Validation Logic

The backend now uses strict, scalable, and descriptive validation that tells the client **exactly which fields are missing**:

```json
{
  "success": false,
  "message": "Missing required field: email.",
  "missingFields": ["email"]
}
```

If multiple fields are missing (e.g. both `email` and `phone`):
```json
{
  "success": false,
  "message": "Missing required fields: email, phone.",
  "missingFields": ["email", "phone"]
}
```

---

### Clean Payload for RSO Creation:

```json
{
  "name": "Dipu",
  "username": "dipu",
  "email": "dipu@lighthouse.com",
  "phone": "6789054321",
  "password": "Password@123",
  "role": "RSO",
  "zone": "North"
}
```

### Clean Payload for BM Creation:

```json
{
  "name": "BM Siddharth",
  "username": "bm_siddharth",
  "email": "siddharth@lighthouse.com",
  "phone": "9876543210",
  "password": "Password@123",
  "role": "BM",
  "zone": "West",
  "cluster": "Mumbai Cluster"
}
```

### Clean Payload for AOM Creation:

```json
{
  "name": "AOM Karan",
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

---

## 8. Summary Checklist for Frontend Integrators

- **Logging in (`POST /auth/login`):** Returns `accessToken` (15 minutes) and `refreshToken` (30 days).
- **Session Refresh (`POST /auth/refresh-token`):** Pass `{ "refreshToken": "..." }` when access token expires (`code: "TOKEN_EXPIRED"`).
- **Listing Users (`GET /api/users`):** Central Admin and National Head can view all provisioned users, including their plain-text decrypted passwords.
- **Updating Users (`PUT /api/users/:id`):** Central Admin can update name, email, password, role, zone, cluster, centres, and active status.
- **Reporting Incidents (`POST /api/add-incident`):** Any authenticated user logs an incident in their centre; Case ID (`INC-YYYYMMDD-XXXX`) and SLA deadline are generated automatically.

---

## 9. Personnel Transitions, Staff Replacement & Incident Continuity Model

A common enterprise challenge is handling **promotions, resignations, and replacements** without losing incident history or violating peer privacy.

### 9.1 Principle: Incident Records Belong to Centres and Zones, Not Personal IDs
In this architecture, every incident is stored against:
- `centreName` (e.g. `"Bandra Centre"`)
- `zone` (e.g. `"West"`)
- `state` (e.g. `"Maharashtra"`)

It is **NOT** restricted to a single ephemeral user's ID. When users log in, the backend dynamically queries data based on their active assignments:

| Role | Incident Query Filter | How Transitions Work |
|---|---|---|
| **AOM** | `{ centreName: { $in: user.centres } }` | If AOM 1 resigns and AOM 2 is assigned to `"Bandra Centre"`, AOM 2 **immediately sees all past, open, and closed incidents** for Bandra Centre. |
| **BM** | `{ $or: [{ cluster: user.cluster }, { centreName: { $in: user.centres } }] }` | If a BM changes, the new BM sees all centres and incidents in that cluster. |
| **RSO** | `{ $or: [{ zone: user.zone }, { region: user.zone }] }` | A new RSO immediately sees all clusters and centres in that zone. |
| **National Head** | `{}` (No filter restrictions) | Promoted staff or new National Heads immediately see all 23 states and ~2,000 centres nationally. |
| **Central Admin** | `{}` (Full software control) | Full administrative oversight across all zones, centres, users, and audit logs. |

### 9.2 Practical Transition Scenarios

#### Scenario A: Frontline AOM Resignation or Promotion
1. **Old AOM Leaves / Is Promoted:** Central Admin soft-deletes the old account (`DELETE /api/users/:id`) or updates their role.
2. **Centres Freed:** The assigned centres (e.g. `"Bandra Centre"`, `"Juhu Centre"`) are automatically released.
3. **New AOM Provisioned:** Central Admin provisions a new AOM (e.g. `@aom_pooja`) and assigns those centres:
   ```json
   {
     "name": "Pooja Verma",
     "username": "aom_pooja",
     "email": "pooja@lighthouse.com",
     "phone": "9876543299",
     "password": "Password@123",
     "role": "AOM",
     "zone": "West",
     "centres": ["Bandra Centre", "Juhu Centre"]
   }
   ```
4. **Immediate Visibility:** When Pooja logs in and calls `GET /api/get-incidents`, she sees every incident previously logged at Bandra and Juhu centres. No data is lost.

#### Scenario B: Business Manager (BM) Transition & Cluster Handover
- If a BM leaves or is promoted:
  1. Central Admin soft-deletes the BM account (`DELETE /api/users/:id`), freeing the cluster (e.g. `"Mumbai Cluster"`).
  2. Central Admin provisions a new BM (e.g. `@bm_siddharth`) with `"cluster": "Mumbai Cluster"`.
  3. The new BM **instantly inherits supervision of all AOMs and centres** belonging to `"Mumbai Cluster"` without needing manual centre-by-centre reconfiguration!
  4. The new BM can inspect all supervised AOMs anytime via `GET /api/clusters/:id/aoms`.

#### Scenario C: RSO or National Head Transition
- If the National Head leaves, their account is soft-deleted. A new National Head account is created.
- The new National Head immediately accesses the National Dashboard, Zone comparison, and all incident logs nationally.

---

## 10. 3-Tier Master Data Setup: Zone -> Cluster -> Centre

To make the system fully scalable, master entities are organized hierarchically:

```
        [Zone Master (POST /api/zones)]
             │  (Supervised by RSO)
             ▼
      [Cluster Master (POST /api/clusters)]
             │  (Supervised by BM)
             ▼
   [Centre / School Master (POST /api/centres)]
             │  (Managed locally by AOM)
             ▼
  [Incident Reporting (POST /api/add-incident)]
```

### 10.1 Zone Master Endpoints (`/api/zones`)
- `POST /api/zones`: Create an administrative zone.
  ```json
  {
    "name": "West",
    "code": "ZN-WEST",
    "description": "Western Operational Zone",
    "states": ["Maharashtra", "Goa", "Gujarat"]
  }
  ```
- `GET /api/zones`: Lists all zones, automatically enriched with:
  - `centreCount`: Total active centres under this zone.
  - `activeRSO`: Details of the active Regional Safety Officer assigned to this zone (`name`, `username`, `email`, `phone`).
- `GET /api/zones/:id`: Single zone details with its constituent centres.
- `PUT /api/zones/:id`: Update zone details.
- `DELETE /api/zones/:id`: Soft delete zone (blocked if active centres remain attached).

### 10.2 Cluster Master Endpoints (`/api/clusters`) (For Business Managers)
- `POST /api/clusters`: Create an administrative cluster under a parent zone.
  ```json
  {
    "name": "Mumbai Cluster",
    "code": "CL-MUM",
    "zone": "West",
    "description": "Mumbai Metropolitan Area Cluster"
  }
  ```
- `GET /api/clusters`: Lists all clusters, automatically enriched with:
  - `assignedBM`: Active Business Manager details (`name`, `username`, `email`, `phone`).
  - `centreCount`: Total centres belonging to this cluster.
  - `centres`: Array of centre names.
  - `aomCount`: Count of unique AOMs managing centres in this cluster.
  - `supervisedAOMs`: List of AOMs handling centres in this cluster.
- `GET /api/clusters/:id`: Single cluster details with assigned BM, constituent centres, and supervised AOMs.
- `GET /api/clusters/:id/aoms`: Returns all Area Operations Managers (AOMs) supervised by this cluster's BM.
- `PUT /api/clusters/:id`: Update cluster details. Automatically syncs Centre and BM records if the cluster name changes.
- `DELETE /api/clusters/:id`: Soft delete cluster (blocked if active centres remain attached).

### 10.3 Centre / School Master Endpoints (`/api/centres`)
- `POST /api/centres`: Create a pre-K centre under a cluster, zone, and state.
  ```json
  {
    "name": "Bandra Centre",
    "code": "C-BND-01",
    "cluster": "Mumbai Cluster",
    "zone": "West",
    "state": "Maharashtra",
    "city": "Mumbai",
    "contactPhone": "022-26400111"
  }
  ```
- `GET /api/centres`: Lists centres filterable by `zone`, `state`, `cluster`, `search=`, and `unassigned=true` (centres without an AOM). Automatically enriches each centre with its currently assigned active AOM.
- `GET /api/centres/:id`: Single centre details with assigned AOM and total incident count.
- `PUT /api/centres/:id`: Update centre details. Automatically syncs assigned AOMs if the centre name changes.
- `DELETE /api/centres/:id`: Soft delete centre. Automatically pulls the centre from any assigned AOM's allocation.

---

## 11. User Soft Delete & Conflict-Safe Restoration Lifecycle

### 11.1 Soft Delete (`DELETE /api/users/:id`)
- Sets `isDeleted: true`, `isActive: false`, `deletedAt: new Date()`, `deletedBy: adminId`.
- **Frees Centres:** Empties `centres: []` and preserves them in `previousCentres: [...]` so replacement staff can be assigned immediately.
- **Prefixes Credentials:** Prefixes `username` and `email` with `deleted_<timestamp>_` to prevent database index collisions if a new account is registered with the same name.

### 11.2 Trashed Accounts List (`GET /api/users/deleted`)
- Accessible by Central Admin and National Head.
- Displays original usernames, emails, roles, deleted timestamps, and released centre assignments.

### 11.3 Conflict-Safe Restore (`PUT /api/users/:id/restore`)
When an administrator attempts to restore a soft-deleted user, the backend performs 3 automated safety checks:

1. **Username Collision Check:** If another active user was created with this username while the account was deleted:
   ```json
   {
     "success": false,
     "message": "Cannot restore: An active user with username '@karan_aom' already exists (Karan Patel, role: AOM). To restore this user, either rename or delete the existing active user first.",
     "conflictType": "USERNAME_EXISTS"
   }
   ```
2. **Email Collision Check:** If another active user registered with this email, the restore is blocked with an explicit conflict message.
3. **1-AOM Centre Exclusivity Check:** If the user is an `AOM` and their original centres (`previousCentres`) were reassigned to another active AOM, the restore is blocked with an allocation conflict message:
   ```json
   {
     "success": false,
     "message": "Cannot restore AOM with original centres: Centre allocation conflict. Conflicting assignments: Pooja (@aom_pooja) currently manages: Bandra Centre. Please provide new unassigned centres or reassign existing active AOMs first.",
     "conflictType": "CENTRE_ALLOCATION_CONFLICT"
   }
   ```
4. **Successful Restore:** If all checks pass, the account is restored to `isActive: true`, credentials are restored to their original values, and previous centre allocations are re-established.

---

## 12. Comprehensive Incident Reports & Multi-Filter Query Reference

The incident reporting system (`GET /api/get-incidents` and `GET /api/incident-reports`) supports extensive filtering across the entire hierarchy:

### Query Parameters

| Parameter | Type | Example | Description |
|---|---|---|---|
| `zone` | String | `zone=West` | Filter by operational zone |
| `centreName` / `schoolName` | String | `centreName=Bandra Centre` | Filter by specific centre/school |
| `state` | String | `state=Maharashtra` | Filter by Indian state |
| `cluster` | String | `cluster=Mumbai Cluster` | Filter by BM cluster |
| `severity` | String | `severity=Critical` | Filter by `Low`, `Medium`, `High`, or `Critical` |
| `status` | String | `status=Open` | Filter by `Open`, `In Progress`, `Resolved`, or `Closed` |
| `incidentType` | String | `incidentType=POCSO` | Filter by incident type |
| `startDate` | String | `startDate=2026-01-01` | Start of date range (YYYY-MM-DD) |
| `endDate` | String | `endDate=2026-03-31` | End of date range (YYYY-MM-DD) |
| `search` / `q` | String | `search=playground` | Multi-field search across Case ID, description, centre, reporter, and state |
| `includeStats` | Boolean | `includeStats=true` | Returns summary breakdown counters alongside incident records |
| `page` & `limit` | Integer | `page=1&limit=20` | Pagination controls |

### Example Reports Response (`GET /api/incident-reports?zone=West`):

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
  "data": [
    {
      "caseId": "INC-20261113-1001",
      "incidentType": "POCSO",
      "severity": "Critical",
      "zone": "West",
      "state": "Maharashtra",
      "centreName": "Bandra Centre",
      "status": "Open",
      "escalationOwner": "Central",
      "sla": "2 hours (immediate)",
      "date": "2026-11-13T10:00:00.000Z"
    }
  ]
}
```
