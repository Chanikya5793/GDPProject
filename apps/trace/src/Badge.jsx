// How much of a copilot step is the real system.
const TEXT = { real: "real", recomputed: "recomputed in your browser", illustration: "illustration" };

export default function Badge({ kind }) {
  return <span className={`badge is-${kind}`}>{TEXT[kind]}</span>;
}
