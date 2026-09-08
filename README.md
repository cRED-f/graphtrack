# Graphtrack

Visualize your **Claude Code** token usage as an interactive graph.

Instead of tables and bars, Graphtrack turns a session into a navigable network —
prompts, tool calls, and their token weight rendered as nodes and edges. Node size
is token share, color is tool type, and edges trace how your tokens actually flowed.
Find out at a glance which tool is eating your budget, or trace a single request
from prompt to result.

```
~/.claude/projects/<project>/<session>.jsonl  →  parse  →  graph  →  serve on localhost
```

## Why local?

This is a **local-first, open-source tool**. Your logs are parsed on your machine and
served to your own browser at `localhost`. Nothing is uploaded, stored, or shared.
Your usage data never leaves your computer.

## Getting started

```bash
# from the repo root
npm install
npm run build
npm start            # starts a localhost server
```

Then open the printed URL, pick a session (or point Graphtrack at
`~/.claude/projects`), and explore the graph.

### Phase 0 spike (no server needed)

A standalone preview page is generated from a synthetic sample session so you can
judge the visualization without any setup:

```bash
npm run build
node scripts/build-spike.mjs
# open public/phase0/phase0.html in a browser
```

## Roadmap

- **Phase 0** — validate the graph metaphor on realistic data ✓ (spike shipped)
- **Phase 1** — JSONL parser + typed model + per-tool aggregation
- **Phase 2** — localhost web app: vis.js graph + table view
- **Phase 3** — multi-session overview, empty state, error handling
- **Phase 4** — install polish, docs, CI

## Project layout

```
src/
  types.ts      shared data model (Session/Turn/ToolCall/Usage)
  parser.ts     JSONL → typed Session
  graph.ts      Session → vis.js nodes/edges (aggregate + chronological)
scripts/
  build-spike.mjs  Phase 0 preview generator
public/
  phase0/       standalone preview page
test/
  fixtures/     sample-session generator
```

## License

MIT