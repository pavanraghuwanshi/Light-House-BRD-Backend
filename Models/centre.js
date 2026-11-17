import mongoose from "mongoose";

/**
 * Pre-K Centre / School Master Schema
 * Represents pre-K schools / centres under the national network (~2,000+ centres).
 * Each centre belongs to a Zone and State, and is managed locally by an Area Operations Manager (AOM).
 */
const centreSchema = new mongoose.Schema(
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
      index: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    city: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    pincode: {
      type: String,
      trim: true,
    },
    cluster: {
      type: String,
      trim: true,
      index: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    contactEmail: {
      type: String,
      trim: true,
    },
    // Optional reference to assigned AOM
    assignedAOM: {
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

centreSchema.index({ zone: 1, state: 1, isActive: 1 });
centreSchema.index({ cluster: 1, isActive: 1 });

const Centre = mongoose.models.Centre || mongoose.model("Centre", centreSchema);

export default Centre;
