/**
 * Generates a realistic Claude Code session JSONL fixture.
 *
 * Format modeled on Claude Code's on-disk logs at
 * ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Usage:
 *   node test/fixtures/generate-fixture.mjs [outfile] [turns] [toolCallsPerTurn]
 *
 * Defaults write a plausible session to test/fixtures/session-demo.jsonl.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const outFile = process.argv[2] ?? `${__dirname}/session-demo.jsonl`;
const turnsCount = Number(process.argv[3] ?? 6);
const callsPerTurn = Number(process.argv[4] ?? 4);

const SESSION_ID = "session-demo-0001";
const CWD = "/Users/fahim/code/my-app";
const MODEL = "claude-opus-4-5";

// A small believable catalog of tools this session will use.
const TOOL_CATALOG = [
  {
    name: "Bash",
    inputs: [{ command: "ls -la src/" }, { command: "npm test" }, { command: "git log --oneline -5" }],
  },
  {
    name: "Read",
    inputs: [{ file_path: "src/index.ts" }, { file_path: "src/utils/parse.ts" }, { file_path: "package.json" }],
  },
  {
    name: "Edit",
    inputs: [{ file_path: "src/index.ts", old_string: "// TODO", new_string: "// implemented" }],
  },
  {
    name: "Grep",
    inputs: [{ pattern: "token", path: "src/" }, { pattern: "cache", path: "src/" }],
  },
  {
    name: "WebSearch",
    inputs: [{ query: "vis.js edge options docs" }, { query: "claude code jsonl schema" }],
  },
];

const PROMPTS = [
  "Set up a new vite project with TypeScript for this token analytics tool.",
  "How is the token usage being recorded? Show me the parser's input shape.",
  "Refactor the JSONL reader to stream line by line instead of loading everything.",
  "Add a unit test for an empty session file.",
  "Style the graph page using the ClickHouse-inspired dark theme.",
  "What tools can I use to render an interactive node graph in the browser?",
];

// Deterministic pseudo-random so the fixture is reproducible.
let seed = 42;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
function intBetween(min, max) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function pt(ts) {
  return new Date(ts).toISOString();
}

// Deterministic usage blocks look realistic: outputs smaller than inputs,
// cache reads dominating after the first turn.
function usage(scope) {
  const input = intBetween(800, 8000);
  const output = intBetween(200, 3500);
  const cacheRead = scope === "repeat" ? intBetween(4000, 20000) : 0;
  const cacheWrite = intBetween(0, 3000);
  return { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead };
}

const lines = [];
let t = Date.parse("2026-09-07T09:14:00Z");

// Session header / context line.
lines.push(
  JSON.stringify({
    type: "user",
    cwd: CWD,
    gitBranch: "feature/token-graph",
    session_id: SESSION_ID,
    model: MODEL,
    requestId: "reqctx-001",
    message: { role: "user", content: [{ type: "text", text: "We're building a Claude Code token usage visualizer." }] },
  }),
);

for (let i = 0; i < turnsCount; i++) {
  t += 4000;
  const promptText = PROMPTS[i % PROMPTS.length];

  // User prompt turn.
  lines.push(
    JSON.stringify({
      type: "user",
      cwd: CWD,
      session_id: SESSION_ID,
      model: MODEL,
      requestId: `requ-${i}`,
      timestamp: pt(t),
      message: { role: "user", content: [{ type: "text", text: promptText }] },
    }),
  );

  // A few tool calls in this turn.
  const calls = intBetween(1, callsPerTurn);
  for (let c = 0; c < calls; c++) {
    const tool = pick(TOOL_CATALOG);
    const input = pick(tool.inputs);
    const toolId = `toolu_${i}_${c}_${Math.floor(rnd() * 1e6).toString(36)}`;
    // Assistant announces the tool_use.
    t += 2500;
    lines.push(
      JSON.stringify({
        type: "assistant",
        cwd: CWD,
        session_id: SESSION_ID,
        model: MODEL,
        requestId: `reqa-${i}-${c}`,
        timestamp: pt(t),
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: toolId, name: tool.name, input }],
        },
      }),
    );
    // User confirms the tool_result (Claude Code frames results as user messages).
    t += 900;
    lines.push(
      JSON.stringify({
        type: "user",
        cwd: CWD,
        session_id: SESSION_ID,
        model: MODEL,
        requestId: `reqr-${i}-${c}`,
        timestamp: pt(t),
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolId, content: `[result of ${tool.name}] ok (${intBetween(12, 400)} lines)` }],
        },
      }),
    );
  }

  // Assistant final reply for this turn, carrying the usage block.
  t += 1600;
  lines.push(
    JSON.stringify({
      type: "assistant",
      cwd: CWD,
      session_id: SESSION_ID,
      model: MODEL,
      requestId: `reqdone-${i}`,
      timestamp: pt(t),
      message: {
        role: "assistant",
        content: [{ type: "text", text: `Done with: ${promptText}` }],
        model: MODEL,
        stop_reason: "end_turn",
        usage: usage(i === 0 ? "first" : "repeat"),
      },
    }),
  );
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} JSONL lines → ${outFile}`);