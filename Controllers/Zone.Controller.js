import Zone from "../Models/zone.js";
import Centre from "../Models/centre.js";
import User from "../Models/user.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";
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

    // Check duplicate
    const existing = await Zone.findOne({
      $or: [
        { name: { $regex: `^${zoneName}$`, $options: "i" } },
        { code: zoneCode },
      ],
      isDeleted: false,
    });

    if (existing) {
      const isNameDup = existing.name.toLowerCase() === zoneName.toLowerCase();
      return res.status(400).json({
        success: false,
        message: isNameDup
          ? `Zone with name '${zoneName}' already exists.`
          : `Zone with code '${zoneCode}' already exists.`,
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

// GET /api/zones - List Zones (Authenticated Users)
export const getZones = async (req, res) => {
  try {
    const { search, isActive } = req.query;
    const filter = { isDeleted: false };

    if (isActive !== undefined) {
      filter.isActive = isActive === "true" || isActive === true;
    }

    if (search && String(search).trim()) {
      const s = String(search).trim();
      filter.$or = [
        { name: { $regex: s, $options: "i" } },
        { code: { $regex: s, $options: "i" } },
        { description: { $regex: s, $options: "i" } },
        { states: { $in: [new RegExp(s, "i")] } },
      ];
    }

    const zones = await Zone.find(filter).sort({ name: 1 }).lean();

    // Enrich zones with active RSO details and centre count
    const enrichedZones = await Promise.all(
      zones.map(async (z) => {
        const [centreCount, activeRSO] = await Promise.all([
          Centre.countDocuments({
            zone: { $regex: `^${z.name}$`, $options: "i" },
            isDeleted: false,
          }),
          User.findOne({
            role: PREK_ROLES.RSO,
            zone: { $regex: `^${z.name}$`, $options: "i" },
            isActive: true,
            isDeleted: { $ne: true },
          })
            .select("name username email phone")
            .lean(),
        ]);

        return {
          ...z,
          centreCount,
          activeRSO: activeRSO
            ? {
                id: activeRSO._id,
                name: activeRSO.name,
                username: activeRSO.username,
                email: activeRSO.email,
                phone: activeRSO.phone || "",
              }
            : null,
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

// GET /api/zones/:id - Get Zone by ID or Code
export const getZoneById = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await Zone.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { code: id.toUpperCase() }, { name: id }],
      isDeleted: false,
    }).lean();

    if (!zone) {
      return res.status(404).json({ success: false, message: "Zone not found." });
    }

    const [centres, activeRSO] = await Promise.all([
      Centre.find({ zone: { $regex: `^${zone.name}$`, $options: "i" }, isDeleted: false })
        .select("name code state city cluster isActive")
        .sort({ name: 1 })
        .lean(),
      User.findOne({
        role: PREK_ROLES.RSO,
        zone: { $regex: `^${zone.name}$`, $options: "i" },
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
        activeRSO,
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
