import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";
import {
  generateCaseId,
  isNonDowngradable,
  getEscalationDetails,
  calculateSlaDeadline,
} from "../Utils/prekConstants.js";

// Normalization utilities
export const normalizeStatus = (status) => {
  if (!status || typeof status !== "string") return "unknown";
  const s = status.trim().toLowerCase();
  if (s === "open") return "Open";
  if (s === "in progress" || s === "in-progress" || s === "inprogress") return "In Progress";
  if (s === "resolved") return "Resolved";
  if (s === "closed" || s === "close") return "Closed";
  return "unknown";
};

export const normalizeSeverity = (severity) => {
  if (!severity || typeof severity !== "string") return "unknown";
  const s = severity.trim().toLowerCase();
  if (s === "low") return "Low";
  if (s === "medium") return "Medium";
  if (s === "high") return "High";
  if (s === "critical") return "Critical";
  return "unknown";
};

export const normalizeCategory = (category) => {
  if (!category) return category;
  const c = String(category).trim().toLowerCase();
  if (c === "incident") return "Incident";
  if (c === "near miss" || c === "near-miss" || c === "nearmiss") return "Near Miss";
  if (c === "hazard & risk" || c === "hazard and risk" || c === "hazard") return "Hazard & Risk";
  return category.trim();
};

export const normalizeRegion = (region) => {
  if (!region) return region;
  return String(region).trim();
};

const incidentSchema = new mongoose.Schema(
  {
    // FR-6.2: Auto-generated unique Case ID (e.g. INC-YYYYMMDD-XXXX)
    caseId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    // FR-6.1: Capture fields
    incidentType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      default: "Incident",
      set: normalizeCategory,
    },
    severity: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical", "low", "medium", "high", "critical", "unknown"],
      default: "Low",
      set: (val) => {
        const norm = normalizeSeverity(val);
        return norm === "unknown" ? "Low" : norm;
      },
      index: true,
    },
    zone: {
      type: String,
      required: true,
      trim: true,
      set: normalizeRegion,
      index: true, // "North", "South", "East", "West", "Central"
    },
    region: {
      type: String,
      trim: true,
      set: normalizeRegion,
    },
    state: {
      type: String,
      trim: true,
      index: true, // Indian State (e.g. Maharashtra, Karnataka, Delhi) for National Dashboard
    },
    cluster: {
      type: String,
      trim: true,
      index: true, // Business Manager Cluster (e.g. Mumbai Cluster, Pune Cluster)
    },
    centreName: {
      type: String,
      trim: true,
      index: true,
    },
    schoolName: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    reporterName: {
      type: String,
      required: true,
      trim: true,
    },
    reportedBy: {
      type: String,
      trim: true,
    },
    reporterRole: {
      type: String,
      required: true,
      trim: true, // e.g. AOM, BM, RSO, Staff
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    briefDescription: {
      type: String,
      trim: true,
    },
    stakeholders: [
      {
        type: String,
        trim: true,
      },
    ],
    immediateActionTaken: {
      type: String,
      trim: true,
    },
    pendingAction: {
      type: String,
      trim: true,
    },
    // Status tracking (FR-7.1, FR-7.2)
    status: {
      type: String,
      enum: ["Open", "In Progress", "In-Progress", "Resolved", "Closed", "Close", "unknown"],
      default: "Open",
      set: (val) => {
        const norm = normalizeStatus(val);
        return norm === "unknown" ? "Open" : norm;
      },
      index: true,
    },
    closureDate: Date,
    closedBy: {
      userId: String,
      userName: String,
      userRole: String,
      closedAt: Date,
    },
    // Fixed Escalation Matrix fields (FR-5.1, Section 8)
    escalationOwner: {
      type: String,
      trim: true,
    },
    escalationOwnerRole: {
      type: String,
      trim: true,
    },
    sla: {
      type: String,
      trim: true,
    },
    slaHours: {
      type: Number,
    },
    slaDeadline: {
      type: Date,
      index: true,
    },
    slaAction: {
      type: String,
      trim: true,
    },
    escalationStatus: {
      type: String,
      enum: ["No", "Yes"],
      default: "No",
    },
    escalatedTo: String,
    remarks: String,
    // Auditable case history (Section 3, FR-1.5)
    history: [
      {
        changedBy: String,
        userRole: String,
        action: String,
        previousStatus: String,
        newStatus: String,
        timestamp: { type: Date, default: Date.now },
        remarks: String,
      },
    ],
  },
  { timestamps: true, versionKey: false }
);

// Pre-save normalization and business rules hook
incidentSchema.pre("save", function (next) {
  // FR-6.2: Ensure unique Case ID
  if (!this.caseId) {
    this.caseId = generateCaseId();
  }

  // Sync field aliases
  if (this.incidentType && !this.subCategory) {
    this.subCategory = this.incidentType;
  } else if (this.subCategory && !this.incidentType) {
    this.incidentType = this.subCategory;
  }

  if (this.description && !this.briefDescription) {
    this.briefDescription = this.description;
  } else if (this.briefDescription && !this.description) {
    this.description = this.briefDescription;
  }

  if (this.reporterName && !this.reportedBy) {
    this.reportedBy = this.reporterName;
  } else if (this.reportedBy && !this.reporterName) {
    this.reporterName = this.reportedBy;
  }

  if (this.zone && !this.region) {
    this.region = this.zone;
  } else if (this.region && !this.zone) {
    this.zone = this.region;
  }

  if (this.centreName && !this.schoolName) {
    this.schoolName = this.centreName;
  } else if (this.schoolName && !this.centreName) {
    this.centreName = this.schoolName;
  }

  // FR-5.2: Mandatory Critical for Corporal Punishment & POCSO (Non-downgradable)
  if (isNonDowngradable(this.incidentType) || isNonDowngradable(this.subCategory)) {
    this.severity = "Critical";
  } else if (this.severity) {
    const norm = normalizeSeverity(this.severity);
    this.severity = norm === "unknown" ? "Low" : norm;
  }

  // Normalize status
  if (this.status) {
    const norm = normalizeStatus(this.status);
    this.status = norm === "unknown" ? "Open" : norm;
  }

  if (this.category) this.category = normalizeCategory(this.category);
  if (this.region) this.region = normalizeRegion(this.region);
  if (this.zone) this.zone = normalizeRegion(this.zone);

  // Auto-populate escalation rules and SLA from severity (FR-5.1 & FR-6.4)
  const escalation = getEscalationDetails(this.severity);
  this.escalationOwner = escalation.owner;
  this.escalationOwnerRole = escalation.ownerRole;
  this.sla = escalation.sla;
  this.slaHours = escalation.slaHours;
  this.slaAction = escalation.action;
  if (!this.slaDeadline) {
    this.slaDeadline = calculateSlaDeadline(this.date || this.createdAt, this.severity);
  }

  next();
});

// Indexes for high-performance dashboard aggregations & case log lookups
incidentSchema.index({ zone: 1, date: -1 });
incidentSchema.index({ state: 1, date: -1 });
incidentSchema.index({ incidentType: 1, date: -1 });
incidentSchema.index({ severity: 1, date: -1 });
incidentSchema.index({ status: 1, date: -1 });
incidentSchema.index({ date: -1 });
incidentSchema.index({ createdAt: -1 });
incidentSchema.index({ centreName: 1, date: -1 });

const Incident = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);

export default Incident;
