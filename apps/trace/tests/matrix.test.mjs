// Every step of every track, under a matrix of settings and requests: frames,
// blocks, per-frame state and math, the Tables view, every hover card, the
// Flow summary and the lesson example must run and print no NaN, undefined
// or [object Object]. Rendering every frame on defaults is covered by
// src/explain/steps.test.mjs; here the Tables view renders first, middle and
// last frames.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BAD, loader, scan } from "./load.mjs";

const { load, close } = await loader();
test.after(() => close());
const { SETTINGS, resolveAll } = await load("/src/tune/schema.js");
const { buildCtx } = await load("/src/tune/context.js");
const { compareSteps } = await load("/src/tune/compare.js");
const { STEP_MODULES } = await load("/src/explain/steps/index.js");
const { stepsFor, copilotSteps } = await load("/src/steps.js");
const { summarize } = await load("/src/flow.js");
const { lessonFor } = await load("/src/teach/lessons/index.js");
const { buildTrack } = await load("/src/map/track.js");
const { analyze, applyProposal, SCENARIOS, SEED_RECORDS } = await load("/src/engine/pipeline.js");
const { microscope } = await load("/src/engine/microscope.js");
const { sampleCopilot, SAMPLE_RECORDS } = await load("/src/engine/copilotSample.js");

// Defaults, each switch flipped, each number at its min and max, each other
// option, empty lists, and everything at once at both ends.
function variants(track) {
  const out = [["defaults", {}]];
  const low = {};
  const high = {};
  for (const s of SETTINGS[track]) {
    if (s.type === "bool") {
      out.push([`${s.key}=${!s.default}`, { [s.key]: !s.default }]);
      low[s.key] = high[s.key] = !s.default;
    } else if (s.type === "int" || s.type === "number") {
      out.push([`${s.key}=${s.min}`, { [s.key]: s.min }], [`${s.key}=${s.max}`, { [s.key]: s.max }]);
      low[s.key] = s.min;
      high[s.key] = s.max;
    } else if (s.type === "select") {
      for (const o of s.options) if (o.value !== s.default) out.push([`${s.key}=${o.value}`, { [s.key]: o.value }]);
    } else if (s.type === "words") {
      out.push([`${s.key}=[]`, { [s.key]: [] }], [`${s.key}=[+ remind, call]`, { [s.key]: [...s.default, "remind", "call", "gdp"] }]);
      low[s.key] = [];
    } else if (s.type === "pairs") {
      out.push([`${s.key}={}`, { [s.key]: {} }], [`${s.key}=custom`, { [s.key]: { call: "meeting", report: "gdp" } }]);
      low[s.key] = {};
    }
  }
  out.push(["all low", low], ["all high", high]);
  return out.map(([label, partial]) => [label, resolveAll({ [track]: partial })]);
}

const LONG = `Remind me to ${"call my advisor about the GDP report and ".repeat(16)}tomorrow at 9 AM`;
const UNICODE = "  Ｍove café reminder at 11:00! 👋 Straße ﬁnal résumé C++ 日本語";
const REQUESTS = [
  ...SCENARIOS.map((s) => [s.id, s.prompt]),
  ["empty", ""],
  ["long", LONG],
  ["unicode", UNICODE],
  ["emoji only", "👋 👋"],
  ["numbers", "12 34 5:99 pm 2026"],
];

// What the standalone site builds for one request (App.jsx), plus an applied
// change and two decoded tokens on the first scenario.
function siteContexts(params) {
  const out = REQUESTS.map(([label, text]) => [
    label,
    buildCtx({ trace: analyze(text, SEED_RECORDS, null, params.planner), rerun: (p) => analyze(text, SEED_RECORDS, null, p), records: SEED_RECORDS, params }),
  ]);
  const chosen = analyze(SCENARIOS[0].prompt, SEED_RECORDS, "B", params.planner);
  if (chosen.decision.proposal)
    out.push(["applied B", buildCtx({ trace: chosen, records: applyProposal(SEED_RECORDS, chosen.decision.proposal), applied: true, params })]);
  const first = microscope(analyze(SCENARIOS[1].prompt), [], params.transformer).transformer.nextToken;
  out.push(["decoded", buildCtx({ trace: analyze(SCENARIOS[1].prompt, SEED_RECORDS, null, params.planner), records: SEED_RECORDS, generatedTokens: [first, first], params })]);
  return out;
}

// What the planner embed builds: a real exchange, and the edges a chat can produce.
function copilotContexts(params) {
  const base = sampleCopilot();
  const exchanges = [
    ["sample", base],
    ["no reply", { ...base, response: null }],
    ["no records", { ...base, records: [] }],
    ["long", { ...base, message: LONG, response: null }],
    ["unicode", { ...base, message: UNICODE, response: null }],
    ["stopwords only", { ...base, message: "please show me what i have to do", response: null }],
    ["whitespace", { ...base, message: "   ", response: null }],
    ["not approved", { ...base, records: SAMPLE_RECORDS.map((r) => ({ ...r, approvedForAi: false })) }],
  ];
  return exchanges.map(([label, copilot]) => [label, buildCtx({ trace: analyze(copilot.message, SEED_RECORDS, null, params.planner), params, copilot })]);
}

// Stage text with the same allowance as scan() for the planner's NaN lesson.
const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/not numbers? \(NaN\)/g, "");

function checkTrack(mode, steps, ctx, where, problems) {
  const fail = (at, error) => problems.push(`${where} ${at}: ${error.message ?? error}`);
  let track;
  try {
    track = buildTrack(steps, STEP_MODULES, ctx);
  } catch (error) {
    return fail("buildTrack", error);
  }
  for (const b of track.blocks) {
    try {
      scan(b.title, `block ${b.id} title`);
      for (let r = 0; r < b.rows; r++)
        for (let c = 0; c < b.cols; c++) {
          const cell = b.cell(r, c);
          if (cell) scan({ text: cell.text, full: cell.full, value: cell.value }, `block ${b.id} cell ${r},${c}`);
          if (typeof b.explain === "function" && cell) scan(b.explain(r, c), `block ${b.id} explain ${r},${c}`);
        }
    } catch (error) {
      fail(`block ${b.id}`, error);
    }
  }
  for (const col of track.columns) {
    const m = col.module;
    const id = col.step.id;
    const frames = track.frames.slice(col.start, col.start + col.count).map((f) => f.frame);
    try {
      frames.forEach((frame, fi) => {
        scan(frame.say, `${id} frame ${fi} say`);
        scan(frame.vars, `${id} frame ${fi} vars`);
        if (m?.state)
          for (const [bid, st] of Object.entries(m.state(frame, ctx))) {
            const b = track.byId.get(bid);
            if (b)
              for (const [r, c] of [...(st.active ?? []), ...(st.source ?? [])])
                if (!(r >= 0 && r < b.rows && c >= 0 && c < b.cols)) throw new Error(`frame ${fi}: cell ${r},${c} outside ${bid}`);
          }
        if (m?.math) scan(m.math(frame, ctx), `${id} frame ${fi} math`);
      });
    } catch (error) {
      fail(id, error);
    }
    if (m?.Stage)
      for (const at of new Set([0, frames.length >> 1, frames.length - 1]))
        try {
          const html = renderToString(createElement(m.Stage, { ctx, frame: frames[at], frames, at, seek: () => {} }));
          const bad = textOf(html).match(BAD);
          if (bad) throw new Error(`Tables view prints “${bad[0]}” near “${textOf(html).slice(Math.max(0, bad.index - 60), bad.index + 30).replace(/\s+/g, " ")}”`);
        } catch (error) {
          fail(`${id} Stage frame ${at}`, error);
        }
    try {
      scan(summarize(id, ctx), `${id} summarize`);
    } catch (error) {
      fail(`${id} summarize`, error);
    }
    try {
      const lesson = lessonFor(id, mode);
      if (lesson?.example) {
        const text = lesson.example(ctx);
        assert.equal(typeof text, "string", "example must return a string");
        scan(text, `${id} lesson example`);
      }
    } catch (error) {
      fail(`${id} lesson`, error);
    }
  }
  try {
    for (const [id, c] of compareSteps(steps, ctx)) scan([c.beforeText, c.afterText], `${id} compare`);
  } catch (error) {
    fail("compare", error);
  }
}

for (const mode of ["planner", "transformer", "copilot"])
  for (const [label, params] of variants(mode))
    test(`${mode} · ${label}`, () => {
      const problems = [];
      const contexts = mode === "copilot" ? [...copilotContexts(params), ...siteContexts(params).slice(0, 3)] : siteContexts(params);
      for (const [request, ctx] of contexts) {
        const steps = mode === "copilot" ? copilotSteps(ctx.copilot, params) : stepsFor(mode, params);
        checkTrack(mode, steps, ctx, request, problems);
      }
      assert.deepEqual([...new Set(problems)].slice(0, 12), []);
    });

