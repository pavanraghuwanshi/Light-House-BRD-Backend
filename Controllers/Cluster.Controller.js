import Cluster from "../Models/cluster.js";
import Zone from "../Models/zone.js";
import Centre from "../Models/centre.js";
import User from "../Models/user.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
import { getUserScope, escapeRegex } from "../Utils/roleResolver.js";
import recordAuditLog from "../Utils/auditLogger.js";

/**
 * Pre-K Cluster Master Controller
 * Manages administrative clusters within zones (~25 clusters nationally).
 * Each cluster is supervised by a Business Manager (BM) who oversees the AOMs
 * whose centres belong to that cluster.
 */

// POST /api/clusters - Create Cluster (Central Admin Only)
export const createCluster = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can create administrative clusters.",
      });
    }

    const { name, code, zone, description } = req.body;
    const missing = [];
    if (!name || !String(name).trim()) missing.push("name");
    if (!code || !String(code).trim()) missing.push("code");
    if (!zone || !String(zone).trim()) missing.push("zone");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
        missingFields: missing,
      });
    }

    const clusterName = String(name).trim();
    const clusterCode = String(code).trim().toUpperCase();
    const clusterZone = String(zone).trim();

    // Validate Zone existence in Zone master (if zones have been initialized)
    const zoneCount = await Zone.countDocuments({ isDeleted: false });
    if (zoneCount > 0) {
      const zoneExists = await Zone.findOne({
        name: { $regex: `^${clusterZone}$`, $options: "i" },
        isDeleted: false,
      });
      if (!zoneExists) {
        return res.status(400).json({
          success: false,
          message: `Zone '${clusterZone}' is not a registered administrative zone in Zone Master. Please create or verify the zone first.`,
        });
      }
    }

    // 1. Check duplicate against ACTIVE clusters
    const existingActive = await Cluster.findOne({
      $or: [
        { name: { $regex: `^${clusterName}$`, $options: "i" } },
        { code: clusterCode },
      ],
      isDeleted: false,
    });

    if (existingActive) {
      const isNameDup = existingActive.name.toLowerCase() === clusterName.toLowerCase();
      return res.status(400).json({
        success: false,
        message: isNameDup
          ? `Cluster with name '${clusterName}' already exists.`
          : `Cluster with code '${clusterCode}' already exists.`,
      });
    }

    // 2. Check if previously SOFT-DELETED cluster exists with this name/code -> prompt restore
    const existingDeleted = await Cluster.findOne({
      $or: [
        { name: { $regex: `^${clusterName}$`, $options: "i" } },
        { code: clusterCode },
      ],
      isDeleted: true,
    });

    if (existingDeleted) {
      return res.status(409).json({
        success: false,
        canRestore: true,
        conflictType: "ALREADY_EXISTS_DELETED",
        message: `Cluster '${existingDeleted.name}' (${existingDeleted.code}) already exists in the system but is currently deleted (in trash). You can restore it using PUT /api/clusters/${existingDeleted._id}/restore instead of creating a duplicate.`,
        existingId: existingDeleted._id,
        deletedCluster: {
          id: existingDeleted._id,
          name: existingDeleted.name,
          code: existingDeleted.code,
          zone: existingDeleted.zone,
          deletedAt: existingDeleted.deletedAt,
        },
      });
    }

    const cluster = new Cluster({
      name: clusterName,
      code: clusterCode,
      zone: clusterZone,
      description: description ? String(description).trim() : "",
      isActive: true,
    });

    await cluster.save();

    await recordAuditLog({
      req,
      action: "CLUSTER_CREATED",
      entityType: "Cluster",
      entityId: cluster._id,
      details: {
        name: cluster.name,
        code: cluster.code,
        zone: cluster.zone,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Cluster '${cluster.name}' created successfully in Zone '${cluster.zone}'.`,
      data: cluster,
    });
  } catch (err) {
    console.error("CREATE CLUSTER ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/clusters - List Clusters (Strictly Role/Zone Scoped & Enriched with BM & AOMs)
export const getClusters = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { zone, search, isActive, unassigned } = req.query;
    const andConditions = [{ isDeleted: false }];

    // Strict Zone / Cluster Isolation for RSO, BM, AOM
    if (!scope.isNational) {
      if (scope.isRSO) {
        if (!scope.zone) {
          return res.status(200).json({ success: true, total: 0, data: [] });
        }
        andConditions.push({ zone: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" } });
      } else if (scope.isBM) {
        if (!scope.cluster) {
          return res.status(200).json({ success: true, total: 0, data: [] });
        }
        andConditions.push({ name: { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" } });
        if (scope.zone) {
          andConditions.push({ zone: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" } });
        }
      } else if (scope.isAOM) {
        if (!scope.cluster) {
          return res.status(200).json({ success: true, total: 0, data: [] });
        }
        andConditions.push({ name: { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" } });
        if (scope.zone) {
          andConditions.push({ zone: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" } });
        }
      }
    }

    if (isActive !== undefined) {
      andConditions.push({ isActive: isActive === "true" || isActive === true });
    }

    if (zone && String(zone).trim().toLowerCase() !== "all") {
      andConditions.push({ zone: { $regex: `^${escapeRegex(String(zone).trim())}$`, $options: "i" } });
    }

    if (search && String(search).trim()) {
      const s = escapeRegex(String(search).trim());
      andConditions.push({
        $or: [
          { name: { $regex: s, $options: "i" } },
          { code: { $regex: s, $options: "i" } },
          { zone: { $regex: s, $options: "i" } },
          { description: { $regex: s, $options: "i" } },
        ],
      });
    }

    const filter = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };
    const clusters = await Cluster.find(filter).sort({ zone: 1, name: 1 }).lean();

    // Fetch active BMs to dynamically link assigned BM to each cluster
    const activeBMs = await User.find({
      role: PREK_ROLES.BM,
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select("name username email phone cluster zone")
      .lean();

    const bmMap = new Map();
    activeBMs.forEach((bm) => {
      if (bm.cluster) {
        bmMap.set(bm.cluster.toLowerCase(), {
          id: bm._id,
          name: bm.name,
          username: bm.username,
          email: bm.email,
          phone: bm.phone || "",
        });
      }
    });

    // Fetch all active centres with clusters
    const activeCentres = await Centre.find({ isDeleted: false })
      .select("name code cluster state")
      .lean();

    // Map centres by cluster
    const clusterCentresMap = new Map();
    activeCentres.forEach((c) => {
      if (c.cluster) {
        const k = c.cluster.toLowerCase();
        if (!clusterCentresMap.has(k)) clusterCentresMap.set(k, []);
        clusterCentresMap.get(k).push(c.name);
      }
    });

    // Fetch all active AOMs with their assigned centres
    const activeAOMs = await User.find({
      role: PREK_ROLES.AOM,
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select("name username email phone centres")
      .lean();

    let enrichedClusters = clusters.map((c) => {
      const assignedBM = bmMap.get(c.name.toLowerCase()) || null;
      let centresInCluster = clusterCentresMap.get(c.name.toLowerCase()) || [];

      // Strict peer isolation for AOM: only see own assigned centres (never peer AOM centres)
      if (scope.isAOM) {
        const ownCentresLower = new Set(scope.centres.map((cnt) => cnt.toLowerCase()));
        centresInCluster = centresInCluster.filter((cnt) => ownCentresLower.has(cnt.toLowerCase()));
      }

      // Find all AOMs who manage any centre in this cluster (for AOM, never leak peer AOMs)
      const aomsInCluster = activeAOMs
        .filter((aom) => {
          if (scope.isAOM && String(aom._id) !== String(req.user?.id)) return false;
          return (
            Array.isArray(aom.centres) &&
            aom.centres.some((cnt) => centresInCluster.includes(cnt))
          );
        })
        .map((aom) => ({
          id: aom._id,
          name: aom.name,
          username: aom.username,
          email: aom.email,
          phone: aom.phone || "",
          managedCentres: aom.centres.filter((cnt) => centresInCluster.includes(cnt)),
        }));

      return {
        ...c,
        assignedBM,
        isAssigned: !!assignedBM,
        centreCount: centresInCluster.length,
        centres: centresInCluster,
        aomCount: aomsInCluster.length,
        supervisedAOMs: aomsInCluster,
      };
    });

    if (unassigned === "true" || unassigned === true) {
      enrichedClusters = enrichedClusters.filter((c) => !c.assignedBM);
    }

    return res.status(200).json({
      success: true,
      total: enrichedClusters.length,
      data: enrichedClusters,
    });
  } catch (err) {
    console.error("GET CLUSTERS ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/clusters/:id - Get Cluster by ID, Code, or Name (Strictly Role/Zone Scoped)
export const getClusterById = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { id } = req.params;
    const cluster = await Cluster.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
        { name: { $regex: `^${escapeRegex(id)}$`, $options: "i" } },
      ],
      isDeleted: false,
    }).lean();

    if (!cluster) {
      return res.status(404).json({ success: false, message: "Cluster not found." });
    }

    // Strict cross-zone / cross-cluster isolation
    if (!scope.isNational) {
      if (!scope.zone || cluster.zone.toLowerCase() !== scope.zone.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You can only view clusters within your assigned zone (${scope.zone || "None"}).`,
        });
      }
      if ((scope.isBM || scope.isAOM) && (!scope.cluster || cluster.name.toLowerCase() !== scope.cluster.toLowerCase())) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You can only view your assigned cluster (${scope.cluster || "None"}).`,
        });
      }
    }

    // Active BM assigned to this cluster
    const assignedBM = await User.findOne({
      role: PREK_ROLES.BM,
      cluster: { $regex: `^${escapeRegex(cluster.name)}$`, $options: "i" },
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select("name username email phone zone")
      .lean();

    // Centres in this cluster (strictly scoped to own centres for AOM)
    const centreFilter = {
      cluster: { $regex: `^${escapeRegex(cluster.name)}$`, $options: "i" },
      isDeleted: false,
    };
    if (scope.isAOM) {
      centreFilter.name = { $in: scope.centres };
    }

    const centres = await Centre.find(centreFilter)
      .select("name code state city address isActive")
      .sort({ name: 1 })
      .lean();

    const centreNames = centres.map((c) => c.name);

    // AOMs managing centres in this cluster (never leak peer AOMs to another AOM)
    const aomFilter = {
      role: PREK_ROLES.AOM,
      centres: { $in: centreNames },
      isActive: true,
      isDeleted: { $ne: true },
    };
    if (scope.isAOM) {
      aomFilter._id = req.user?.id;
    }

    const activeAOMs = await User.find(aomFilter)
      .select("name username email phone centres")
      .lean();

    const supervisedAOMs = activeAOMs.map((aom) => ({
      id: aom._id,
      name: aom.name,
      username: aom.username,
      email: aom.email,
      phone: aom.phone || "",
      managedCentres: aom.centres.filter((cnt) => centreNames.includes(cnt)),
    }));

    return res.status(200).json({
      success: true,
      data: {
        ...cluster,
        assignedBM: assignedBM
          ? {
              id: assignedBM._id,
              name: assignedBM.name,
              username: assignedBM.username,
              email: assignedBM.email,
              phone: assignedBM.phone || "",
            }
          : null,
        centreCount: centres.length,
        centres,
        aomCount: supervisedAOMs.length,
        supervisedAOMs,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/clusters/:id/aoms - Supervised AOMs within this Cluster (Strictly Role/Zone Scoped)
export const getClusterAOMs = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { id } = req.params;
    const cluster = await Cluster.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
        { name: { $regex: `^${escapeRegex(id)}$`, $options: "i" } },
      ],
      isDeleted: false,
    }).lean();

    if (!cluster) {
      return res.status(404).json({ success: false, message: "Cluster not found." });
    }

    // Strict cross-zone / cross-cluster isolation
    if (!scope.isNational) {
      if (!scope.zone || cluster.zone.toLowerCase() !== scope.zone.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You can only view AOMs within your assigned zone (${scope.zone || "None"}).`,
        });
      }
      if (scope.isBM && (!scope.cluster || cluster.name.toLowerCase() !== scope.cluster.toLowerCase())) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You can only view AOMs under your assigned cluster (${scope.cluster || "None"}).`,
        });
      }
      if (scope.isAOM) {
        return res.status(403).json({
          success: false,
          message: "Access denied: Area Operations Managers cannot view peer AOM listings.",
        });
      }
    }

    const centres = await Centre.find({
      cluster: { $regex: `^${cluster.name}$`, $options: "i" },
      isDeleted: false,
    }).select("name");

    const centreNames = centres.map((c) => c.name);

    const aoms = await User.find({
      role: PREK_ROLES.AOM,
      centres: { $in: centreNames },
      isActive: true,
      isDeleted: { $ne: true },
    }).select("name username email phone centres zone");

    return res.status(200).json({
      success: true,
      cluster: cluster.name,
      zone: cluster.zone,
      totalAOMs: aoms.length,
      data: aoms.map((aom) => ({
        id: aom._id,
        name: aom.name,
        username: aom.username,
        email: aom.email,
        phone: aom.phone || "",
        zone: aom.zone,
        centresInThisCluster: aom.centres.filter((c) => centreNames.includes(c)),
        allCentres: aom.centres,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/clusters/:id - Update Cluster (Central Admin Only)
export const updateCluster = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can update administrative clusters.",
      });
    }

    const { id } = req.params;
    const { name, code, zone, description, isActive } = req.body;

    const cluster = await Cluster.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: false,
    });

    if (!cluster) {
      return res.status(404).json({ success: false, message: "Cluster not found." });
    }

    const oldName = cluster.name;

    if (name && String(name).trim()) {
      const newName = String(name).trim();
      const dup = await Cluster.findOne({
        name: { $regex: `^${newName}$`, $options: "i" },
        _id: { $ne: cluster._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `Cluster name '${newName}' is already in use.`,
        });
      }
      cluster.name = newName;

      // Cascading update: sync Centre and User (BM) records if cluster name changed
      if (oldName.toLowerCase() !== newName.toLowerCase()) {
        await Promise.all([
          Centre.updateMany(
            { cluster: { $regex: `^${oldName}$`, $options: "i" } },
            { $set: { cluster: newName } }
          ),
          User.updateMany(
            { cluster: { $regex: `^${oldName}$`, $options: "i" }, role: PREK_ROLES.BM },
            { $set: { cluster: newName } }
          ),
        ]);
      }
    }

    if (code && String(code).trim()) {
      const newCode = String(code).trim().toUpperCase();
      const dup = await Cluster.findOne({
        code: newCode,
        _id: { $ne: cluster._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `Cluster code '${newCode}' is already in use.`,
        });
      }
      cluster.code = newCode;
    }

    if (zone && String(zone).trim()) cluster.zone = String(zone).trim();
    if (description !== undefined) cluster.description = String(description).trim();
    if (typeof isActive === "boolean") cluster.isActive = isActive;

    await cluster.save();

    await recordAuditLog({
      req,
      action: "CLUSTER_UPDATED",
      entityType: "Cluster",
      entityId: cluster._id,
      details: {
        name: cluster.name,
        code: cluster.code,
        zone: cluster.zone,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Cluster '${cluster.name}' updated successfully.`,
      data: cluster,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/clusters/:id - Soft Delete Cluster (Central Admin Only)
export const deleteCluster = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can remove administrative clusters.",
      });
    }

    const { id } = req.params;
    const cluster = await Cluster.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: false,
    });

    if (!cluster) {
      return res.status(404).json({ success: false, message: "Cluster not found." });
    }

    // Check if active centres exist in this cluster
    const centreCount = await Centre.countDocuments({
      cluster: { $regex: `^${cluster.name}$`, $options: "i" },
      isDeleted: false,
    });

    if (centreCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Cluster '${cluster.name}': It still has ${centreCount} active centre(s)/school(s) linked. Please reassign those centres to another cluster first.`,
      });
    }

    cluster.isDeleted = true;
    cluster.isActive = false;
    cluster.deletedAt = new Date();
    await cluster.save();

    // Clear cluster assignment from any active BM
    await User.updateMany(
      { cluster: cluster.name, role: PREK_ROLES.BM },
      { $set: { cluster: "" } }
    );

    await recordAuditLog({
      req,
      action: "CLUSTER_DELETED",
      entityType: "Cluster",
      entityId: cluster._id,
      details: { name: cluster.name, code: cluster.code },
    });

    return res.status(200).json({
      success: true,
      message: `Cluster '${cluster.name}' has been soft deleted successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/clusters/deleted - List Soft-Deleted Clusters (Central & National Head)
export const getDeletedClusters = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (
      requesterRole !== PREK_ROLES.CENTRAL &&
      requesterRole !== PREK_ROLES.NATIONAL_HEAD &&
      req.user?.role !== "superAdmin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only Central and National Head can view soft-deleted clusters.",
      });
    }

    const { search, zone } = req.query;
    const filter = { isDeleted: true };
    if (zone) filter.zone = { $regex: `^${String(zone).trim()}$`, $options: "i" };
    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
      ];
    }

    const deletedClusters = await Cluster.find(filter).sort({ deletedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      total: deletedClusters.length,
      data: deletedClusters,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/clusters/:id/restore - Restore Soft-Deleted Cluster (Central Admin Only)
export const restoreCluster = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can restore deleted clusters.",
      });
    }

    const { id } = req.params;
    const cluster = await Cluster.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: true,
    });

    if (!cluster) {
      return res.status(404).json({
        success: false,
        message: "Deleted cluster not found or cluster is already active.",
      });
    }

    // Check if an active cluster was created with the same name or code
    const conflict = await Cluster.findOne({
      _id: { $ne: cluster._id },
      $or: [
        { name: { $regex: `^${cluster.name}$`, $options: "i" } },
        { code: cluster.code },
      ],
      isDeleted: false,
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: An active cluster with name '${conflict.name}' or code '${conflict.code}' already exists. Please rename or delete the existing active cluster first.`,
      });
    }

    cluster.isDeleted = false;
    cluster.isActive = true;
    cluster.deletedAt = null;
    await cluster.save();

    await recordAuditLog({
      req,
      action: "CLUSTER_RESTORED",
      entityType: "Cluster",
      entityId: cluster._id,
      details: { name: cluster.name, code: cluster.code, zone: cluster.zone },
    });

    return res.status(200).json({
      success: true,
      message: `Cluster '${cluster.name}' (${cluster.code}) has been restored successfully.`,
      data: cluster,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
