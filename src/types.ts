/**
 * Graphtrack data model — the typed representation of Claude Code session logs.
 * These types are the single source of truth shared by the parser and the UI.
 */

/** Raw token-usage numbers as surfaced in Claude Code JSONL usage blocks. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** A single tool invocation within a turn. */
export interface ToolCall {
  /** Stable id from the log (e.g. toolu_...) if present, else synthetic. */
  id: string;
  /** Tool name: "Bash", "Read", "Edit", "WebSearch", ... */
  name: string;
  /** Humanized args/summary, used for node labels. */
  summary: string;
  /** Cumulative tokens attributable to this call (input+output+cache). */
  totalTokens: number;
  usage?: Usage;
}

/** One exchange: the user's prompt + any assistant reply and tool calls. */
export interface Turn {
  /** The user prompt text (the thing that was asked). */
  prompt: string;
  /** Sequential index within the session. */
  index: number;
  /** Tool calls fired in service of this prompt. */
  toolCalls: ToolCall[];
  /** Total tokens across this turn (prompt + outputs + tools + cache). */
  totalTokens: number;
}

/** A single parsed Claude Code session file. */
export interface Session {
  id: string;
  /** Project slug directory the session lives under. */
  project: string;
  model: string;
  /** ISO timestamp of first activity ("" if the log carries no timestamps). */
  startedAt: string;
  /** Wall-clock duration from first to last timestamped line (null if unknown). */
  durationMs: number | null;
  turns: Turn[];
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
}

/**
 * Aggregated tool usage across a session (or across sessions).
 * This is the collapse-by-tool model that powers the top level of the graph.
 */
export interface ToolAggregate {
  name: string;
  calls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Totals for one project across all of its sessions. */
export interface ProjectOverview {
  project: string;
  sessions: number;
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
}

/** The multi-session overview: per-project rows + global totals + tool share. */
export interface Overview {
  projects: ProjectOverview[];
  totals: {
    sessions: number;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheWrite: number;
  };
  toolAggregates: ToolAggregate[];
}