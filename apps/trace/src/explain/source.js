// The real engine source, shown next to the pseudocode.
import pipeline from "../engine/pipeline.js?raw";
import transformer from "../engine/transformer.js?raw";
import copilot from "../engine/copilot.js?raw";

const FILES = { pipeline, transformer, copilot };

// Returns the top-level declaration `name` from an engine file: its first
// line through the end of its indented body (and the closing bracket).
export function sourceOf(file, name) {
  const lines = FILES[file].split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^(export )?(async )?(function ${name}\\(|const ${name} =)`).test(l),
  );
  if (start < 0) return null;
  let end = start;
  while (end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])) end++;
  if (/^[}\])]/.test(lines[end + 1] || "")) end++;
  return {
    file: `src/engine/${file}.js`,
    line: start + 1,
    code: lines.slice(start, end + 1).join("\n"),
  };
}
