/**
 * Graphtrack localhost server.
 *
 * Serves the static app (public/) and exposes the user's Claude Code session
 * logs over a small read-only API. Everything runs locally — nothing is sent
 * anywhere.
 *
 *   GET /                    → public/index.html
 *   GET /api/sessions         → lightweight list of all sessions found
 *   GET /api/session/:slug/:id → full graph data for one session
 */
import express from "express";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { parseSession, aggregateTools, aggregateSessions } from "./parser.js";
import { buildAggregateGraph, buildChronologicalGraph, buildToolHubGraph, toolColor, spreadTokens } from "./graph.js";

export const DEFAULT_LOGS_DIR = join(homedir(), ".claude", "projects");
const DEFAULT_PORT = 9090;
/**
 * public/ lives at the package root, not the caller's cwd — resolve via this
 * module. The compiled file is at <root>/dist/server.js, so one level up.
 */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface StartOptions {
  logsDir?: string;
  port?: number;
}

/** Recursively collect *.jsonl session files under logsDir. */
export function findSessionFiles(logsDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(logsDir);
  return out.sort();
}

/** Derive the project slug from a file path relative to the logs root. */
function projectOf(logsDir: string, file: string): string {
  const rel = relative(logsDir, dirname(file));
  return rel ? basename(rel) : "?";
}

export function startServer(opts: StartOptions = {}): Server {
  const logsDir = opts.logsDir ?? DEFAULT_LOGS_DIR;
  const port = opts.port ?? DEFAULT_PORT;
  const app = express();

  // Lightweight session listing.
  app.get("/api/sessions", (_req, res) => {
    const sessions = findSessionFiles(logsDir).map((file) => {
      const id = basename(file).replace(/\.jsonl$/, "");
      return { id, project: projectOf(logsDir, file), file };
    });
    res.json({ sessions, logsDir });
  });

  // Full graph data for one session.
  app.get("/api/session/:slug/:id", (req, res) => {
    const { slug, id } = req.params;
    const dir = join(logsDir, slug);
    const file = join(dir, `${id}.jsonl`);
    let session;
    try {
      session = parseSession(file, slug);
    } catch (err) {
      res.status(404).json({ error: String(err) });
      return;
    }
    spreadTokens(session);
    const aggregates = aggregateTools(session).map((a) => ({
      name: a.name,
      calls: a.calls,
      totalTokens: a.totalTokens,
      color: toolColor(a.name),
    }));
    res.json({
      session: {
        id: session.id,
        project: session.project,
        model: session.model,
        startedAt: session.startedAt,
        durationMs: session.durationMs,
        turns: session.turns.length,
        toolCalls: session.turns.reduce((a, t) => a + t.toolCalls.length, 0),
        totalTokens: session.totalTokens,
        totalInput: session.totalInput,
        totalOutput: session.totalOutput,
        totalCacheRead: session.totalCacheRead,
        totalCacheWrite: session.totalCacheWrite,
      },
      turns: session.turns.map((t) => ({
        index: t.index,
        prompt: t.prompt,
        toolCalls: t.toolCalls.length,
        totalTokens: t.totalTokens,
      })),
      aggregate: buildAggregateGraph(session),
      chronological: buildChronologicalGraph(session),
      toolAggregates: aggregates,
    });
  });

  // Multi-session overview: per-project totals + tool share across everything.
  // Parses every session file; fine for a local tool, cached later if ever slow.
  app.get("/api/overview", (_req, res) => {
    const files = findSessionFiles(logsDir);
    const sessions = [];
    for (const file of files) {
      try {
        const s = parseSession(file, projectOf(logsDir, file));
        spreadTokens(s);
        sessions.push(s);
      } catch {
        // Skip unparseable files — a broken session shouldn't sink the overview.
      }
    }
    const overview = aggregateSessions(sessions);
    res.json({
      totals: overview.totals,
      projects: overview.projects,
      toolAggregates: overview.toolAggregates.map((a) => ({
        name: a.name,
        calls: a.calls,
        totalTokens: a.totalTokens,
        color: toolColor(a.name),
      })),
      graph: buildToolHubGraph(
        overview.toolAggregates.map((a) => ({ name: a.name, calls: a.calls, totalTokens: a.totalTokens })),
        `All sessions\n${overview.totals.sessions} sessions · ${overview.totals.totalTokens} tok`,
        "Every Claude Code session Graphtrack can see",
      ),
      logsDir,
    });
  });

  // Static app (resolved relative to the installed package, not the cwd).
  app.use(express.static(PUBLIC_DIR));

  return app.listen(port, () => {
    console.log(`  Graphtrack → http://localhost:${port}`);
    console.log(`  Reading logs from: ${logsDir}`);
  });
}

export { DEFAULT_PORT };