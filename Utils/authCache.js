import NodeCache from "node-cache";

const authCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

export default authCache;
