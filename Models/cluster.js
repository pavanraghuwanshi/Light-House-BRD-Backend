import mongoose from "mongoose";

/**
 * Pre-K Cluster Master Schema
 * Represents administrative clusters within a Zone (e.g. Mumbai Cluster, Pune Cluster, Delhi Cluster).
 * Each cluster groups multiple pre-K centres/schools and is supervised by a Business Manager (BM).
 */
const clusterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    zone: {
      type: String,
      required: true,
      trim: true,
      index: true, // "North", "South", "East", "West", "Central"
    },
    description: {
      type: String,
      trim: true,
    },
    // Optional direct reference to assigned Business Manager
    assignedBM: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

clusterSchema.index({ zone: 1, isActive: 1 });
clusterSchema.index({ name: 1, isActive: 1 });

const Cluster = mongoose.models.Cluster || mongoose.model("Cluster", clusterSchema);

export default Cluster;
