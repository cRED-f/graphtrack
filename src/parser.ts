/**
 * Parser: reads Claude Code JSONL log files and produces the typed Session model.
 *
 * Handles a single session file. Returns a Session, or throws on a completely
 * unreadable file (callers decide how to surface partial failures).
 */
import { readFileSync } from "node:fs";
import type { Overview, ProjectOverview, Session, ToolCall, ToolAggregate, Turn, Usage } from "./types.js";

interface RawMessage {
  role?: string;
  model?: string;
  stop_reason?: string;
  /** Real logs sometimes carry content as a single object or a string, not an array. */
  content?: RawContent[] | RawContent | string;
  usage?: Usage;
}

type RawContent =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown };

/** Normalize a message's content field to an array for the rest of the parser. */
function normalizeContent(content: RawContent[] | RawContent | string | undefined): RawContent[] {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [content];
}

/** Parse one line of JSONL into the message we care about + its timestamp. */
function parseLine(raw: string): { msg: RawMessage; timestamp?: string } | null {
  const line = raw.trim();
  if (!line) return null;
  let obj: { message?: RawMessage; timestamp?: string };
  try {
    obj = JSON.parse(line);
  } catch {
    return null; // malformed line — skip, don't crash
  }
  if (!obj?.message) return null;
  return { msg: obj.message, timestamp: obj.timestamp };
}

function contentSummary(blocks: RawContent[]): string {
  return blocks
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
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
    durationMs: null,
    turns: [],
    totalTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };

  // Track the earliest/latest timestamp across all lines to get real timings.
  let startTs: number | null = null;
  let lastTs: number | null = null;
  const noteTime = (ts?: string) => {
    if (!ts) return;
    const n = Date.parse(ts);
    if (Number.isNaN(n)) return;
    if (startTs === null || n < startTs) startTs = n;
    if (lastTs === null || n > lastTs) lastTs = n;
  };

  // We walk the stream and slice it into turns. A turn starts at a user message
  // that contains a text prompt (i.e. a real request, not a tool_result).
  let current: Turn | null = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { msg, timestamp } = parsed;
    noteTime(timestamp);

    const content = normalizeContent(msg.content);
    const text = contentSummary(content);

    // Determine message kind
    const hasText = Boolean(text.trim());

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

  if (startTs !== null) {
    session.startedAt = new Date(startTs).toISOString();
    if (lastTs !== null) session.durationMs = lastTs - startTs;
  }

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

/**
 * Collapse many parsed sessions into a single overview: per-project rows,
 * global totals, and tool aggregates across everything. Callers must run
 * spreadTokens() on each session first so per-tool attribution is seeded.
 */
export function aggregateSessions(sessions: Session[]): Overview {
  const projectMap = new Map<string, ProjectOverview>();
  const toolMap = new Map<string, ToolAggregate>();
  const totals: Overview["totals"] = {
    sessions: sessions.length,
    totalTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };

  for (const s of sessions) {
    totals.totalTokens += s.totalTokens;
    totals.totalInput += s.totalInput;
    totals.totalOutput += s.totalOutput;
    totals.totalCacheRead += s.totalCacheRead;
    totals.totalCacheWrite += s.totalCacheWrite;

    const p = projectMap.get(s.project) ?? {
      project: s.project,
      sessions: 0,
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
    };
    p.sessions += 1;
    p.totalTokens += s.totalTokens;
    p.totalInput += s.totalInput;
    p.totalOutput += s.totalOutput;
    p.totalCacheRead += s.totalCacheRead;
    p.totalCacheWrite += s.totalCacheWrite;
    projectMap.set(s.project, p);

    for (const agg of aggregateTools(s)) {
      const t = toolMap.get(agg.name) ?? {
        name: agg.name,
        calls: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      t.calls += agg.calls;
      t.totalTokens += agg.totalTokens;
      t.inputTokens += agg.inputTokens;
      t.outputTokens += agg.outputTokens;
      t.cacheRead += agg.cacheRead;
      t.cacheWrite += agg.cacheWrite;
      toolMap.set(agg.name, t);
    }
  }

  return {
    projects: [...projectMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    totals,
    toolAggregates: [...toolMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
  };
}