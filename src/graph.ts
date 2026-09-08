/**
 * Graph builder: transforms the parsed Session into vis.js node/edge arrays.
 *
 * Two views are provided so Phase 0 can compare which reads better:
 *   - aggregate:   a "hub & tool" graph — session center connected to tool nodes
 *                  sized by cumulative token share, colored by tool type.
 *   - chronological: the turn-by-turn chain — user prompts and tool calls in
 *                  the order they happened.
 *
 * vis.js nodes use `value` (scales node size) and `color.background`.
 */
import type { Session, ToolAggregate } from "./types.js";

export interface VisNode {
  id: string;
  label: string;
  value?: number;
  color?: { background?: string; border?: string };
  group?: string;
  title?: string;
  data?: Record<string, unknown>;
}

export interface VisEdge {
  from: string;
  to: string;
  value?: number; // edge thickness/weight
  title?: string;
  arrows?: string;
}

/** Consistent color per tool name, tuned for a dark canvas. */
const TOOL_COLORS: Record<string, string> = {
  Bash: "#faff69",
  Read: "#3b82f6",
  Edit: "#22c55e",
  Grep: "#ef4444",
  Glob: "#a78bfa",
  WebSearch: "#f59e0b",
  Task: "#22d3ee",
  Write: "#34d399",
  default: "#888888",
};

export function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? TOOL_COLORS.default;
}

/** Normalize raw token counts into a vis.js-friendly size (sqrt scale). */
function scale(value: number): number {
  return Math.sqrt(value) / 10;
}

/** Hub-and-tool aggregate graph for one session. */
export function buildAggregateGraph(session: Session): { nodes: VisNode[]; edges: VisEdge[] } {
  const nodes: VisNode[] = [];
  const edges: VisEdge[] = [];

  const rootId = "session";
  nodes.push({
    id: rootId,
    label: `${session.project}\n${session.turns.length} turns · ${fmt(session.totalTokens)} tok`,
    value: 6,
    color: { background: "#faff69", border: "#e6eb52" },
    group: "session",
    title: "This session",
  });

  // Group tool calls across the whole session (reuse aggregation).
  const byTool = new Map<string, { calls: number; tokens: number }>();
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      const entry = byTool.get(call.name) ?? { calls: 0, tokens: 0 };
      entry.calls += 1;
      entry.tokens += call.totalTokens || 1;
      byTool.set(call.name, entry);
    }
  }

  const maxTokens = Math.max(1, ...[...byTool.values()].map((v) => v.tokens));
  for (const [name, agg] of byTool) {
    const id = `tool:${name}`;
    nodes.push({
      id,
      label: `${name}\n${agg.calls}× · ${fmt(agg.tokens)}`,
      value: 1 + 5 * (agg.tokens / maxTokens),
      color: { background: toolColor(name), border: "#ffffff" },
      group: "tool",
      title: `${name}: ${agg.calls} calls, ${fmt(agg.tokens)} tokens`,
    });
    edges.push({ from: rootId, to: id, value: 2 + 4 * (agg.tokens / maxTokens), title: `${name}: ${fmt(agg.tokens)}` });
  }

  return { nodes, edges };
}

/** Turn-by-turn chronological graph: session → prompts → their tool calls. */
export function buildChronologicalGraph(session: Session): { nodes: VisNode[]; edges: VisEdge[] } {
  const nodes: VisNode[] = [];
  const edges: VisEdge[] = [];

  nodes.push({
    id: "session",
    label: session.project,
    value: 6,
    color: { background: "#faff69", border: "#e6eb52" },
    group: "session",
  });

  let prevTurnId = "session";
  for (const turn of session.turns) {
    const turnId = `turn:${turn.index}`;
    nodes.push({
      id: turnId,
      label: truncate(turn.prompt, 22),
      value: 2.5,
      color: { background: "#121212", border: "#3a3a3a" },
      group: "turn",
      title: `Turn ${turn.index + 1}: ${turn.prompt}`,
    });
    edges.push({ from: prevTurnId, to: turnId, value: 1, arrows: "to" });

    // Tool calls inside this turn.
    for (const call of turn.toolCalls) {
      const callId = `${turnId}:${call.id}`;
      nodes.push({
        id: callId,
        label: call.name,
        value: 1.2,
        color: { background: toolColor(call.name), border: "#ffffff" },
        group: "tool",
        title: `${call.name} ${call.summary}`,
      });
      edges.push({ from: turnId, to: callId, value: 1, arrows: "to" });
    }
    prevTurnId = turnId;
  }

  return { nodes, edges };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export type { ToolAggregate };