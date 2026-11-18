import Zone from "../Models/zone.js";
import Centre from "../Models/centre.js";
import User from "../Models/user.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
import { getUserScope, escapeRegex } from "../Utils/roleResolver.js";
import recordAuditLog from "../Utils/auditLogger.js";

/**
 * Pre-K Zone Master Controller
 * Manages administrative zones (North, South, East, West, Central, and custom regional zones).
 */

// POST /api/zones - Create Zone (Central Admin Only)
export const createZone = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can create administrative zones.",
      });
    }

    const { name, code, description, states, cities } = req.body;
    const missing = [];
    if (!name || !String(name).trim()) missing.push("name");
    if (!code || !String(code).trim()) missing.push("code");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
        missingFields: missing,
      });
    }

    const zoneName = String(name).trim();
    const zoneCode = String(code).trim().toUpperCase();

    // 1. Check duplicate against ACTIVE zones
    const existingActive = await Zone.findOne({
      $or: [
        { name: { $regex: `^${zoneName}$`, $options: "i" } },
        { code: zoneCode },
      ],
      isDeleted: false,
    });

    if (existingActive) {
      const isNameDup = existingActive.name.toLowerCase() === zoneName.toLowerCase();
      return res.status(400).json({
        success: false,
        message: isNameDup
          ? `Zone with name '${zoneName}' already exists.`
          : `Zone with code '${zoneCode}' already exists.`,
      });
    }

    // 2. Check if previously SOFT-DELETED zone exists with this name/code -> prompt restore
    const existingDeleted = await Zone.findOne({
      $or: [
        { name: { $regex: `^${zoneName}$`, $options: "i" } },
        { code: zoneCode },
      ],
      isDeleted: true,
    });

    if (existingDeleted) {
      return res.status(409).json({
        success: false,
        canRestore: true,
        conflictType: "ALREADY_EXISTS_DELETED",
        message: `Zone '${existingDeleted.name}' (${existingDeleted.code}) already exists in the system but is currently deleted (in trash). You can restore it using PUT /api/zones/${existingDeleted._id}/restore instead of creating a duplicate.`,
        existingId: existingDeleted._id,
        deletedZone: {
          id: existingDeleted._id,
          name: existingDeleted.name,
          code: existingDeleted.code,
          deletedAt: existingDeleted.deletedAt,
        },
      });
    }

    // Both states and cities are completely optional (zones can be multi-state, single-state, multi-city, single-city, or custom territorial)
    const stateList = Array.isArray(states)
      ? states.map((s) => String(s).trim()).filter(Boolean)
      : typeof states === "string" && states.trim()
      ? states.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const cityList = Array.isArray(cities)
      ? cities.map((c) => String(c).trim()).filter(Boolean)
      : typeof cities === "string" && cities.trim()
      ? cities.split(",").map((c) => c.trim()).filter(Boolean)
      : [];

    const zone = new Zone({
      name: zoneName,
      code: zoneCode,
      description: description ? String(description).trim() : "",
      states: stateList,
      cities: cityList,
      isActive: true,
    });

    await zone.save();

    await recordAuditLog({
      req,
      action: "ZONE_CREATED",
      entityType: "Zone",
      entityId: zone._id,
      details: { name: zone.name, code: zone.code, states: zone.states },
    });

    return res.status(201).json({
      success: true,
      message: `Zone '${zone.name}' created successfully.`,
      data: zone,
    });
  } catch (err) {
    console.error("CREATE ZONE ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/zones - List Zones (Scoped by Role: National sees all; RSO/BM/AOM see ONLY their assigned zone)
export const getZones = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { search, isActive } = req.query;
    const andConditions = [{ isDeleted: false }];

    // Strict Zone Isolation for RSO, BM, AOM
    if (!scope.isNational) {
      if (!scope.zone) {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }
      andConditions.push({
        name: { $regex: `^${escapeRegex(scope.zone)}$`, $options: "i" },
      });
    }

    if (isActive !== undefined) {
      andConditions.push({ isActive: isActive === "true" || isActive === true });
    }

    if (search && String(search).trim()) {
      const s = escapeRegex(String(search).trim());
      andConditions.push({
        $or: [
          { name: { $regex: s, $options: "i" } },
          { code: { $regex: s, $options: "i" } },
          { description: { $regex: s, $options: "i" } },
          { states: { $in: [new RegExp(s, "i")] } },
        ],
      });
    }

    const filter = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };
    const zones = await Zone.find(filter).sort({ name: 1 }).lean();

    // Enrich zones with all active RSOs in that zone and role-scoped centre count
    const enrichedZones = await Promise.all(
      zones.map(async (z) => {
        const zoneRegex = { $regex: `^${escapeRegex(z.name)}$`, $options: "i" };
        const centreFilter = { zone: zoneRegex, isDeleted: false };
        if (scope.isAOM) {
          centreFilter.name = { $in: scope.centres };
        } else if (scope.isBM) {
          centreFilter.cluster = scope.cluster
            ? { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" }
            : { $in: [] };
        }

        const [centreCount, activeRSOList] = await Promise.all([
          Centre.countDocuments(centreFilter),
          User.find({
            role: PREK_ROLES.RSO,
            zone: zoneRegex,
            isActive: true,
            isDeleted: { $ne: true },
          })
            .select("name username email phone")
            .lean(),
        ]);

        const formattedRSOs = activeRSOList.map((rso) => ({
          id: rso._id,
          name: rso.name,
          username: rso.username,
          email: rso.email,
          phone: rso.phone || "",
        }));

        return {
          ...z,
          centreCount,
          activeRSO: formattedRSOs[0] || null,
          activeRSOs: formattedRSOs,
        };
      })
    );

    return res.status(200).json({
      success: true,
      total: enrichedZones.length,
      data: enrichedZones,
    });
  } catch (err) {
    console.error("GET ZONES ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/zones/:id - Get Zone by ID or Code (Scoped by Role)
export const getZoneById = async (req, res) => {
  try {
    const scope = getUserScope(req);
    const { id } = req.params;
    const zone = await Zone.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { code: id.toUpperCase() }, { name: { $regex: `^${escapeRegex(id)}$`, $options: "i" } }],
      isDeleted: false,
    }).lean();

    if (!zone) {
      return res.status(404).json({ success: false, message: "Zone not found." });
    }

    // Strict cross-zone isolation for non-National roles (RSO, BM, AOM)
    if (!scope.isNational) {
      if (!scope.zone || zone.name.toLowerCase() !== scope.zone.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You are only authorized to access data for your assigned zone (${scope.zone || "None"}).`,
        });
      }
    }

    const zoneRegex = { $regex: `^${escapeRegex(zone.name)}$`, $options: "i" };
    const centreFilter = { zone: zoneRegex, isDeleted: false };
    if (scope.isAOM) {
      centreFilter.name = { $in: scope.centres };
    } else if (scope.isBM) {
      centreFilter.cluster = scope.cluster
        ? { $regex: `^${escapeRegex(scope.cluster)}$`, $options: "i" }
        : { $in: [] };
    }

    const [centres, activeRSOList] = await Promise.all([
      Centre.find(centreFilter)
        .select("name code state city cluster isActive")
        .sort({ name: 1 })
        .lean(),
      User.find({
        role: PREK_ROLES.RSO,
        zone: zoneRegex,
        isActive: true,
        isDeleted: { $ne: true },
      })
        .select("name username email phone")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...zone,
        centres,
        activeRSO: activeRSOList[0] || null,
        activeRSOs: activeRSOList,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/zones/:id - Update Zone (Central Admin Only)
export const updateZone = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can update administrative zones.",
      });
    }

    const { id } = req.params;
    const { name, code, description, states, cities, isActive } = req.body;

    const zone = await Zone.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { code: id.toUpperCase() }],
      isDeleted: false,
    });

    if (!zone) {
      return res.status(404).json({ success: false, message: "Zone not found." });
    }

    if (name && String(name).trim()) {
      const newName = String(name).trim();
      const dup = await Zone.findOne({
        name: { $regex: `^${newName}$`, $options: "i" },
        _id: { $ne: zone._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({ success: false, message: `Zone name '${newName}' is already in use.` });
      }
      zone.name = newName;
    }

    if (code && String(code).trim()) {
      const newCode = String(code).trim().toUpperCase();
      const dup = await Zone.findOne({
        code: newCode,
        _id: { $ne: zone._id },
        isDeleted: false,
      });
      if (dup) {
        return res.status(400).json({ success: false, message: `Zone code '${newCode}' is already in use.` });
      }
      zone.code = newCode;
    }

    if (description !== undefined) zone.description = String(description).trim();
    if (states !== undefined) {
      zone.states = Array.isArray(states)
        ? states.map((s) => String(s).trim()).filter(Boolean)
        : typeof states === "string" && states.trim()
        ? states.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    }
    if (cities !== undefined) {
      zone.cities = Array.isArray(cities)
        ? cities.map((c) => String(c).trim()).filter(Boolean)
        : typeof cities === "string" && cities.trim()
        ? cities.split(",").map((c) => c.trim()).filter(Boolean)
        : [];
    }
    if (typeof isActive === "boolean") zone.isActive = isActive;

    await zone.save();

    await recordAuditLog({
      req,
      action: "ZONE_UPDATED",
      entityType: "Zone",
      entityId: zone._id,
      details: { name: zone.name, code: zone.code, isActive: zone.isActive },
    });

    return res.status(200).json({
      success: true,
      message: `Zone '${zone.name}' updated successfully.`,
      data: zone,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/zones/:id - Soft Delete / Deactivate Zone (Central Admin Only)
export const deleteZone = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can remove administrative zones.",
      });
    }

    const { id } = req.params;
    const zone = await Zone.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { code: id.toUpperCase() }],
      isDeleted: false,
    });

    if (!zone) {
      return res.status(404).json({ success: false, message: "Zone not found." });
    }

    // Check if active centres exist in this zone
    const centreCount = await Centre.countDocuments({
      zone: { $regex: `^${zone.name}$`, $options: "i" },
      isDeleted: false,
    });

    if (centreCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Zone '${zone.name}': It still has ${centreCount} active centre(s)/school(s) linked. Please reassign or remove centres first.`,
      });
    }

    zone.isDeleted = true;
    zone.isActive = false;
    zone.deletedAt = new Date();
    await zone.save();

    await recordAuditLog({
      req,
      action: "ZONE_DELETED",
      entityType: "Zone",
      entityId: zone._id,
      details: { name: zone.name, code: zone.code },
    });

    return res.status(200).json({
      success: true,
      message: `Zone '${zone.name}' has been soft deleted successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/zones/deleted - List Soft-Deleted Zones (Central & National Head)
export const getDeletedZones = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (
      requesterRole !== PREK_ROLES.CENTRAL &&
      requesterRole !== PREK_ROLES.NATIONAL_HEAD &&
      req.user?.role !== "superAdmin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only Central and National Head can view soft-deleted zones.",
      });
    }

    const { search } = req.query;
    const filter = { isDeleted: true };
    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
      ];
    }

    const deletedZones = await Zone.find(filter).sort({ deletedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      total: deletedZones.length,
      data: deletedZones,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/zones/:id/restore - Restore Soft-Deleted Zone (Central Admin Only)
export const restoreZone = async (req, res) => {
  try {
    const requesterRole = normalizePrekRole(req.user?.role);
    if (requesterRole !== PREK_ROLES.CENTRAL && req.user?.role !== "superAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only Central (All-Activity Admin) can restore deleted zones.",
      });
    }

    const { id } = req.params;
    const zone = await Zone.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { code: id.toUpperCase() }],
      isDeleted: true,
    });

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: "Deleted zone not found or zone is already active.",
      });
    }

    // Check if an active zone was created with the same name or code
    const conflict = await Zone.findOne({
      _id: { $ne: zone._id },
      $or: [
        { name: { $regex: `^${zone.name}$`, $options: "i" } },
        { code: zone.code },
      ],
      isDeleted: false,
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: An active zone with name '${conflict.name}' or code '${conflict.code}' already exists. Please rename or delete the existing active zone first.`,
      });
    }

    zone.isDeleted = false;
    zone.isActive = true;
    zone.deletedAt = null;
    await zone.save();

    await recordAuditLog({
      req,
      action: "ZONE_RESTORED",
      entityType: "Zone",
      entityId: zone._id,
      details: { name: zone.name, code: zone.code },
    });

    return res.status(200).json({
      success: true,
      message: `Zone '${zone.name}' (${zone.code}) has been restored successfully.`,
      data: zone,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
