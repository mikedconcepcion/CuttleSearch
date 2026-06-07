# Changelog

All notable changes to CuttleSearch are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and CuttleSearch tracks the
same version line as the shared `cuttledb-server` engine it ships on.

## [0.9.0] — 2026-06-06

Search depth release. The HTTP surface stays read-only by construction; this
cycle widens what a single read-only request can express.

### Added
- **Content in hits.** Every `/search` hit now carries the matched document's
  `text` — the indexed cell, JSON-escaped and snippet-capped (~280 bytes,
  UTF-8-boundary-safe) — alongside `id` and `score`. Results are usable
  without a second round-trip. No new wire verb, no write path.
- **Boolean `filter=` parameter.** `/search?filter=<expr>` accepts a Boolean
  expression over indexed columns (column-index-addressed predicates, `AND` /
  `OR` / parentheses, numeric and exact-match string equality), compiled to the
  read-only `BSEARCH` verb. Combine it with `q` for faceted ranking — the
  filter selects candidates, `q` ranks within them (RRF-fused) — or use it
  alone to retrieve every matching row.
- **Multi-index routing.** One process loads N named snapshots at boot
  (`default`, `b`, …), each into its own read-only handle; `/search?index=<name>`
  routes by name against a fixed in-memory roster. Unknown, empty, or absent
  names fall back to the default index, and the response echoes the `index` that
  actually answered. The name never touches the filesystem, so `index=../index`
  is harmless — path traversal is structurally impossible.

### Changed
- An empty `q=` supplied alongside a `filter` is now treated as *absent* (a
  filter-only request stays valid) rather than rejected.
- A malformed `k` (e.g. `k=5x`) honors its leading digits and no longer drops
  the parameters that follow it.

### Security
- Full source pass of every parse/route path — injection, path-traversal,
  length-bound, and overflow surfaces confirmed solid. The read-only-by-
  construction model is unchanged: no request path can mutate the index, touch
  the filesystem, or spawn a process.

## [0.8.0] — 2026-06-02

Initial public release: a read-only HTTP search API in pure OctoASM, shipped as
a copy-and-run binary (the shared `cuttledb-server` engine plus the assembled
`cuttlesearch.obin` program).

### Added
- `GET /health` — liveness probe returning service name and version.
- `GET` / `POST /search?q=<query>` — BM25 full-text ranking over a pre-built,
  read-only index snapshot loaded at boot.
- `GET /llms.txt` and `GET /mcp.json` — agent-discovery surfaces (spec-legal
  markdown billboard + machine-readable MCP tool descriptor).
- Embeddable WASM kit — the same engine compiled to WebAssembly runs ranked
  BM25 search in-process inside a Node or browser process, no server.
- Hardening built into the binary: read-only by construction, method allowlist,
  request-line size cap, query sanitization (control bytes / `"` / `\`
  stripped), structured JSON error envelopes, permissive CORS for a public
  read-only API.
