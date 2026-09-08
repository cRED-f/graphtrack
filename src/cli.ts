#!/usr/bin/env node
/**
 * Graphtrack CLI — run `graphtrack` anywhere to start the local dashboard.
 *
 *   graphtrack                     → http://localhost:9090  (reads ~/.claude/projects)
 *   graphtrack --dir <path>        → read logs from a custom folder
 *   graphtrack --port <n>          → use a different port (default 9090)
 *   graphtrack --help              → this help
 */
import { startServer, DEFAULT_LOGS_DIR, DEFAULT_PORT } from "./server.js";

function printHelp() {
  console.log(`
Graphtrack — visualize Claude Code token usage as a graph.

Usage:
  graphtrack [options]

Options:
  --dir, -d <path>   read session logs from <path> (default: ${DEFAULT_LOGS_DIR})
  --port, -p <n>     serve on port <n> (default: ${DEFAULT_PORT})
  --help, -h         show this help

Everything runs locally. Your logs never leave your machine.
`);
}

interface CliOptions {
  logsDir: string;
  port?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { logsDir: DEFAULT_LOGS_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" || a === "-d") {
      opts.logsDir = argv[++i] ?? DEFAULT_LOGS_DIR;
    } else if (a === "--port" || a === "-p") {
      opts.port = Number(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

startServer(parseArgs(process.argv.slice(2)));