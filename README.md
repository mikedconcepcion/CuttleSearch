# CuttleSearch

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![deps](https://img.shields.io/badge/dependencies-zero-brightgreen)](#requirements)

> **An open-source search engine you point at your data — full-text,
> vector, and hybrid ranking with a structured-token analyzer, served
> over a small, hardened HTTP API. Zero external dependencies.**

CuttleSearch is developer **search infrastructure** — the
Elasticsearch / Meilisearch / Typesense lane. It indexes documents and
serves ranked search over them. Both humans and LLM agents are
first-class clients of the same open API.

> **Status — v0.8.0.** The shipped binary (`server/cuttlesearch.obin` on
> the `cuttledb-server` engine) serves **read-only BM25** search today —
> `GET /health`, `GET`/`POST /search`. Vector + hybrid ranking, the
> structured-token analyzer, the query DSL, and attached mode are proven
> in the dependency-free reference engine + bench and are being brought
> into the binary along the [roadmap](ROADMAP.md). The feature sections
> below describe the product target; this callout is the ground truth of
> the binary right now.

See [DEFINITION.md](DEFINITION.md) for what it is (and isn't), and
[ROADMAP.md](ROADMAP.md) for where it's going.

## How it ships

CuttleSearch is a **standalone product** that **pairs best with CuttleDB**.
The engine is `cuttledb-server` (shared with CuttleDB): CuttleDB's column store
and read-only retrieval live **in-process**, so the search server is one binary
with nothing else installed. It loads a pre-built index snapshot at boot and
serves ranked search over it.

```
Lucene        : Elasticsearch   ::   CuttleDB : CuttleSearch
(retrieval)     (search server)       (retrieval)  (search server)
```

Pointing the server at a **separate, running CuttleDB** instance (so search
rides on a database other processes are already writing to) is on the
[roadmap](ROADMAP.md); today retrieval is in-process over the boot snapshot.

## Quickstart

CuttleSearch ships the way the rest of the stack ships: a copy-and-run
binary — the `cuttledb-server` engine plus the assembled program
(`server/cuttlesearch.obin`). No interpreter, no package install.

```bash
# Serve search over a pre-built, read-only index snapshot.
./scripts/run.sh                                  # Linux/macOS
bin\cuttledb-server.exe server\cuttlesearch.obin  # Windows

# Query it.
curl "http://127.0.0.1:8787/search?q=fox+river&k=5"

# Health check.
curl "http://127.0.0.1:8787/health"
```

The index is built **offline** and loaded **read-only at boot** — see
[docs/API.md](docs/API.md) for the endpoint contract and
[deploy/DEPLOY.md](deploy/DEPLOY.md) for building a snapshot, the systemd /
Docker units, and the VPS walkthrough.

## Security model & hardening

The HTTP surface is **read-only by construction** — the binary hardcodes the
read-only retrieval verbs, so no request path can mutate the index, touch the
filesystem, or spawn a process. That property *is* the security model, and
it's what makes the API safe to expose publicly.

Built into the binary today:

- **Read-only by construction** — no request-driven writes, ever.
- **Method allowlist** — only `GET`/`POST`/`OPTIONS`; anything else → `405` + `Allow`.
- **Request-line size cap** — oversized request lines rejected with `413`.
- **Input sanitization** — control bytes, `"`, and `\` are stripped from the
  query; a CR/LF-free term cannot inject a second command.
- **Structured JSON error envelopes** on every failure path.
- **Permissive CORS** (`*`) — appropriate for a public, read-only API.

At the edge (see [deploy/DEPLOY.md](deploy/DEPLOY.md)): terminate **TLS** and
apply **rate limiting** / **auth** with nginx or Cloudflare. In-binary API-key
auth, a token-bucket rate limiter, a max-connection cap, and graceful shutdown
are on the [roadmap](ROADMAP.md) — not yet in the shipped binary.

See [docs/API.md](docs/API.md) for the endpoint contract.

## The structured-token analyzer (roadmap)

A structured-token analyzer keeps config knobs, version strings, error
codes, file paths, and identifiers (`shard_fanout`, `v3.7.21`,
`src/vm/interp.c`, `E1054`) as **one token** where a raw tokenizer would
shatter them — while still emitting the parts so a bare-part query still
matches ("keep-whole + also-parts"). On code- and config-heavy corpora this
is decisive. It's proven in the internal reference engine and lands in the
binary along the [roadmap](ROADMAP.md); today the binary tokenizes via
CuttleDB's analyzer.

## Requirements

**None.** Copy-and-run: the vendored `cuttledb-server` engine +
`server/cuttlesearch.obin`, zero external dependencies. The Linux release
binary is dropped in at `bin/cuttledb-server`; a Windows `bin/cuttledb-server.exe`
is vendored for local dev — see [bin/README.md](bin/README.md).

## Powered by CuttleDB and CuttleSearch

If you ship a site on this stack, the honest footer badge is **"Powered
by CuttleDB and CuttleSearch."** The data lives in CuttleDB; the ranked
search over it is CuttleSearch.

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright 2025-2026 Mike Dela
Concepcion.
