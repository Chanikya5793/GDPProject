// Short, readable values for settings: the Tune panel, Try it buttons and
// the "tuned" chips all print values the same way.
import { SETTINGS, settingFor } from "./schema.js";

export function formatValue(setting, value) {
  if (!setting) return String(value);
  switch (setting.type) {
    case "bool":
      return value ? "on" : "off";
    case "select":
      return setting.options.find((o) => o.value === value)?.label.replace(/\s*\(.*\)$/, "") ?? String(value);
    case "words":
      return `${value?.length ?? 0} word${value?.length === 1 ? "" : "s"}`;
    case "pairs": {
      const n = Object.keys(value ?? {}).length;
      return `${n} alias${n === 1 ? "" : "es"}`;
    }
    case "int":
      return String(value);
    case "number":
      return String(Math.round(value * 1000) / 1000);
    default:
      return String(value);
  }
}

export const formatPath = (path, value) => formatValue(settingFor(path), value);

// "Stop words" (a label from step.tuned) back to its setting path.
export function pathOfLabel(label, track) {
  const tracks = track ? [track, ...Object.keys(SETTINGS).filter((t) => t !== track)] : Object.keys(SETTINGS);
  for (const t of tracks) {
    const s = SETTINGS[t].find((x) => x.label === label);
    if (s) return `${t}.${s.key}`;
  }
  return null;
}

// A value as a change from the default: lists say what they add or remove.
export function formatChange(setting, value) {
  if (setting?.type === "words") {
    const base = setting.default ?? [];
    const added = (value ?? []).filter((w) => !base.includes(w));
    const removed = base.filter((w) => !(value ?? []).includes(w));
    const parts = [added.length && `+ ${added.slice(0, 4).join(", ")}`, removed.length && `− ${removed.slice(0, 4).join(", ")}`];
    return parts.filter(Boolean).join(" ") || "the default list";
  }
  if (setting?.type === "pairs") {
    const extra = Object.entries(value ?? {}).filter(([k, v]) => setting.default?.[k] !== v);
    return extra.length ? extra.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ") : formatValue(setting, value);
  }
  return formatValue(setting, value);
}
