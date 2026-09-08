<div align="center">

# Graphtrack

[![npm version](https://img.shields.io/npm/v/graphtrack.svg?style=flat-square)](https://www.npmjs.com/package/graphtrack)
[![license](https://img.shields.io/npm/l/graphtrack?style=flat-square)](https://github.com/nicholasgriffintn/graphtrack/blob/main/LICENSE)

**Interactive token-usage dashboard for Claude Code.**

Run `npx graphtrack`, open `localhost:9090`, and see exactly where your tokens go —
as a graph, a table, or a multi-session overview.

Your logs never leave your machine.

<img width="900" height="506" alt="graphtrack_marketing_demo_v2" src="https://github.com/user-attachments/assets/6aa8df73-a8a6-48ee-a533-c618a1e835d1" />


</div>

---

## Installation

```bash
# No install needed — runs directly from npm
npx graphtrack

# Or install globally
npm install -g graphtrack
graphtrack
```

Requires [Node.js](https://nodejs.org/) 18+.

## Quick Start

```bash
npx graphtrack
# → Server starts at http://localhost:9090
```

Point at a custom log directory:

```bash
npx graphtrack --dir /path/to/.claude/projects
```

Use a different port:

```bash
npx graphtrack --port 3000
```

## Features

### Four views, one dashboard

| View                    | What it shows                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **Overview**            | Aggregate stats across all sessions — total tokens, per-project breakdown, tool usage share |
| **Aggregate Graph**     | Hub-and-spoke network: each tool is a node, size = token share, color = tool type           |
| **Chronological Graph** | Turn-by-turn chain: each prompt links to the tools it triggered, ordered in time            |
| **Table**               | Sortable per-tool and per-turn tables with color-coded token bars                           |

### Session picker

A searchable dropdown groups sessions by project — type to filter by ID or project name, then click to load.

### What gets tracked

- **Input / output / cache tokens** per session, per turn, and per tool call
- **Real timestamps** — session start time and wall-clock duration from the actual logs
- **Tool breakdown** — which tools consume the most tokens, how many times each was called
- **Project grouping** — sessions organized by project in the Overview view

### Tool color legend

| Tool  | Color                                       |
| ----- | ------------------------------------------- |
| Edit  | <span style="color:#ff6b6b">●</span> Red    |
| Bash  | <span style="color:#faff69">●</span> Yellow |
| Read  | <span style="color:#3b82f6">●</span> Blue   |
| Write | <span style="color:#4cff4c">●</span> Green  |
| Glob  | <span style="color:#b06bff">●</span> Purple |
| Grep  | <span style="color:#ff8cff">●</span> Pink   |
| Agent | <span style="color:#ffb347">●</span> Orange |

## Project Structure

```
src/
  types.ts        Data model (Session, Turn, ToolCall, Usage, Overview)
  parser.ts       JSONL → Session + aggregateSessions()
  graph.ts        Session → vis.js nodes/edges (aggregate + chronological)
  server.ts       Express API + static file serving
  cli.ts          CLI entry point (--dir, --port, --help)

public/
  index.html      Dashboard UI (4 views, vanilla JS)
  images/         Icon and assets

test/
  parser.test.ts  Unit tests for parser, aggregation, and graph builders
  fixtures/       Sample session data for tests
```

## License

MIT
