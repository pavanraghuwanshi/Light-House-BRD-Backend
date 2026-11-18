import Centre from "../Models/centre.js";
import Zone from "../Models/zone.js";
import User from "../Models/user.js";
import Incident from "../Models/incident.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
import { getUserScope, escapeRegex } from "../Utils/roleResolver.js";
import recordAuditLog from "../Utils/auditLogger.js";

/**
 * Pre-K Centre / School Master Controller
 * Manages centres/schools (~2,000+ national network).
 * Links centres to Zones, States, and Area Operations Managers (AOM).
 */

// POST /api/centres - Create Centre / School (Central Admin Only)
export const createCentre = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can create centres/schools.",
      });
    }

    const {
      name,
      code,
      zone,
      state,
      city,
      address,
      pincode,
      cluster,
      contactPhone,
      contactEmail,
    } = req.body;

    const missing = [];
    if (!name || !String(name).trim()) missing.push("name");
    if (!code || !String(code).trim()) missing.push("code");
    if (!zone || !String(zone).trim()) missing.push("zone");
    if (!state || !String(state).trim()) missing.push("state");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
        missingFields: missing,
      });
    }

    const centreName = String(name).trim();
    const centreCode = String(code).trim().toUpperCase();
    const centreZone = String(zone).trim();
    const centreState = String(state).trim();

    // Validate Zone existence in Zone master (fallback to standard zones if master empty)
    const zoneCount = await Zone.countDocuments({ isDeleted: false });
    if (zoneCount > 0) {
      const zoneExists = await Zone.findOne({
        name: { $regex: `^${centreZone}$`, $options: "i" },
        isDeleted: false,
      });
      if (!zoneExists) {
        return res.status(400).json({
          success: false,
          message: `Zone '${centreZone}' is not a registered administrative zone in Zone Master. Please create or verify the zone first.`,
        });
      }
    }

    // 1. Check duplicate against ACTIVE centres
    const existingActive = await Centre.findOne({
      $or: [
        { name: { $regex: `^${centreName}$`, $options: "i" } },
        { code: centreCode },
      ],
      isDeleted: false,
    });

    if (existingActive) {
      const isNameDup = existingActive.name.toLowerCase() === centreName.toLowerCase();
      return res.status(400).json({
        success: false,
        message: isNameDup
          ? `Centre with name '${centreName}' already exists.`
          : `Centre with code '${centreCode}' already exists.`,
      });
    }

    // 2. Check if previously SOFT-DELETED centre exists with this name/code -> prompt restore
    const existingDeleted = await Centre.findOne({
      $or: [
        { name: { $regex: `^${centreName}$`, $options: "i" } },
        { code: centreCode },
      ],
      isDeleted: true,
    });

    if (existingDeleted) {
      return res.status(409).json({
        success: false,
        canRestore: true,
        conflictType: "ALREADY_EXISTS_DELETED",
        message: `Centre/school '${existingDeleted.name}' (${existingDeleted.code}) already exists in the system but is currently deleted (in trash). You can restore it using PUT /api/centres/${existingDeleted._id}/restore instead of creating a duplicate.`,
        existingId: existingDeleted._id,
        deletedCentre: {
          id: existingDeleted._id,
          name: existingDeleted.name,
          code: existingDeleted.code,
          zone: existingDeleted.zone,
          state: existingDeleted.state,
          deletedAt: existingDeleted.deletedAt,
        },
      });
    }

    const centre = new Centre({
      name: centreName,
      code: centreCode,
      zone: centreZone,
      state: centreState,
      city: city ? String(city).trim() : "",
      address: address ? String(address).trim() : "",
      pincode: pincode ? String(pincode).trim() : "",
      cluster: cluster ? String(cluster).trim() : "",
      contactPhone: contactPhone ? String(contactPhone).trim() : "",
      contactEmail: contactEmail ? String(contactEmail).trim() : "",
      isActive: true,
    });

    await centre.save();

    await recordAuditLog({
      req,
      action: "CENTRE_CREATED",
      entityType: "Centre",
      entityId: centre._id,
      details: {
        name: centre.name,
        code: centre.code,
        zone: centre.zone,
        state: centre.state,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Centre '${centre.name}' created successfully.`,
      data: centre,
    });
  } catch (err) {
    console.error("CREATE CENTRE ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/centres - List Centres / Schools (Strictly Role/Zone Scoped & Enriched with assigned AOM)
export const getCentres = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const {
      zone,
      state,
      cluster,
      search,
      isActive,
      unassigned,
      page = 1,
      limit = 50,
    } = req.query;

    const andConditions = [{ isDeleted: false }];

    // Strict Zone / Cluster / Centre Isolation for RSO, BM, AOM
    if (!scope.isNational) {
      if (scope.isRSO) {
        if (!scope.zone) {
          return res.status(200).json({ success: true, total: 0, page: 1, limit: 50, data: [] });
        }
        andConditions.push({ zone: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" } });
      } else if (scope.isBM) {
        if (!scope.cluster) {
          return res.status(200).json({ success: true, total: 0, page: 1, limit: 50, data: [] });
        }
        andConditions.push({ cluster: { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" } });
        if (scope.zone) {
          andConditions.push({ zone: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" } });
        }
      } else if (scope.isAOM) {
        if (scope.centres.length === 0) {
          return res.status(200).json({ success: true, total: 0, page: 1, limit: 50, data: [] });
        }
        andConditions.push({ name: { $in: scope.centres } });
      }
    }

    if (isActive !== undefined) {
      andConditions.push({ isActive: isActive === "true" || isActive === true });
    }

    if (zone && String(zone).trim().toLowerCase() !== "all") {
      andConditions.push({ zone: { $regex: `^${escapeRegex(String(zone).trim())}$`, $options: "i" } });
    }

    if (state && String(state).trim().toLowerCase() !== "all") {
      andConditions.push({ state: { $regex: `^${escapeRegex(String(state).trim())}$`, $options: "i" } });
    }

    if (cluster && String(cluster).trim().toLowerCase() !== "all") {
      andConditions.push({ cluster: { $regex: `^${escapeRegex(String(cluster).trim())}$`, $options: "i" } });
    }

    if (search && String(search).trim()) {
      const s = escapeRegex(String(search).trim());
      andConditions.push({
        $or: [
          { name: { $regex: s, $options: "i" } },
          { code: { $regex: s, $options: "i" } },
          { city: { $regex: s, $options: "i" } },
          { state: { $regex: s, $options: "i" } },
          { address: { $regex: s, $options: "i" } },
        ],
      });
    }

    const filter = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum =
      limit === "all" || limit === "All" || limit === 0 || limit === "0"
        ? 100000
        : Math.max(1, parseInt(limit) || 50);
    const skip = (pageNum - 1) * limitNum;

    // Fetch all active AOMs to dynamically determine centre assignment
    const activeAOMs = await User.find({
      role: PREK_ROLES.AOM,
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select("name username email phone centres")
      .lean();

    // Map centres to assigned AOM
    const centreAOMMap = new Map();
    activeAOMs.forEach((aom) => {
      if (Array.isArray(aom.centres)) {
        aom.centres.forEach((c) => {
          centreAOMMap.set(c.toLowerCase(), {
            id: aom._id,
            name: aom.name,
            username: aom.username,
            email: aom.email,
            phone: aom.phone || "",
          });
        });
      }
    });

    let centres = await Centre.find(filter)
      .sort({ zone: 1, name: 1 })
      .lean();

    // Enrich each centre with assigned AOM
    centres = centres.map((centre) => {
      const assignedAOM = centreAOMMap.get(centre.name.toLowerCase()) || null;
      return {
        ...centre,
        assignedAOM,
        isAssigned: !!assignedAOM,
      };
    });

    // If unassigned filter is applied
    if (unassigned === "true" || unassigned === true) {
      centres = centres.filter((c) => !c.assignedAOM);
    }

    const total = centres.length;
    const paginated = centres.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      data: paginated,
    });
  } catch (err) {
    console.error("GET CENTRES ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/centres/:id - Get Centre by ID or Code (Strictly Role/Zone Scoped)
export const getCentreById = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { id } = req.params;
    const centre = await Centre.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
        { name: { $regex: `^${escapeRegex(id)}$`, $options: "i" } },
      ],
      isDeleted: false,
    }).lean();

    if (!centre) {
      return res.status(404).json({ success: false, message: "Centre not found." });
    }

    // Strict cross-zone / cross-cluster / cross-centre isolation
    if (!scope.isNational) {
      if (scope.isRSO) {
        if (!scope.zone || centre.zone.toLowerCase() !== scope.zone.toLowerCase()) {
          return res.status(403).json({
            success: false,
            message: `Access denied: You can only view centres within your assigned zone (${scope.zone || "None"}).`,
          });
        }
      } else if (scope.isBM) {
        const zoneMismatch = scope.zone && centre.zone.toLowerCase() !== scope.zone.toLowerCase();
        const clusterMismatch = !scope.cluster || !centre.cluster || centre.cluster.toLowerCase() !== scope.cluster.toLowerCase();
        if (zoneMismatch || clusterMismatch) {
          return res.status(403).json({
            success: false,
            message: `Access denied: You can only view centres within your assigned cluster (${scope.cluster || "None"}).`,
          });
        }
      } else if (scope.isAOM) {
        const hasCentre = scope.centres.some((c) => c.toLowerCase() === centre.name.toLowerCase());
        if (!hasCentre) {
          return res.status(403).json({
            success: false,
            message: "Access denied: You can only view your assigned centre(s).",
          });
        }
      }
    }

    // Look up assigned AOM and incident stats
    const [assignedAOM, incidentCount] = await Promise.all([
      User.findOne({
        role: PREK_ROLES.AOM,
        centres: centre.name,
        isActive: true,
        isDeleted: { $ne: true },
      })
        .select("name username email phone")
        .lean(),
      Incident.countDocuments({
        centreName: { $regex: `^${centre.name}$`, $options: "i" },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...centre,
        assignedAOM: assignedAOM
          ? {
              id: assignedAOM._id,
              name: assignedAOM.name,
              username: assignedAOM.username,
              email: assignedAOM.email,
              phone: assignedAOM.phone || "",
            }
          : null,
        incidentCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/centres/:id - Update Centre / School (Central Admin Only)
export const updateCentre = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can update centres/schools.",
      });
    }

    const { id } = req.params;
    const {
      name,
      code,
      zone,
      state,
      city,
      address,
      pincode,
      cluster,
      contactPhone,
      contactEmail,
      isActive,
    } = req.body;

    const centre = await Centre.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: false,
    });

    if (!centre) {
      return res.status(404).json({ success: false, message: "Centre not found." });
    }

    const oldName = centre.name;

    if (name && String(name).trim()) {
      const newName = String(name).trim();
      const dup = await Centre.findOne({
        name: { $regex: `^${newName}$`, $options: "i" },
        _id: { $ne: centre._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `Centre name '${newName}' is already in use.`,
        });
      }
      centre.name = newName;

      // If name changed, update active AOM assignments that had oldName
      if (oldName.toLowerCase() !== newName.toLowerCase()) {
        await User.updateMany(
          { centres: oldName },
          { $set: { "centres.$": newName } }
        );
      }
    }

    if (code && String(code).trim()) {
      const newCode = String(code).trim().toUpperCase();
      const dup = await Centre.findOne({
        code: newCode,
        _id: { $ne: centre._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `Centre code '${newCode}' is already in use.`,
        });
      }
      centre.code = newCode;
    }

    if (zone && String(zone).trim()) centre.zone = String(zone).trim();
    if (state && String(state).trim()) centre.state = String(state).trim();
    if (city !== undefined) centre.city = String(city).trim();
    if (address !== undefined) centre.address = String(address).trim();
    if (pincode !== undefined) centre.pincode = String(pincode).trim();
    if (cluster !== undefined) centre.cluster = String(cluster).trim();
    if (contactPhone !== undefined) centre.contactPhone = String(contactPhone).trim();
    if (contactEmail !== undefined) centre.contactEmail = String(contactEmail).trim();
    if (typeof isActive === "boolean") centre.isActive = isActive;

    await centre.save();

    await recordAuditLog({
      req,
      action: "CENTRE_UPDATED",
      entityType: "Centre",
      entityId: centre._id,
      details: {
        name: centre.name,
        code: centre.code,
        zone: centre.zone,
        state: centre.state,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Centre '${centre.name}' updated successfully.`,
      data: centre,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/centres/:id - Soft Delete Centre / School (Central Admin Only)
export const deleteCentre = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can remove centres/schools.",
      });
    }

    const { id } = req.params;
    const centre = await Centre.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: false,
    });

    if (!centre) {
      return res.status(404).json({ success: false, message: "Centre not found." });
    }

    centre.isDeleted = true;
    centre.isActive = false;
    centre.deletedAt = new Date();
    await centre.save();

    // Release this centre from any active AOM's assignment
    await User.updateMany(
      { centres: centre.name },
      { $pull: { centres: centre.name } }
    );

    await recordAuditLog({
      req,
      action: "CENTRE_DELETED",
      entityType: "Centre",
      entityId: centre._id,
      details: { name: centre.name, code: centre.code },
    });

    return res.status(200).json({
      success: true,
      message: `Centre '${centre.name}' has been soft deleted successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/centres/deleted - List Soft-Deleted Centres (Central & National Head)
export const getDeletedCentres = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (
      requesterRole !== PREK_ROLES.CENTRAL &&
      requesterRole !== PREK_ROLES.NATIONAL_HEAD &&
      req.user?.role !== "superAdmin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only Central and National Head can view soft-deleted centres.",
      });
    }

    const { search, zone, state } = req.query;
    const filter = { isDeleted: true };
    if (zone) filter.zone = { $regex: `^${String(zone).trim()}$`, $options: "i" };
    if (state) filter.state = { $regex: `^${String(state).trim()}$`, $options: "i" };
    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
      ];
    }

    const deletedCentres = await Centre.find(filter).sort({ deletedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      total: deletedCentres.length,
      data: deletedCentres,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/centres/:id/restore - Restore Soft-Deleted Centre (Central Admin Only)
export const restoreCentre = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can restore deleted centres.",
      });
    }

    const { id } = req.params;
    const centre = await Centre.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { code: id.toUpperCase() },
      ],
      isDeleted: true,
    });

    if (!centre) {
      return res.status(404).json({
        success: false,
        message: "Deleted centre not found or centre is already active.",
      });
    }

    // Check if an active centre was created with the same name or code
    const conflict = await Centre.findOne({
      _id: { $ne: centre._id },
      $or: [
        { name: { $regex: `^${centre.name}$`, $options: "i" } },
        { code: centre.code },
      ],
      isDeleted: false,
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: An active centre with name '${conflict.name}' or code '${conflict.code}' already exists. Please rename or delete the existing active centre first.`,
      });
    }

    centre.isDeleted = false;
    centre.isActive = true;
    centre.deletedAt = null;
    await centre.save();

    await recordAuditLog({
      req,
      action: "CENTRE_RESTORED",
      entityType: "Centre",
      entityId: centre._id,
      details: { name: centre.name, code: centre.code, zone: centre.zone, state: centre.state },
    });

    return res.status(200).json({
      success: true,
      message: `Centre '${centre.name}' (${centre.code}) has been restored successfully.`,
      data: centre,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
