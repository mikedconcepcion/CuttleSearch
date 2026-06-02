# CuttleSearch HTTP API

CuttleSearch is a **read-only** JSON search API. It performs no request-driven
writes — every endpoint only reads a pre-built index snapshot. That property is
the security model: there is no request path that can mutate the database, the
filesystem, or spawn a process. This is what makes it safe to expose publicly
(the Algolia / Stripe shape: a public read-only API any HTTP client can call).

Base URL in examples: `http://HOST:8787`. In production, terminate TLS and apply
rate-limiting at the edge (nginx / Cloudflare) — see [DEPLOY.md](DEPLOY.md).

Response framing: `Connection: close` with read-until-EOF (no `Content-Length`).
Content type is always `application/json; charset=utf-8` with
`X-Content-Type-Options: nosniff`.

---

## `GET /health`

Liveness probe. No auth, no query.

```
$ curl -s http://HOST:8787/health
{"status":"ok","service":"cuttlesearch","version":"0.8.0"}
```

Always `200`. Use this for container/orchestrator health checks.

---

## `GET /search?q=<query>`
## `POST /search?q=<query>`

Run a BM25 lexical search over the loaded index and return ranked hits.

| Param | In | Required | Notes |
|-------|----|----------|-------|
| `q`   | query string | yes | The search text. URL-encoded: `+` and `%20` become spaces; `%XX` decodes to bytes (UTF-8 supported). Control bytes, `"`, and `\` are stripped server-side. |
| `k`   | query string | no | Max hits to return. Clamped to `[1,100]`; absent/zero/non-numeric defaults to `10`. |
| `mode`| query string | no | Retrieval mode. `bm25` (default) is live. `vector` and `hybrid` are proven in the reference engine but not yet in the binary → `501`. Any other value → `400`. |

Extra params (`k`, `mode`) may appear in any order after `q`; unknown params are
ignored. `POST` accepts the query in the query string (request-body parsing is deferred);
it behaves identically to `GET` in v1.

### Success — `200`

```
$ curl -s 'http://HOST:8787/search?q=fox+river'
{"query":"fox river","k":10,"mode":"bm25","took_ms":0,
 "total":3,"hits":[{"id":1,"score":1.7509},
                   {"id":4,"score":0.8288},
                   {"id":0,"score":0.8288}]}
```

| Field | Type | Meaning |
|-------|------|---------|
| `query` | string | The decoded query, echoed back (sanitized). |
| `k`     | int | Effective max hits (the clamped value actually applied). |
| `mode`  | string | Retrieval mode. `bm25` = lexical. |
| `took_ms` | int | Reserved (currently `0`). |
| `total` | int | Number of hits returned. |
| `hits`  | array | Ranked results, highest score first. |
| `hits[].id` | int | Row id in the indexed table. |
| `hits[].score` | float | BM25 relevance score (`%.4f`). |

If no index was loaded at boot, the service still answers with a structurally
valid empty result: `"total":0,"hits":[]`.

### Errors

| Status | Body `error.code` | When |
|--------|-------------------|------|
| `400`  | `bad_request` | `q` missing (`{"message":"missing required parameter: q"}`) |
| `400`  | `bad_request` | raw `"` or `\` in the query (`{"message":"invalid characters in query"}`) |
| `400`  | `bad_request` | unrecognized `mode` value — only `bm25` is live; `vector` / `hybrid` are recognized but return `501` (see below), and any other value is a `400` |
| `404`  | `not_found` | unknown route |
| `413`  | `payload_too_large` | request line exceeds 8192 bytes |
| `501`  | `not_implemented` | `mode=vector` or `mode=hybrid` (roadmap; use `bm25`) |

Error envelope shape:

```json
{"error":{"code":"bad_request","message":"missing required parameter: q"}}
```

---

## Official clients

The endpoint is plain HTTP + JSON — any client works. As a convenience, the
[`cuttledb`](https://github.com/mikedconcepcion/CuttleDB) adapter package
(npm + PyPI, v0.8.0+) ships a tiny zero-dependency client so you don't have to
hand-roll the request and error handling:

```js
import { CuttleSearchClient } from "cuttledb/search";

const cs = new CuttleSearchClient("http://HOST:8787");
const res = await cs.search("fox river", { k: 5 });   // → { …, hits: [{ id, score }] }
```

```python
from cuttledb.search import CuttleSearchClient

cs = CuttleSearchClient("http://HOST:8787")
res = cs.search("fox river", k=5)                      # → { …, "hits": [{ "id", "score" }] }
```

It's a separate import — not a method on the `CuttleDB` database client —
because CuttleSearch is its own read-only HTTP service. Errors (`400` / `501`)
surface as `CuttleSearchError` carrying `.status` and `.code`. You don't need
CuttleDB itself to use it; it only needs this endpoint's base URL.

---

## `GET /llms.txt`

Active-GEO discovery billboard for LLM agents. Returns spec-legal markdown
(`text/plain; charset=utf-8`) describing the service and linking the live
endpoints under a `## Live data` heading. No auth, no query.

```
$ curl -s http://HOST:8787/llms.txt
# CuttleSearch
> Open-source search infrastructure: full-text BM25 ranking ...
## Live data
- [Search API](/search?q=): ...
- [Health](/health): ...
- [MCP manifest](/mcp.json): ...
```

Always `200`. Cacheable (`Cache-Control: public, max-age=300`).

---

## `GET /mcp.json`

Machine-readable tool descriptor for MCP-aware agents. Returns a static JSON
manifest (`application/json; charset=utf-8`) describing the `search` tool and
its input schema, so an agent can self-configure without hard-coding the API.

```
$ curl -s http://HOST:8787/mcp.json
{"name":"cuttlesearch","version":"0.8.0",
 "description":"Read-only full-text BM25 search over a pre-built index.",
 "tools":[{"name":"search","endpoint":"/search","method":"GET",
           "inputSchema":{"type":"object",
             "properties":{"q":{"type":"string"},
               "k":{"type":"integer","minimum":1,"maximum":100,"default":10},
               "mode":{"type":"string","enum":["bm25"],"default":"bm25"}},
             "required":["q"]}}],
 "transport":{"http":{"baseUrl":"/"},"jsonrpc":"... on the roadmap ..."}}
```

The `transport.jsonrpc` note is honest: a conformant MCP JSON-RPC endpoint at
`/mcp` is roadmap, not shipped. Today the `search` tool is callable directly
over HTTP at `/search`. Always `200`; cacheable.

---

## What the engine maps to

`GET /search` runs CuttleDB's `LSEARCH` verb against the snapshot loaded at boot.
The verb is fixed in the VM (`db_search` opcode); the query is a sanitized bound
parameter — it can never select a different (write-capable) verb, and a
CR/LF-free term cannot inject a second command. See the [security model](#) in
DEPLOY.md.

## Data lifecycle

The server is read-only. Indexes are built **offline** and loaded **at boot**:

```
offline ingest  ->  index.snap  ->  server LOADs read-only at boot
(build tool)        (operator)      (db_load, operator-config path)
```

To update the index, build a new snapshot and restart the service. Ingestion and
all write paths live outside the public binary.
