import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../Models/user.js";
import Incident from "../Models/incident.js";
import Zone from "../Models/zone.js";
import Cluster from "../Models/cluster.js";
import Centre from "../Models/centre.js";
import AuditLog from "../Models/auditLog.js";
import { encrypt } from "../Utils/crypto.js";
import {
  PREK_ROLES,
  getEscalationDetails,
  calculateSlaDeadline,
} from "../Utils/prekConstants.js";

dotenv.config();

const mongoUri =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/lighthouse_db";

const DEFAULT_PASSWORD = "Password@123";

const dummyUsers = [
  // 1. Central (All-Activity Admin / Software Admin) - Full Software Control & National Scope
  {
    name: "Central Safety Admin",
    username: "central_admin",
    email: "central@lighthouse.com",
    role: PREK_ROLES.CENTRAL,
    zone: undefined,
    cluster: undefined,
    centres: [],
    isActive: true,
  },
  // 2. National Head - National Strategic Oversight
  {
    name: "Dr. Ananya Roy (National Head)",
    username: "national_head",
    email: "national.head@lighthouse.com",
    role: PREK_ROLES.NATIONAL_HEAD,
    zone: undefined,
    cluster: undefined,
    centres: [],
    isActive: true,
  },
  // 3. Regional Safety Officers (RSO) - Zone Scope
  {
    name: "Vikram Malhotra (RSO West)",
    username: "rso_west",
    email: "rso.west@lighthouse.com",
    role: PREK_ROLES.RSO,
    zone: "West",
    cluster: undefined,
    centres: [],
    isActive: true,
  },
  {
    name: "Rajesh Sharma (RSO North)",
    username: "rso_north",
    email: "rso.north@lighthouse.com",
    role: PREK_ROLES.RSO,
    zone: "North",
    cluster: undefined,
    centres: [],
    isActive: true,
  },
  // 4. Business Managers (BM) - Cluster Scope within Zone
  {
    name: "Meera Nair (BM Mumbai)",
    username: "bm_mumbai",
    email: "bm.mumbai@lighthouse.com",
    role: PREK_ROLES.BM,
    zone: "West",
    cluster: "Mumbai Cluster",
    centres: ["Bandra Centre", "Andheri Centre", "Juhu Centre", "Colaba Centre"],
    isActive: true,
  },
  {
    name: "Siddharth Deshmukh (BM Pune)",
    username: "bm_pune",
    email: "bm.pune@lighthouse.com",
    role: PREK_ROLES.BM,
    zone: "West",
    cluster: "Pune Cluster",
    centres: ["Kothrud Centre", "Baner Centre", "Hinjewadi Centre"],
    isActive: true,
  },
  {
    name: "Pooja Verma (BM Delhi)",
    username: "bm_delhi",
    email: "bm.delhi@lighthouse.com",
    role: PREK_ROLES.BM,
    zone: "North",
    cluster: "Delhi Cluster",
    centres: ["Rohini Centre", "Dwarka Centre", "Saket Centre"],
    isActive: true,
  },
  // 5. Area Operations Managers (AOM) - Distinct Centres (Strict 1-AOM-per-centre)
  {
    name: "Karan Patel (AOM Bandra & Juhu)",
    username: "aom_bandra",
    email: "aom.bandra@lighthouse.com",
    role: PREK_ROLES.AOM,
    zone: "West",
    cluster: "Mumbai Cluster",
    centres: ["Bandra Centre", "Juhu Centre"],
    isActive: true,
  },
  {
    name: "Neha Mehta (AOM Andheri & Colaba)",
    username: "aom_andheri",
    email: "aom.andheri@lighthouse.com",
    role: PREK_ROLES.AOM,
    zone: "West",
    cluster: "Mumbai Cluster",
    centres: ["Andheri Centre", "Colaba Centre"],
    isActive: true,
  },
  {
    name: "Amit Joshi (AOM Pune Area)",
    username: "aom_pune",
    email: "aom.pune@lighthouse.com",
    role: PREK_ROLES.AOM,
    zone: "West",
    cluster: "Pune Cluster",
    centres: ["Kothrud Centre", "Baner Centre"],
    isActive: true,
  },
  {
    name: "Sunil Gupta (AOM Delhi Area)",
    username: "aom_delhi",
    email: "aom.delhi@lighthouse.com",
    role: PREK_ROLES.AOM,
    zone: "North",
    cluster: "Delhi Cluster",
    centres: ["Rohini Centre", "Saket Centre"],
    isActive: true,
  },
];

const dummyIncidents = [
  // 1. POCSO - Critical (Immediate Central Escalation, 2h SLA)
  {
    caseId: "INC-20261114-1001",
    incidentType: "POCSO",
    category: "Incident",
    severity: "Critical",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Bandra Centre",
    date: new Date(Date.now() - 3600 * 1000 * 2), // 2 hours ago
    reporterName: "Karan Patel",
    reportedBy: "Karan Patel",
    reporterRole: "AOM",
    description: "Allegation of inappropriate physical contact reported by parent against external transport vendor staff. Immediate suspension issued.",
    briefDescription: "POCSO allegation against external transport vendor staff.",
    immediateActionTaken: "Vendor staff suspended immediately from premises; child safeguarded; police and central legal team alerted.",
    pendingAction: "Statutory mandatory reporting filing by Central Admin.",
    status: "Open",
    history: [
      {
        changedBy: "aom_bandra",
        userRole: "AOM",
        action: "INCIDENT_CREATED",
        previousStatus: "Open",
        newStatus: "Open",
        timestamp: new Date(Date.now() - 3600 * 1000 * 2),
        remarks: "Emergency critical incident reported.",
      },
    ],
  },
  // 2. Corporal Punishment - Critical (Non-downgradable, 2h SLA)
  {
    caseId: "INC-20261114-1002",
    incidentType: "Corporal Punishment",
    category: "Incident",
    severity: "Critical",
    zone: "North",
    region: "North",
    state: "Delhi",
    centreName: "Rohini Centre",
    date: new Date(Date.now() - 3600 * 1000 * 4), // 4 hours ago
    reporterName: "Sunil Gupta",
    reportedBy: "Sunil Gupta",
    reporterRole: "AOM",
    description: "Assistant teacher used physical disciplinary force on kindergarten student. CCTV footage secured.",
    briefDescription: "Assistant teacher used physical force on child.",
    immediateActionTaken: "Staff relieved of duties pending inquiry; child examined by centre nurse with no external injuries.",
    pendingAction: "Inquiry panel meeting scheduled with Central leadership.",
    status: "In Progress",
    history: [
      {
        changedBy: "aom_delhi",
        userRole: "AOM",
        action: "INCIDENT_CREATED",
        previousStatus: "Open",
        newStatus: "Open",
        timestamp: new Date(Date.now() - 3600 * 1000 * 4),
        remarks: "Initial report logged.",
      },
      {
        changedBy: "central_admin",
        userRole: "Central",
        action: "STATUS_UPDATED",
        previousStatus: "Open",
        newStatus: "In Progress",
        timestamp: new Date(Date.now() - 3600 * 1000 * 2),
        remarks: "Central team actively leading disciplinary probe.",
      },
    ],
  },
  // 3. Unsubstantiated Claims - High (RSO Escalation, 24h SLA)
  {
    caseId: "INC-20261114-1003",
    incidentType: "Unsubstantiated Claims",
    category: "Incident",
    severity: "High",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Andheri Centre",
    date: new Date(Date.now() - 3600 * 1000 * 12),
    reporterName: "Neha Mehta",
    reportedBy: "Neha Mehta",
    reporterRole: "AOM",
    description: "Parent raised verbal concern regarding food quality and alleged allergic reaction; medical reports showed child had home food.",
    briefDescription: "Unsubstantiated allergic reaction claim.",
    immediateActionTaken: "Kitchen inspection performed; batch sample retained.",
    pendingAction: "RSO Vikram Malhotra reviewing kitchen logs and doctor note.",
    status: "Open",
  },
  // 4. Accident - Medium (BM Escalation, 48h SLA)
  {
    caseId: "INC-20261114-1004",
    incidentType: "Accident",
    category: "Incident",
    severity: "Medium",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Juhu Centre",
    date: new Date(Date.now() - 3600 * 1000 * 20),
    reporterName: "Karan Patel",
    reportedBy: "Karan Patel",
    reporterRole: "AOM",
    description: "Child slipped during outdoor free play on wet grass and sustained a minor knee scrape.",
    briefDescription: "Playground minor slip and scrape.",
    immediateActionTaken: "First aid antiseptic applied; parents informed immediately.",
    pendingAction: "Weekly rollup review with BM Meera Nair.",
    status: "Resolved",
    closureDate: new Date(),
    closedBy: {
      userId: "bm_mumbai_id",
      userName: "Meera Nair",
      userRole: "BM",
      closedAt: new Date(),
    },
    remarks: "Playground turf dried and cleared. First aid protocol followed accurately.",
  },
  // 5. Behavioural Issue - Low (AOM Handled, 72h SLA)
  {
    caseId: "INC-20261114-1005",
    incidentType: "Behavioural Issue",
    category: "Incident",
    severity: "Low",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Kothrud Centre",
    date: new Date(Date.now() - 3600 * 1000 * 30),
    reporterName: "Amit Joshi",
    reportedBy: "Amit Joshi",
    reporterRole: "AOM",
    description: "Repeated toy grabbing and minor pushing during group activity in Senior KG.",
    briefDescription: "Mild peer conflict during group activity.",
    immediateActionTaken: "Teacher redirected activity; counselling session held.",
    pendingAction: "Include in weekly summary to BM Siddharth Deshmukh.",
    status: "Closed",
    closureDate: new Date(),
    closedBy: {
      userId: "aom_pune_id",
      userName: "Amit Joshi",
      userRole: "AOM",
      closedAt: new Date(),
    },
    remarks: "Resolved locally with positive reinforcement behavioural chart.",
  },
  // 6. Theft - Low (AOM Handled, 72h SLA)
  {
    caseId: "INC-20261114-1006",
    incidentType: "Theft",
    category: "Incident",
    severity: "Low",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Colaba Centre",
    date: new Date(Date.now() - 3600 * 1000 * 10),
    reporterName: "Neha Mehta",
    reportedBy: "Neha Mehta",
    reporterRole: "AOM",
    description: "Missing activity kit from classroom shelf after evening hobby club.",
    briefDescription: "Activity kit missing from classroom.",
    immediateActionTaken: "Inventory check conducted; found misplaced in admin store.",
    pendingAction: "None. Kit returned to classroom.",
    status: "Closed",
    closureDate: new Date(),
    closedBy: {
      userId: "aom_andheri_id",
      userName: "Neha Mehta",
      userRole: "AOM",
      closedAt: new Date(),
    },
    remarks: "Items reconciled and restored to active shelf.",
  },
  // 7. Health Problem - Medium (BM Handled, 48h SLA)
  {
    caseId: "INC-20261114-1007",
    incidentType: "Health Problem",
    category: "Incident",
    severity: "Medium",
    zone: "North",
    region: "North",
    state: "Delhi",
    centreName: "Saket Centre",
    date: new Date(Date.now() - 3600 * 1000 * 8),
    reporterName: "Sunil Gupta",
    reportedBy: "Sunil Gupta",
    reporterRole: "AOM",
    description: "Three students in playgroup reported mild fever and viral cold symptoms during morning circle.",
    briefDescription: "Seasonal viral fever cluster in playgroup.",
    immediateActionTaken: "Parents contacted for early pickup; classroom disinfected.",
    pendingAction: "Health advisory issued to parents.",
    status: "Open",
  },
  // 8. Near Miss - Low (AOM Handled, 72h SLA)
  {
    caseId: "INC-20261114-1008",
    incidentType: "Near Miss",
    category: "Near Miss",
    severity: "Low",
    zone: "West",
    region: "West",
    state: "Maharashtra",
    centreName: "Baner Centre",
    date: new Date(Date.now() - 3600 * 1000 * 16),
    reporterName: "Amit Joshi",
    reportedBy: "Amit Joshi",
    reporterRole: "AOM",
    description: "Slight wobble noticed on the second-floor stairwell safety gate latch during morning inspection.",
    briefDescription: "Loose safety latch on stairwell gate.",
    immediateActionTaken: "Stairwell blocked immediately; carpenter tightened screws and reinforced latch bracket.",
    pendingAction: "Regular maintenance inspection log updated.",
    status: "Closed",
    closureDate: new Date(),
    closedBy: {
      userId: "aom_pune_id",
      userName: "Amit Joshi",
      userRole: "AOM",
      closedAt: new Date(),
    },
    remarks: "Gate secured and tested with 20kg pressure test.",
  },
];

async function seed() {
  try {
    console.log(`Connecting to single database: ${mongoUri}...`);
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log("Connected successfully to MongoDB.");

    // 0. Seed Zone Master & Centre / School Master
    console.log("\n--- Seeding Zone Master ---");
    const dummyZones = [
      { name: "North", code: "ZN-NORTH", description: "Northern Administrative Zone", states: ["Delhi", "Punjab", "Haryana", "Rajasthan", "Uttar Pradesh", "Himachal Pradesh", "Jammu and Kashmir", "Uttarakhand", "Chandigarh"] },
      { name: "West", code: "ZN-WEST", description: "Western Administrative Zone", states: ["Maharashtra", "Goa", "Gujarat"] },
      { name: "South", code: "ZN-SOUTH", description: "Southern Administrative Zone", states: ["Karnataka", "Tamil Nadu", "Telangana", "Andhra Pradesh", "Kerala"] },
      { name: "East", code: "ZN-EAST", description: "Eastern Administrative Zone", states: ["West Bengal", "Odisha", "Bihar", "Jharkhand", "Assam"] },
      { name: "Central", code: "ZN-CENTRAL", description: "Central Administrative Zone", states: ["Madhya Pradesh", "Chhattisgarh"] },
    ];

    for (const z of dummyZones) {
      await Zone.findOneAndUpdate(
        { name: z.name },
        { ...z, isActive: true, isDeleted: false },
        { upsert: true, new: true }
      );
      console.log(`Seeded Zone: ${z.name} (${z.code})`);
    }

    console.log("\n--- Seeding Cluster Master (for Business Managers) ---");
    const dummyClusters = [
      { name: "Mumbai Cluster", code: "CL-MUM", zone: "West", description: "Mumbai Metropolitan Area Cluster" },
      { name: "Pune Cluster", code: "CL-PUN", zone: "West", description: "Pune Region Cluster" },
      { name: "Delhi Cluster", code: "CL-DEL", zone: "North", description: "National Capital Region Cluster" },
      { name: "Bengaluru Cluster", code: "CL-BLR", zone: "South", description: "Bengaluru Urban Cluster" },
      { name: "Kolkata Cluster", code: "CL-KOL", zone: "East", description: "Kolkata Metropolitan Cluster" },
    ];

    for (const cl of dummyClusters) {
      await Cluster.findOneAndUpdate(
        { name: cl.name },
        { ...cl, isActive: true, isDeleted: false },
        { upsert: true, new: true }
      );
      console.log(`Seeded Cluster: ${cl.name} (${cl.code}) in Zone ${cl.zone}`);
    }

    console.log("\n--- Seeding Centre / School Master ---");
    const dummyCentres = [
      { name: "Bandra Centre", code: "C-BND-01", zone: "West", state: "Maharashtra", city: "Mumbai", cluster: "Mumbai Cluster" },
      { name: "Andheri Centre", code: "C-AND-02", zone: "West", state: "Maharashtra", city: "Mumbai", cluster: "Mumbai Cluster" },
      { name: "Juhu Centre", code: "C-JUH-03", zone: "West", state: "Maharashtra", city: "Mumbai", cluster: "Mumbai Cluster" },
      { name: "Colaba Centre", code: "C-COL-04", zone: "West", state: "Maharashtra", city: "Mumbai", cluster: "Mumbai Cluster" },
      { name: "Kothrud Centre", code: "C-KTH-05", zone: "West", state: "Maharashtra", city: "Pune", cluster: "Pune Cluster" },
      { name: "Baner Centre", code: "C-BNR-06", zone: "West", state: "Maharashtra", city: "Pune", cluster: "Pune Cluster" },
      { name: "Hinjewadi Centre", code: "C-HNW-07", zone: "West", state: "Maharashtra", city: "Pune", cluster: "Pune Cluster" },
      { name: "Rohini Centre", code: "C-ROH-08", zone: "North", state: "Delhi", city: "New Delhi", cluster: "Delhi Cluster" },
      { name: "Dwarka Centre", code: "C-DWK-09", zone: "North", state: "Delhi", city: "New Delhi", cluster: "Delhi Cluster" },
      { name: "Saket Centre", code: "C-SKT-10", zone: "North", state: "Delhi", city: "New Delhi", cluster: "Delhi Cluster" },
    ];

    for (const c of dummyCentres) {
      await Centre.findOneAndUpdate(
        { name: c.name },
        { ...c, isActive: true, isDeleted: false },
        { upsert: true, new: true }
      );
      console.log(`Seeded Centre: ${c.name} (${c.code}) in ${c.zone} - ${c.state}`);
    }

    // 1. Seed Users
    console.log("\n--- Seeding Pre-K Users Across Every Role ---");
    // Ensure no redundant software_admin exists (Central Admin is the software admin)
    await User.deleteOne({ username: "software_admin" });
    for (const u of dummyUsers) {
      const existing = await User.findOne({ username: u.username });
      const passwordHash = encrypt(DEFAULT_PASSWORD);

      if (existing) {
        existing.name = u.name;
        existing.email = u.email;
        existing.password = passwordHash;
        existing.role = u.role;
        existing.zone = u.zone;
        existing.cluster = u.cluster;
        existing.centres = u.centres;
        existing.isActive = true;
        existing.failedLoginAttempts = 0;
        existing.isLocked = false;
        existing.lockUntil = null;
        await existing.save();
        console.log(`Updated user: [${u.role}] @${u.username} (${u.name})`);
      } else {
        const newUser = new User({
          ...u,
          password: passwordHash,
        });
        await newUser.save();
        console.log(`Created user: [${u.role}] @${u.username} (${u.name})`);
      }
    }

    // 2. Seed Incidents
    console.log("\n--- Seeding Incidents Across Severities and Statuses ---");
    for (const inc of dummyIncidents) {
      const escalation = getEscalationDetails(inc.severity);
      const slaDeadline = calculateSlaDeadline(inc.date, inc.severity);

      const incidentPayload = {
        ...inc,
        escalationOwner: escalation.owner,
        escalationOwnerRole: escalation.ownerRole,
        sla: escalation.sla,
        slaHours: escalation.slaHours,
        slaAction: escalation.action,
        slaDeadline,
      };

      const existing = await Incident.findOne({ caseId: inc.caseId });
      if (existing) {
        Object.assign(existing, incidentPayload);
        await existing.save();
        console.log(`Updated incident: ${inc.caseId} [${inc.severity} - ${inc.incidentType}] at ${inc.centreName}`);
      } else {
        const newIncident = new Incident(incidentPayload);
        await newIncident.save();
        console.log(`Created incident: ${inc.caseId} [${inc.severity} - ${inc.incidentType}] at ${inc.centreName}`);
      }
    }

    // 3. Summary of Seeded Data
    const userCount = await User.countDocuments();
    const incidentCount = await Incident.countDocuments();
    console.log(`\n Seeding Complete!`);
    console.log(`   Total Users: ${userCount}`);
    console.log(`   Total Incidents: ${incidentCount}`);
    console.log(`   Default Password for all accounts: ${DEFAULT_PASSWORD}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  }
}

seed();

