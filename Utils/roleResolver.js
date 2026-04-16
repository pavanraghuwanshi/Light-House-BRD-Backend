


export const resolveSchoolAndBranch = (req) => {
  const role = req.user.role;

  let schoolId;
  let branchId;
  let parentId;

  if (role === "superAdmin") {
    schoolId = req.body.schoolId;
    branchId = req.body.branchId;
    parentId = req.body.parentId;

    if (!schoolId) {
      throw new Error("schoolId is required for superAdmin");
    }
  }

  else if (role === "school") {
    schoolId = req.user.id;
    branchId = req.body.branchId;
    parentId = req.body.parentId;

    if (!branchId) {
      throw new Error("branchId is required for school");
    }
  }

  else if (role === "branchGroup") {
    schoolId = req.user.schoolId;
    branchId = req.body.branchId;
    parentId = req.body.parentId;

    if (!branchId) {
      throw new Error("branchId is required for branchGroup");
    }
  }

  else if (role === "branch") {
    schoolId = req.user.schoolId;
    branchId = req.user.id;
    parentId = req.body.parentId;

  }
   else if (role === "parent") {
    schoolId = req.user.schoolId;
    branchId = req.user.branchId;
    parentId = req.user.id;


    if (!branchId || !schoolId) {
      throw new Error("Parent must be associated with a branch and school");
    }
  }


  else {
    throw new Error("You are not authorized to perform this action.");
  }

  return { schoolId, branchId, parentId };
};



export const buildQueryWithRole = (req, extraFilters = {}) => {
  const role = req.user.role;

  let filter = {};

  // ✅ 1. Apply role-based restriction
  if (role === "superAdmin") {
    // no restriction
  }

  else if (role === "school") {
    filter.schoolId = req.user.id;
  }

  else if (role === "branchGroup") {
  filter.branchId = { $in: req.user.AssignedBranch };
  }

  else if (role === "branch") {
    filter.schoolId = req.user.schoolId;
    filter.branchId = req.user.id;
  }
  else if (role === "parent") {
  filter.schoolId = req.user.schoolId;
  filter.branchId = req.user.branchId;
  filter.parentId = req.user.id;
}

  else {
    throw new Error("You are not authorized to perform this action.");
  }

  // ✅ 2. Add ALL query params dynamically
  const queryFilters = { ...req.query };

  // ❌ remove pagination & special fields
  const excludeFields = ["page", "limit", "search", "sort"];
  excludeFields.forEach((field) => delete queryFilters[field]);

  // ✅ merge query filters
  Object.keys(queryFilters).forEach((key) => {
    if (queryFilters[key] !== undefined && queryFilters[key] !== "") {
      filter[key] = queryFilters[key];
    }
  });

  // ✅ 3. Add extra filters (optional)
  Object.assign(filter, extraFilters);

  return filter;
};