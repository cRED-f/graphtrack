/**
 * Parser: reads Claude Code JSONL log files and produces the typed Session model.
 *
 * Handles a single session file. Returns a Session, or throws on a completely
 * unreadable file (callers decide how to surface partial failures).
 */
import { readFileSync } from "node:fs";
import type { Session, ToolCall, ToolAggregate, Turn, Usage } from "./types.js";

interface RawMessage {
  role?: string;
  model?: string;
  stop_reason?: string;
  content?: RawContent[];
  usage?: Usage;
}

type RawContent =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown };

/** Parse one line of JSONL into a drop of structure we care about. */
function parseLine(raw: string): RawMessage | null {
  const line = raw.trim();
  if (!line) return null;
  let obj: { type?: string; message?: RawMessage; session_id?: string; cwd?: string; model?: string; timestamp?: string; requestId?: string };
  try {
    obj = JSON.parse(line);
  } catch {
    return null; // malformed line — skip, don't crash
  }
  return obj?.message ?? null;
}

function contentSummary(content: RawContent[] | undefined): string {
  if (!content) return "";
  return content
    .map((b) => {
      if (b.type === "text") return b.text ?? "";
      if (b.type === "tool_use") return "";
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function tokensOf(usage: Usage | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/** Extracts tool calls from a session's JSONL and groups them into turns. */
export function parseSession(filePath: string, project: string): Session {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n");

  const session: Session = {
    id: filePath.split(/[\\/]/).pop()?.replace(/\.jsonl$/, "") ?? "unknown",
    project,
    model: "unknown",
    startedAt: "",
    turns: [],
    totalTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };

  // We walk the stream and slice it into turns. A turn starts at a user message
  // that contains a text prompt (i.e. a real request, not a tool_result).
  let current: Turn | null = null;

  for (const line of lines) {
    const msg = parseLine(line);
    if (!msg) continue;

    const text = contentSummary(msg.content);

    // Determine message kind
    const hasText = Boolean(text.trim());
    const content = msg.content ?? [];

    // A new turn begins when the user speaks with text (not a tool_result).
    if (msg.role === "user" && hasText && content.every((b) => b.type !== "tool_result")) {
      if (current) session.turns.push(current);
      current = { prompt: text, index: session.turns.length, toolCalls: [], totalTokens: 0 };
      continue;
    }

    if (!current) continue;

    // Capture tool_use blocks.
    for (const block of content) {
      if (block.type === "tool_use") {
        const input = (block.input as Record<string, unknown>) ?? {};
        const summary = Object.entries(input)
          .map(([k, v]) => `${k}=${String(v)}`)
          .slice(0, 3)
          .join(" ");
        const call: ToolCall = {
          id: block.id ?? `tool_${current.index}_${current.toolCalls.length}`,
          name: block.name ?? "unknown",
          summary,
          totalTokens: 0,
        };
        current.toolCalls.push(call);
      }
    }

    // Attribute usage to the current turn (assistant text replies carry usage).
    if (msg.usage) {
      const usage = msg.usage;
      session.totalInput += usage.input_tokens ?? 0;
      session.totalOutput += usage.output_tokens ?? 0;
      session.totalCacheRead += usage.cache_read_input_tokens ?? 0;
      session.totalCacheWrite += usage.cache_creation_input_tokens ?? 0;
      current.totalTokens += tokensOf(usage);
      if (msg.model && session.model === "unknown") session.model = msg.model;
    }
  }
  if (current) session.turns.push(current);

  session.startedAt = session.turns[0] ? String(session.turns[0]?.prompt.length) : "";
  // Derive a pseudo start time from the file's first activity is omitted here;
  // the fixture/deployer can supply timestamps via a richer parser later.

  session.totalTokens = session.turns.reduce((a, t) => a + t.totalTokens, 0);
  return session;
}

/** Aggregate tool calls across a session (the collapse-by-tool model). */
export function aggregateTools(session: Session): ToolAggregate[] {
  const map = new Map<string, ToolAggregate>();
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      const agg = map.get(call.name) ?? {
        name: call.name,
        calls: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      agg.calls += 1;
      agg.totalTokens += call.totalTokens;
      const u = call.usage;
      if (u) {
        agg.inputTokens += u.input_tokens ?? 0;
        agg.outputTokens += u.output_tokens ?? 0;
        agg.cacheRead += u.cache_read_input_tokens ?? 0;
        agg.cacheWrite += u.cache_creation_input_tokens ?? 0;
      }
      map.set(call.name, agg);
    }
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}