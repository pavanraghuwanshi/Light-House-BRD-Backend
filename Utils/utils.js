import { v4 as uuidv4 } from "uuid";

export const timePeriod = (period, from, to) => {
  let fromDate = new Date();
  let toDate = new Date();

  switch (period) {
    case "Today":
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "Yesterday":
      fromDate.setDate(fromDate.getDate() - 1);
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate = new Date(fromDate);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "This Week":
      fromDate.setDate(fromDate.getDate() - fromDate.getDay());
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "Last Seven Days":
      fromDate.setDate(fromDate.getDate() - 6);
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "Previous Week":
      fromDate.setDate(fromDate.getDate() - fromDate.getDay() - 7);
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate = new Date(fromDate);
      toDate.setDate(toDate.getDate() + 6);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "This Month":
      fromDate.setDate(1);
      fromDate.setHours(0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate.setHours(23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);
      break;
    case "Previous Month":
      const now = new Date();

      // Get previous month & year safely
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;

      // FROM: first day of previous month (IST)
      fromDate = new Date(year, month, 1, 0, 0, 0, 0);
      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);

      // TO: last day of previous month (IST)
      toDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);

      break;
      case "Custom":
      if (!from || !to) {
        throw new Error("From date and to date are required for custom period");
      }
      fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);

      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);

      fromDate = new Date(fromDate.getTime() + 5.5 * 60 * 60 * 1000);
      toDate = new Date(toDate.getTime() + 5.5 * 60 * 60 * 1000);

      break;
    default:
      throw new Error("Invalid period selection");
  }

  return { fromDate, toDate };
};


export function generateTicketId() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const randomId = uuidv4().split("-")[0];
  return `TCK-${dateStr}-${randomId}`;
}

export function normalizeRole(role) {
  return role ? role.toLowerCase() : "";
}
