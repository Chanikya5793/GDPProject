// Loads the app's modules (JSX included) through Vite's SSR loader, the same
// way src/explain/steps.test.mjs does, so the tests need no extra tooling.
import { createServer } from "vite";

const root = new URL("..", import.meta.url).pathname;

export async function loader() {
  const server = await createServer({
    configFile: `${root}vite.config.js`,
    root,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  return { load: (path) => server.ssrLoadModule(path), close: () => server.close() };
}

// Text a visitor should never see.
export const BAD = /\bNaN\b|\bundefined\b|\[object Object\]/;

// Every string and number reachable from `value`, checked for BAD text and NaN.
export function scan(value, where, seen = new WeakSet(), depth = 0) {
  if (value == null || depth > 8) return;
  if (typeof value === "string") {
    // The planner's id step explains that letters parse to NaN; that is the lesson, not a bug.
    if (BAD.test(value.replace(/not numbers? \(NaN\)/g, ""))) throw new Error(`${where}: “${value.slice(0, 160)}”`);
    return;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new Error(`${where}: NaN`);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  // React elements and Maps/Sets of engine data are not text the guide prints.
  if (value.$$typeof || value instanceof Map || value instanceof Set) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${where}[${i}]`, seen, depth + 1));
  else for (const [k, v] of Object.entries(value)) if (typeof v !== "function") scan(v, `${where}.${k}`, seen, depth + 1);
}
