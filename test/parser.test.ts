/**
 * Parser + graph unit tests.
 *
 * NOTE: these import from ../dist (compiled output), not ../src, because Node's
 * --experimental-strip-types does not rewrite `.js` import specifiers to `.ts`.
 * `npm test` therefore runs `npm run build` first. Test files themselves must
 * stay limited to erasable TS syntax (no enums / namespaces / parameter props).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseSession, aggregateTools, aggregateSessions } from "../dist/parser.js";
import { spreadTokens, buildAggregateGraph, buildChronologicalGraph, toolColor } from "../dist/graph.js";

const FIXTURE = join(process.cwd(), "test", "fixtures", "session-demo.jsonl");

test("parseSession builds a valid Session from the demo fixture", () => {
  const s = parseSession(FIXTURE, "demo-project");
  assert.equal(s.id, "session-demo");
  assert.equal(s.project, "demo-project");
  assert.ok(s.turns.length > 0, "at least one turn");
  assert.equal(typeof s.model, "string");
  assert.ok(s.totalTokens > 0, "total tokens positive");

  // Every turn has an index and (for a real session) some tool calls.
  for (const t of s.turns) {
    assert.ok(Number.isInteger(t.index));
    assert.ok(t.prompt.length > 0, "turn has a prompt");
  }
});

test("per-message usage accumulates into session totals exactly", () => {
  const s = parseSession(FIXTURE, "demo-project");
  const fromUsage = s.totalInput + s.totalOutput + s.totalCacheRead + s.totalCacheWrite;
  assert.equal(s.totalTokens, fromUsage);
});

test("aggregateTools collapses by tool and sorts by token share", () => {
  const s = parseSession(FIXTURE, "demo-project");
  spreadTokens(s); // per-call attribution heuristic must run before aggregation
  const aggs = aggregateTools(s);
  assert.ok(aggs.length > 0);
  // Descending by totalTokens.
  for (let i = 1; i < aggs.length; i++) {
    assert.ok(aggs[i - 1].totalTokens >= aggs[i].totalTokens);
  }
  // Call counts sum to total tool calls across turns.
  const totalCalls = s.turns.reduce((a, t) => a + t.toolCalls.length, 0);
  const summedCalls = aggs.reduce((a, g) => a + g.calls, 0);
  assert.equal(summedCalls, totalCalls);
});

test("spreadTokens distributes a turn's tokens evenly across its tool calls", () => {
  const s = parseSession(FIXTURE, "demo-project");
  const turnWithTools = s.turns.find((t) => t.toolCalls.length > 0)!;
  const n = turnWithTools.toolCalls.length;
  spreadTokens(s);
  const share = Math.round(turnWithTools.totalTokens / n);
  for (const call of turnWithTools.toolCalls) {
    assert.equal(call.totalTokens, share);
  }
});

test("graph builders return connected, well-formed structures", () => {
  const s = parseSession(FIXTURE, "demo-project");
  spreadTokens(s);

  const agg = buildAggregateGraph(s);
  assert.ok(agg.nodes.length > 1);
  assert.equal(agg.edges.length, agg.nodes.length - 1, "hub edges match tool nodes");

  const chain = buildChronologicalGraph(s);
  assert.ok(chain.nodes.length > 1);
  const seen = new Set<string>();
  for (const e of chain.edges) {
    seen.add(e.from + "->" + e.to);
    assert.ok(chain.nodes.some((n) => n.id === e.from), `edge source ${e.from} exists`);
    assert.ok(chain.nodes.some((n) => n.id === e.to), `edge target ${e.to} exists`);
  }
  assert.equal(seen.size, chain.edges.length, "no duplicate edges");
});

test("parser skips malformed lines without crashing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-test-"));
  const file = join(dir, "broken.jsonl");
  const garbage = '{"not": "json"\nthis is not jsonl at all\n{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n';
  writeFileSync(file, garbage);
  const s = parseSession(file, "broken-project");
  assert.ok(s.turns.length >= 1, "parsed the valid line despite garbage");
});

test("startedAt is a real ISO timestamp from the log, with a duration", () => {
  const s = parseSession(FIXTURE, "demo-project");
  // The fixture stamps every line, so startedAt must be an actual ISO date —
  // not a pseudo string like the prompt length.
  assert.match(s.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(new Date(s.startedAt).toISOString(), s.startedAt);
  assert.ok(typeof s.durationMs === "number" && s.durationMs >= 0);
});

test("parser handles single-object and string content blocks as real logs produce", () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-test-"));
  const file = join(dir, "weird-content.jsonl");
  const lines = [
    // content as a single text object (not an array)
    JSON.stringify({ message: { role: "user", content: { type: "text", text: "fix the build please" } } }),
    // content as a raw string
    JSON.stringify({ message: { role: "user", content: "another request" } }),
    JSON.stringify({
      message: {
        role: "user",
        content: { type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls" } },
      },
    }),
    JSON.stringify({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 1, cache_read_input_tokens: 0 },
      },
    }),
  ];
  writeFileSync(file, lines.join("\n"));
  const s = parseSession(file, "weird");
  assert.equal(s.turns.length, 2, "both text prompts become turns");
  assert.equal(s.turns[0].prompt, "fix the build please");
  assert.equal(s.turns[1].prompt, "another request");
  // The single-object tool_use before the assistant reply belongs to turn 2.
  assert.equal(s.turns[1].toolCalls.length, 1);
  assert.equal(s.turns[1].toolCalls[0].name, "Bash");
  assert.equal(s.totalTokens, 8);
});

test("session with no timestamps yields empty startedAt and null duration", () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-test-"));
  const file = join(dir, "timeless.jsonl");
  const lines = [
    JSON.stringify({ message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "yo" }], usage: { input_tokens: 1 } } }),
  ];
  writeFileSync(file, lines.join("\n"));
  const s = parseSession(file, "timeless");
  assert.equal(s.startedAt, "");
  assert.equal(s.durationMs, null);
});

test("aggregateSessions groups by project and sums totals exactly", () => {
  const s = parseSession(FIXTURE, "project-a");
  spreadTokens(s);
  const t = parseSession(FIXTURE, "project-b");
  spreadTokens(t);

  const ov = aggregateSessions([s, t]);
  assert.equal(ov.totals.sessions, 2);
  assert.equal(ov.totals.totalTokens, s.totalTokens + t.totalTokens);
  assert.equal(ov.totals.totalInput, s.totalInput + t.totalInput);
  assert.equal(ov.totals.totalOutput, s.totalOutput + t.totalOutput);

  // Two distinct project rows, each holding exactly its session's totals.
  assert.deepEqual(ov.projects.map((p) => p.project).sort(), ["project-a", "project-b"]);
  for (const p of ov.projects) {
    assert.equal(p.sessions, 1);
    assert.equal(p.totalTokens, p.project === "project-a" ? s.totalTokens : t.totalTokens);
  }

  // Tool aggregates collapse across both sessions (call counts double).
  const singleTools = aggregateTools(s);
  assert.equal(ov.toolAggregates.length, singleTools.length);
  for (const agg of ov.toolAggregates) {
    assert.equal(agg.calls % 2, 0, `${agg.name} appears in both sessions`);
  }
});

test("toolColor falls back to a default for unknown tools", () => {
  assert.equal(toolColor("Bash"), "#faff69");
  assert.equal(toolColor("Read"), "#3b82f6");
  assert.equal(toolColor("DoesNotExist"), toolColor("default"));
});