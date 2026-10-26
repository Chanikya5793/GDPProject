import { useCallback, useState } from "react";
import { diff, resolve, resolveAll, settingFor, clean } from "./schema.js";

const KEY = "trace-params";

function load() {
  try {
    return resolveAll(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return resolveAll();
  }
}
function save(params) {
  try {
    localStorage.setItem(KEY, JSON.stringify(diff(params)));
  } catch {
    /* the settings just won't persist */
  }
}

// Tuned settings for every track, kept in this browser only.
// set(next): replace all; tune("copilot.limit", 3): one value;
// reset(track?): one track, or everything, back to the defaults.
export function useParams({ persist = true } = {}) {
  const [params, setState] = useState(() => (persist ? load() : resolveAll()));
  const commit = useCallback(
    (next) => {
      setState(next);
      if (persist) save(next);
    },
    [persist],
  );
  const set = useCallback((next) => commit(resolveAll(next)), [commit]);
  const tune = useCallback(
    (path, value) =>
      setState((current) => {
        const setting = settingFor(path);
        if (!setting) return current;
        const [track, key] = path.split(".");
        const next = { ...current, [track]: { ...current[track], [key]: clean(setting, value) } };
        if (persist) save(next);
        return next;
      }),
    [persist],
  );
  const reset = useCallback(
    (track) =>
      setState((current) => {
        const next = track ? { ...current, [track]: resolve(track) } : resolveAll();
        if (persist) save(next);
        return next;
      }),
    [persist],
  );
  return { params, set, tune, reset };
}
