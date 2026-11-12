import AuditLog from "../Models/auditLog.js";

/**
 * Log audit events for FR-1.5, FR-8.1, and Non-Functional Auditability
 * Safely persists login, incident creation, status change, escalation update, and admin actions.
 */
export const recordAuditLog = async ({
  req,
  userId,
  username,
  userRole,
  action,
  entityType = "System",
  entityId = null,
  details = {},
}) => {
  try {
    const ipAddress =
      req?.headers?.["x-forwarded-for"] ||
      req?.socket?.remoteAddress ||
      req?.ip ||
      "unknown";
    const userAgent = req?.headers?.["user-agent"] || "unknown";

    const resolvedUserId = userId || req?.user?.id || req?.user?._id || "system";
    const resolvedUsername = username || req?.user?.username || "unknown";
    const resolvedRole = userRole || req?.user?.role || "unknown";

    const logEntry = new AuditLog({
      timestamp: new Date(),
      userId: String(resolvedUserId),
      username: resolvedUsername,
      userRole: resolvedRole,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      details,
      ipAddress,
      userAgent,
    });

    await logEntry.save();
    return logEntry;
  } catch (err) {
    // Audit logging should not crash the primary operational transaction
    console.warn("Audit logging warning:", err.message);
    return null;
  }
};

export default recordAuditLog;
