// Where the full TRACE site is published, for links from the planner embed:
// next to the planner build, wherever that is served from.
const base = (typeof import.meta.env === "object" && import.meta.env.BASE_URL) || "/GDPProject/";
export const TRACE_SITE_URL = `${base.replace(/\/?$/, "/")}trace/`;
