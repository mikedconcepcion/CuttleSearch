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
{"status":"ok","service":"cuttlesearch","version":"0.9.0"}
```

Always `200`. Use this for container/orchestrator health checks.

---

## `GET /search?q=<query>`
## `POST /search?q=<query>`

Run a search over the loaded index and return ranked hits. Two retrieval signals
are available and may be used together: **`q`** (BM25 full-text) and **`filter`**
(a Boolean expression over indexed columns). At least one of the two is required.

| Param | In | Required | Notes |
|-------|----|----------|-------|
| `q`   | query string | one of `q`/`filter` | The full-text search text (BM25). URL-encoded: `+` and `%20` become spaces; `%XX` decodes to bytes (UTF-8 supported). Control bytes, `"`, and `\` are stripped server-side. An **empty** value (`q=`) is treated as *absent*, not an error — so `q=&filter=...` is a valid filter-only request. (`q=` with no `filter` is still a `400`.) |
| `filter` | query string | one of `q`/`filter` | A Boolean filter expression (see [grammar](#filter-expression-grammar)). URL-encode it: spaces as `+`/`%20`, `"` as `%22`, `=`/`<`/`>` as `%3D`/`%3C`/`%3E`, etc. Decoded server-side; CR/LF, other control bytes, and `\` are stripped (so it can never inject a second command), while quotes and DSL operators are preserved. |
| `index` | query string | no | Which named collection to search. Selects among the snapshots loaded at boot (e.g. `default`, `b`). Absent, empty, or **unknown** values silently fall back to the default index; the response echoes the `index` that actually answered. The name indexes a fixed in-memory roster — it is never used as a filesystem path, so values like `../index` are harmless and just fall back. |
| `k`   | query string | no | Max hits to return. Clamped to `[1,100]`; absent/zero/negative/non-numeric defaults to `10`. Leading digits followed by junk are honored (`k=5x` → `5`); any trailing junk is skipped so it never swallows the params that follow it. |
| `mode`| query string | no | Retrieval mode. `bm25` (default) is live. `vector` and `hybrid` are proven in the reference engine but not yet in the binary → `501`. Any other value → `400`. |

Params may appear in any order; unknown params are ignored. `POST` accepts the
parameters in the query string (request-body parsing is deferred); it behaves
identically to `GET` in v1.

**How `q` and `filter` combine:**

- **`q` only** → plain BM25 ranking. `mode` is reported as `bm25`; scores are raw BM25 (`%.4f`).
- **`filter` only** → the Boolean expression selects the matching rows, returned in row order. `mode` is reported as `filter`.
- **`q` + `filter`** → the filter selects the candidate set; `q` ranks within it. Rows that pass the filter but don't match `q` are still returned with score `0`, best `q` matches first. `mode` is reported as `filter`. (When a filter is present, scores are RRF-fused relevance, not raw BM25.)

### Success — `200`

```
$ curl -s 'http://HOST:8787/search?q=fox+river'
{"query":"fox river","k":10,"index":"default","mode":"bm25","took_ms":0,
 "total":3,"hits":[{"id":1,"score":1.7509,"text":"a fast red fox leaps across the river"},
                   {"id":4,"score":0.8288,"text":"the river flows fast under the old stone bridge"},
                   {"id":0,"score":0.8288,"text":"the quick brown fox jumps over the lazy dog"}]}
```

| Field | Type | Meaning |
|-------|------|---------|
| `query` | string | The decoded query, echoed back (sanitized). |
| `k`     | int | Effective max hits (the clamped value actually applied). |
| `index` | string | The named collection that actually answered. Echoes back `default` when the request omitted `index` or named one that isn't loaded. |
| `mode`  | string | Retrieval mode. `bm25` = lexical. |
| `took_ms` | int | Reserved (currently `0`). |
| `total` | int | Number of hits returned. |
| `hits`  | array | Ranked results, highest score first. |
| `hits[].id` | int | Row id in the indexed table. |
| `hits[].score` | float | BM25 relevance score (`%.4f`). |
| `hits[].text` | string | The matched document's indexed text, JSON-escaped and snippet-capped (~280 bytes, UTF-8-boundary-safe). Empty string if the source cell is unavailable. |

If no index was loaded at boot, the service still answers with a structurally
valid empty result: `"total":0,"hits":[]`.

### Filtered search — `200`

A Boolean `filter` selects rows by structured predicates over indexed columns.
Combine it with `q` to rank the selected rows by full-text relevance, or use it
alone to retrieve every matching row.

```
# filter only — every row where column 2 equals "news"
$ curl -sG 'http://HOST:8787/search' --data-urlencode 'filter=2="news"'
{"query":"","k":10,"index":"default","mode":"filter","took_ms":0,
 "total":2,"hits":[{"id":3,"score":1.0,"text":"..."},{"id":7,"score":1.0,"text":"..."}]}

# q + filter — "fox" ranked, restricted to rows passing the Boolean expression
$ curl -sG 'http://HOST:8787/search' --data-urlencode 'q=fox' \
       --data-urlencode 'filter=(2="news" OR 2="blog") AND 5>=3'
```

#### Filter expression grammar

The expression is a recursive-descent Boolean over **column-index-addressed**
predicates (columns are addressed by their ordinal in the indexed table — `0`,
`1`, `2`, …):

| Form | Meaning |
|------|---------|
| `<col> = <num>` / `!= < <= > >=` | Numeric comparison against a column. |
| `<col> = "<string>"` / `!= "<string>"` | Exact string equality / inequality. |
| `A AND B`, `A OR B` | Boolean composition (left-associative). |
| `( … )` | Grouping / precedence. |

Predicate values that contain spaces or punctuation must be URL-encoded in the
request. There is no `NOT` operator yet, and string predicates are exact-match
(not substring) — substring/phrase matching is what `q` (BM25) is for. A
syntactically invalid expression is **not** an error: it simply matches no rows
(`"total":0,"hits":[]`), keeping the endpoint forgiving for exploratory callers.

### Multi-index routing — `200`

One CuttleSearch process can serve several independent collections. The operator
loads each snapshot at boot under a name (`default`, `b`, …); a request selects
one with the `index` param. Routing is by name against a **fixed in-memory
roster** — the name never touches the filesystem, so it can't be used to load an
arbitrary file or traverse paths.

```
# the default collection (index omitted)
$ curl -s 'http://HOST:8787/search?q=fox'
{"query":"fox","k":10,"index":"default","mode":"bm25","took_ms":0,"total":2,"hits":[...]}

# a second collection — different corpus, same schema
$ curl -s 'http://HOST:8787/search?q=saturn&index=b'
{"query":"saturn","k":10,"index":"b","mode":"bm25","took_ms":0,"total":1,"hits":[...]}

# unknown / malformed index name → forgiving fallback to default (note the echo)
$ curl -s 'http://HOST:8787/search?q=fox&index=../index'
{"query":"fox","k":10,"index":"default","mode":"bm25","took_ms":0,"total":2,"hits":[...]}
```

The `index` field in the response always tells you which collection actually
answered, so a caller can detect a typo'd index by comparing what it asked for
against what came back. The `index` param composes with everything else —
`filter`, `k`, and param order are all independent of it.

### Errors

| Status | Body `error.code` | When |
|--------|-------------------|------|
| `400`  | `bad_request` | neither `q` nor `filter` supplied (`{"message":"missing required parameter: provide q (full-text) or filter (Boolean)"}`) |
| `400`  | `bad_request` | raw `"` or `\` in the `q` value (`{"message":"invalid characters in query"}`) — note this applies to `q` only; `filter` legitimately contains quotes and is sanitized rather than rejected |
| `400`  | `bad_request` | unrecognized `mode` value — only `bm25` is live; `vector` / `hybrid` are recognized but return `501` (see below), and any other value is a `400` |
| `404`  | `not_found` | unknown route |
| `413`  | `payload_too_large` | request line exceeds 8192 bytes |
| `501`  | `not_implemented` | `mode=vector` or `mode=hybrid` (roadmap; use `bm25`) |

Error envelope shape:

```json
{"error":{"code":"bad_request","message":"missing required parameter: provide q (full-text) or filter (Boolean)"}}
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
const res = await cs.search("fox river", { k: 5 });   // → { …, hits: [{ id, score, text }] }
```

```python
from cuttledb.search import CuttleSearchClient

cs = CuttleSearchClient("http://HOST:8787")
res = cs.search("fox river", k=5)                      # → { …, "hits": [{ "id", "score", "text" }] }
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
{"name":"cuttlesearch","version":"0.9.0",
 "description":"Read-only full-text BM25 search over a pre-built index.",
 "tools":[{"name":"search","endpoint":"/search","method":"GET",
           "inputSchema":{"type":"object",
             "properties":{"q":{"type":"string"},
               "filter":{"type":"string"},
               "k":{"type":"integer","minimum":1,"maximum":100,"default":10},
               "index":{"type":"string","default":"default"},
               "mode":{"type":"string","enum":["bm25"],"default":"bm25"}},
             "anyOf":[{"required":["q"]},{"required":["filter"]}]}}],
 "transport":{"http":{"baseUrl":"/"},"jsonrpc":"... on the roadmap ..."}}
```

The `transport.jsonrpc` note is honest: a conformant MCP JSON-RPC endpoint at
`/mcp` is roadmap, not shipped. Today the `search` tool is callable directly
over HTTP at `/search`. Always `200`; cacheable.

---

## What the engine maps to

`GET /search` runs against the snapshot loaded at boot using one of two fixed
read-only verbs:

- a `q`-only request runs CuttleDB's `LSEARCH` verb (`db_search` opcode);
- any request carrying a `filter` runs the `BSEARCH` Boolean verb (`db_bsearch`
  opcode), with `q` (when present) supplied as the BM25 scoring atom.

Each verb is **hardcoded in the VM** — a request can never select a different
(write-capable) verb. Both the query term and the filter expression are
sanitized bound parameters stripped of CR/LF and other control bytes, so neither
can inject a second wire command. See the [security model](#) in DEPLOY.md.

## Data lifecycle

The server is read-only. Indexes are built **offline** and loaded **at boot**:

```
offline ingest  ->  index.snap   ->  server LOADs read-only at boot  (name: default)
(build tool)        index_b.snap                                     (name: b)
                    (operator)       (db_load, operator-config paths)
```

Each snapshot is loaded under a fixed name into its own read-only handle. Adding
a collection is an operator action — build a snapshot, register it under a name,
restart — never a request-driven one. The `index` param chooses **among** the
already-loaded names; it can't introduce a new one or point at a file on disk.

To update an index, build a new snapshot and restart the service. Ingestion and
all write paths live outside the public binary.
