// The few steps where the visitor acts: pick a record, confirm, decode.
import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, RotateCcw, Send } from "lucide-react";
import { friendlyDate, friendlyTime, TIE_GAP } from "./engine/pipeline.js";
import { TRANSFORMER_DEFAULTS } from "./engine/transformer.js";

// When the planner asks a question, answer it here; the reply is added to the
// request and the pipeline runs again.
function Conversation({ thread, question, actions }) {
  const [reply, setReply] = useState("");
  return (
    <div className="chat">
      {thread.map((turn, i) => (
        <p key={i} className={`bubble is-${turn.who}`}>
          {turn.text}
        </p>
      ))}
      <p className="bubble is-trace">{question}</p>
      <form
        className="chat-reply"
        onSubmit={(e) => {
          e.preventDefault();
          actions.reply(reply);
          setReply("");
        }}
      >
        <label className="sr-only" htmlFor="reply">
          Your answer
        </label>
        <input
          id="reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Answer, e.g. to call advisor tomorrow at 3 PM"
          autoComplete="off"
        />
        <button className="primary" type="submit" disabled={!reply.trim()} aria-label="Send answer">
          <Send size={15} />
        </button>
      </form>
      <button className="quiet" onClick={actions.editRequest}>
        Or rewrite the whole request
      </button>
    </div>
  );
}

export default function StepActions({
  mode,
  stepId,
  trace,
  records,
  applied,
  notice,
  generatedTokens,
  nextToken,
  thread = [],
  actions,
  params = null,
  ctx = null,
}) {
  const { decision } = trace;
  if (mode === "planner" && stepId === "decide") {
    if (decision.reason === "duplicate") {
      const top = trace.vectors.results[0].score;
      return (
        <div className="actions">
          <p>{decision.message}</p>
          <div className="choices">
            {trace.vectors.results
              .filter((r) => trace.candidates.includes(r.record.id) && top - r.score < TIE_GAP)
              .map(({ record }) => (
                <button key={record.id} onClick={() => actions.chooseRecord(record.id)}>
                  <b>{record.id}</b>
                  <span>
                    {record.title} · {friendlyDate(record.date)}, {friendlyTime(record.time)}
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
          </div>
        </div>
      );
    }
    return (
      <div className="actions">
        {decision.status === "clarify" ? (
          <Conversation thread={thread} question={decision.message} actions={actions} />
        ) : (
          <p>{decision.message}</p>
        )}
        {decision.status !== "clarify" && (
          decision.proposal && (
            <button className="primary" onClick={() => actions.goTo("respond")}>
              Review the change <ArrowRight size={15} />
            </button>
          )
        )}
      </div>
    );
  }
  if (mode === "planner" && stepId === "respond") {
    const p = decision.proposal;
    return (
      <div className="actions">
        {thread.length > 0 && decision.status !== "clarify" && (
          <div className="chat">
            {thread.map((turn, i) => (
              <p key={i} className={`bubble is-${turn.who}`}>
                {turn.text}
              </p>
            ))}
            <p className="bubble is-you">{trace.original}</p>
          </div>
        )}
        {!(decision.status === "clarify" && decision.reason !== "duplicate") && (
          <p aria-live="polite">
            {notice || (applied ? "Applied. Every other record is unchanged." : decision.message)}
          </p>
        )}
        {p && !applied && (
          <div className="proposal">
            <strong>{p.title}</strong>
            <span>
              {p.intent === "delete"
                ? `Delete record ${p.targetId}`
                : `${p.dates.map(friendlyDate).join(", ")} at ${friendlyTime(p.time)}`}
              {p.targetId && ` · expects ${p.targetId} at revision ${p.expectedRevision}`}
            </span>
            <button className="primary" onClick={actions.confirm}>
              <Check size={15} /> Confirm {p.intent === "delete" ? "deletion" : "change"}
            </button>
          </div>
        )}
        {applied && (
          <p className="applied">
            <CheckCircle2 size={18} />
            {p.targetId
              ? `Record ${p.targetId} is now at revision ${records.find((r) => r.id === p.targetId)?.revision ?? "— (deleted)"}.`
              : `${p.dates.length} new record${p.dates.length > 1 ? "s" : ""} created.`}
          </p>
        )}
        {decision.reason === "duplicate" && (
          <button className="primary" onClick={() => actions.goTo("decide")}>
            Choose a reminder first
          </button>
        )}
        {decision.status === "clarify" && decision.reason !== "duplicate" && (
          <Conversation thread={thread} question={decision.message} actions={actions} />
        )}
        <button className="quiet" onClick={actions.openData}>
          See all sample records <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  if (mode === "transformer" && stepId === "decode") {
    // The tuned context window, from the settings or the ctx they built.
    const limit = (params ?? ctx?.params)?.transformer?.context ?? TRANSFORMER_DEFAULTS.context;
    return (
      <div className="actions">
        <button
          className="primary"
          disabled={generatedTokens.length >= limit}
          onClick={actions.appendToken}
        >
          Append “{nextToken}” and run again <ArrowRight size={15} />
        </button>
        {generatedTokens.length > 0 && (
          <>
            <p className="generated">
              {generatedTokens.map((t, i) => (
                <code key={i}>{t}</code>
              ))}
            </p>
            <button className="quiet" onClick={actions.resetTokens}>
              <RotateCcw size={13} /> Reset the sequence
            </button>
          </>
        )}
      </div>
    );
  }
  return null;
}
