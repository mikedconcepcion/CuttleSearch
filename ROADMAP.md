# CuttleSearch — roadmap

> How CuttleSearch gets built and shipped. Checkable against
> [DEFINITION.md](DEFINITION.md). Where this roadmap and the old
> `../SearchEngine/ROADMAP.md` disagree, this one wins — that one is the
> superseded consumer/Perplexity framing.

Two questions this doc answers up front, because they decide everything
else:

1. **How does it ship?** — a self-contained binary (primary), also WASM.
2. **What does it need from the substrate (OctoASM / CuttleDB) that
   isn't there yet?** — §3, the honest gap list.

---

## 1. Distribution — how CuttleSearch ships

### The decision: its own binary, built like the rest of the stack

CuttleSearch ships **exactly the way the rest of the stack already ships
today**: the `cuttledb-server` engine + a compiled program object,
two files, one self-contained unit, **<1 MB, zero deps, copy-and-run.**

```
cuttledb-server    (~440KB)  — the CuttleDB engine (shared with CuttleDB)
cuttlesearch.obin  (~tens KB)— the search-engine program (OctoASM/OctoFlow)
────────────────────────────
  one unit, <1 MB, copy-and-run. Apache-2.0 surface, engine core stays closed.
```

This mirrors the `cuttledb-server` precedent: one shared engine binary plus
a compiled program object. The search-engine **logic** (ingestion,
analyzers, mapping, query-DSL parser, the REST/agent API, relevance
rules) is **written in OctoASM/OctoFlow on top of the substrate** — that
is where it belongs per `STACK_SOP.md`: it's compute + orchestration, not
an OS boundary. The engine's C core is touched **only** where the
substrate genuinely lacks a retrieval primitive (see §3). Ideal new-C
count: near zero.

> Resolves DEFINITION.md open question *"own binary vs. mode-flag."*
> **Own binary.** Standalone identity demands its own front door. (It can
> still be the same CuttleDB engine core under the hood — that's an
> implementation detail, not the product's face.)

### Three release carriers — same program, three shells

The substrate already runs the identical wire protocol over three
transports (`FEATURES.md` §Transports). CuttleSearch inherits all three:

| Carrier | What it is | Primary use | Status |
|---|---|---|---|
| **Native binary** | `cuttlesearch.exe` + `.obin`, a server you run | Servers, Docker, CI, the default | **primary release** |
| **WASM** | `cuttlesearch.wasm` (~189KB core today), in-process, no socket | Embedded / browser / edge search, no server to run | secondary |
| **SDK clients** | `cuttlesearch` on PyPI + npm — thin clients that speak the wire/REST API | App integration | ships with the binary |

So the answer to *"binary, OctoASM, or WASM?"* is: **the program is
written in OctoASM/OctoFlow; the primary release is the binary; WASM is
the same program in a second shell for embedded/browser.** Not
either/or — the OctoASM is the *source*, the binary and WASM are two
*builds* of it.

### Standalone vs. paired — the "hyper-optimize if paired" mechanic

CuttleSearch is standalone (it bundles the substrate the way
Elasticsearch bundles Lucene). "Hyper-optimized when paired with
CuttleDB" has a precise technical meaning — two run modes:

| Mode | How storage works | Surfacing / access control | Speed |
|---|---|---|---|
| **Embedded** (standalone default) | CuttleSearch owns its own in-process substrate + index files | CuttleSearch's own index ACLs | in-process `exec_line` (~5μs/op) |
| **Attached** (paired) | Points at an existing CuttleDB instance over the wire | **CuttleDB governs public/private** — CuttleSearch re-implements nothing | TCP/WS; **in-process fast path (~5μs) when co-located in the same process/substrate** |

The "hyper-optimization" is literal: when CuttleSearch and CuttleDB are
the same `cuttledb-server` process, queries skip the socket entirely and go
through the in-process call path (~5μs vs a network round trip), and
CuttleDB's access model decides what's surfaced rather than CuttleSearch
duplicating tenancy logic. Pairing is a **superpower, never a
requirement** — the embedded default must stand fully on its own.

**Where new capability lives — the dividing line.** The two modes differ
in *what CuttleSearch is allowed to add*:

- **Attached (paired):** CuttleSearch **only exposes what CuttleDB
  already does** — its existing verbs (`KNN`, `LSEARCH`, `SEARCH`,
  `BSEARCH`, …) — and **optimizes** the path to them (query compilation,
  the in-process fast path, agent-native response shaping). It adds **no
  new retrieval features**, and it **does not modify CuttleDB**. CuttleDB
  is under its own push-readiness work; CuttleSearch is a consumer, hands
  off. The ceiling in paired mode is "what CuttleDB can do."
- **Embedded (standalone):** this is where CuttleSearch **implements
  more** than the substrate exposes — analyzers, typo tolerance,
  highlighting, faceting beyond the raw verbs — **in its own layer**
  (OctoASM/OctoFlow over its bundled substrate), and where the bench
  proves those additions. The standalone engine is the R&D surface; the
  paired engine is the fast, governed surface.

> Resolves DEFINITION.md open question *"bundled substrate = public
> CuttleDB vs. internal build."* **Embedded mode bundles an internal
> substrate build** (the same closed CuttleDB engine core CuttleDB ships).
> **Attached mode speaks to a public CuttleDB** over the wire. Both
> exist; embedded is the default.

---

## 2. What it's built ON — substrate that exists today

These ship in CuttleDB **now** (v0.7.0, verified in `FEATURES.md`).
CuttleSearch composes them; it does not re-implement them.

- **Storage / data model** — typed columns (int, float, string, vector,
  datetime), 16 handles × 256 tables, string arena dedup.
- **Lexical** — `INDEX … BM25` (Lucene defaults k1=1.5, b=0.75) +
  `LSEARCH`.
- **Vector** — `VEC` columns, brute-force SIMD `KNN`, `INDEX … HNSW`
  with incremental insert/delete, `KNN … WHERE` filtered ANN.
- **Hybrid** — `SEARCH … ||| …` (RRF fusion, k=60).
- **Boolean** — `BSEARCH` DSL (filter atoms + scoring atoms in one
  expression).
- **Real-time** — `SUB`/`UNSUB` push, `LOG` change feed (1024-event
  ring).
- **Durability** — WAL mode, `SAVE`/`LOAD` snapshots, transactions.
- **Ops / security** — `AUTH`, rate-limit, slow-log, `STATS`/`INFO`,
  TLS-via-terminator.
- **In-process + WASM** — `cuttledb_exec_line`, the paired fast path.

---

## 3. What standalone CuttleSearch must implement (the gap list)

The honest part — and note **whose** code this is. Everything below is
implemented in **CuttleSearch's standalone layer** (OctoASM/OctoFlow over
its bundled substrate), **not** pushed into the public CuttleDB. Paired
mode gets only what CuttleDB already exposes (§1); standalone is where
these additions live and get benched. CuttleDB is not modified.

"Search-engine surface" is mostly **above** the wire verbs, but a few
items may eventually wall into the substrate (C) — and *that C is
CuttleSearch's own embedded build, never the public CuttleDB*. Per
`STACK_SOP.md`, each is tagged with where it should live.

| Capability | Lives in | Substrate gap? | Notes |
|---|---|---|---|
| Ingestion pipeline (docs → analyze → embed → index) | OctoFlow (orchestration) | **No** | Composes `INS_BATCH` + embedder + `INDEX`. |
| Index & mapping management (declare fields, types, what's vectorized/filterable/faceted) | OctoFlow (config) | **No** | Maps onto handles/tables/columns. |
| Query DSL → wire compiler (filters/sort/page/facets → `BSEARCH`/`SEARCH`/`KNN`) | OctoASM (parser/compiler) | **No** | Pure translation layer. |
| **Analyzers** (stemming, stop-words, synonyms, language) | OctoASM | **Partly** | Today's BM25 tokenizer = "split non-alphanumeric, lowercase." Richer analysis can pre-expand tokens above the verb; deep language handling may want a substrate tokenizer hook. |
| **Typo tolerance** (the Meilisearch/Typesense headline) | OctoASM + maybe C | **Likely yes** | Fuzzy matching over the inverted index. Either above-substrate query expansion (cheap, first cut) or fuzzy postings in `octodb_bm25.c` (fast, later). **Biggest competitive gap.** |
| **Highlighting** (snippets with matched terms marked) | OctoASM + maybe C | **Likely yes** | Needs term **positions**. Check whether BM25 postings store positions; if not, that's a substrate add. |
| Faceting / aggregations (counts per facet value over a filtered set) | OctoFlow | **Verify** | CuttleDB has GROUP BY + O(1) COUNT; facet-count UX likely composes, confirm in Sprint 4. |
| Relevance tuning (field boosts, ranking rules, fusion knobs) | OctoASM | **No (mostly)** | Re-weight above RRF; only a per-field-weight knob would touch C. |
| Pagination / sort by arbitrary field | OctoASM | **Verify** | Compose `SELECT` + sort; confirm large-offset cost. |
| Multi-index / multi-tenant scoping | OctoFlow + `AUTH` | **No (mostly)** | index = table/handle; scoped access via per-handle AUTH. |
| Agent-native progressive disclosure (token-budgeted responses) | OctoASM (API formatter) | **No** | Response-shaping; the old "compass" idea, demoted to one feature. |
| Admin console | embedded HTML+JS / OctoUI | **No** | Thin operator surface. |

**Three real substrate candidates**, in priority order: typo tolerance,
highlighting (positions), and richer analyzers. Everything else is
above-the-line OctoASM/OctoFlow work. We resolve each the
`STACK_SOP.md` way — try OctoASM first, drop to C only when the wall is
concrete and measured — and any such C lands in **CuttleSearch's own
embedded build**, keeping the published CuttleDB untouched.

---

## 4. Sprints — each lands a measurable bench delta

Bench-first throughout (the Engram lesson). Every sprint must move a
number on the proving harness — the internal dev bench at `internal/bench/`,
**not part of the shipped product** — which sits between the `none` floor
(0.00) and `oracle` ceiling (1.00). Paths like `bench/…`,
`reference/cuttlesearch/…`, and `engine/…` below all refer to that internal
harness, kept out of the product repo (see `internal/`).

### Bench tracks — one harness, several scorecards

There isn't one bench; there are several **tracks**, each a set of modes,
all scored on the **same corpus, tasks, gold_docs, and metrics**
(recall@k / NDCG / MRR / latency / cost) so the rows are directly
comparable. The harness is already track-agnostic — a track is just a
labelled group of modes in the registry.

| Track | What it measures | Example modes |
|---|---|---|
| **Standalone** | CuttleSearch's own engine + the features it *adds* (analyzers, typo tolerance, …) | `bm25`, `vector`, `hybrid`, `typo`, `facet` |
| **Paired — CuttleDB** | CuttleSearch exposing + optimizing CuttleDB's existing verbs (no new features) | `cuttledb-passthrough`, `cuttledb-inproc` |
| **Paired — others** | CuttleSearch (or a comparison) over a non-Cuttle backend | `sqlite-fts5`, `postgres-fts` |
| **Competitors** | External search engines on the identical corpus/tasks | `meilisearch`, `typesense`, `elasticsearch` |

The brackets (`none` floor, `oracle` ceiling) bound **all** tracks. The
standalone track is where we *win on features*; the paired tracks are
where we *win on speed/footprint vs. SQL-bolted-on-search and the
incumbents*. Same numbers, so "standalone hybrid vs. Postgres FTS vs.
Meilisearch on this corpus" is one apples-to-apples table.

### Sprint 0 — bench (in progress)
- [x] Dependency-free harness: `none` (0.00) and `oracle` (1.00)
  brackets, deterministic keyword grader, invented corpus.
- [x] **Re-aim for the search-engine lane:** added retrieval metrics
  (`metrics.py`: recall@k, NDCG@10, MRR; `bench.py`: p50/p99 latency,
  index throughput docs/s, index size). The keyword/answer grader stays
  as the end-to-end rail; these are the search-quality rails. `report.py`
  now prints two tables (retrieval quality + cost/ingestion).
- [x] Add real CuttleSearch modes as they land (`bm25`, `vector`,
  `hybrid`) — verified they score **between** none and oracle (Sprint 1).
- [x] Scale corpus from seed (10 docs / 8 tasks) to **49 docs / 30 tasks**
  (Brindle / Sluice / Ember / Wisp / Lattice / Filament / Cinder
  subsystems + a TQ error-code reference decoy + paraphrase tasks).
  Calibration holds: `none` 0.00, `oracle` 1.00 on all 30 tasks.

**Gate:** harness reports retrieval metrics + answer score for any mode.
**Met** — see the two-table report above.

### Sprint 1 — index, mapping, ingestion (the spine) — SPLIT GATE
Built as a dependency-free **reference engine** (`bench/engine/`) that
defines correct retrieval; the shipping binary + paired CuttleDB track
must reproduce it (same pattern as OctoCortex's NumpyBackend → OctoDB).
- [x] Mapping declaration: `Mapping` (key / text / vector / filter
  fields) in `engine/index.py`.
- [x] Ingestion pipeline: documents in → analyze (`engine/analyze.py`)
  → BM25 index + TF-IDF-cosine vector index. *(Reference uses pure-Python
  rankers; the `INS_BATCH` / `INDEX BM25` / `INDEX HNSW` + native
  embedder binding is the **paired-track** wiring, deferred to Sprint 6.)*
- [x] "Ready to search" contract: `SearchIndex.ready`; search raises
  `NotReady` until `ingest(corpus)` completes.
- [x] Bench modes `bm25`, `vector`, `hybrid` (→ CuttleDB LSEARCH / KNN /
  SEARCH) land **strictly between** the brackets on the ranking rails.

**Gate result — re-run on the 49-doc / 30-task corpus: FULL PASS.**
- **PASS** — all three modes land between `none` (0.00) and `oracle`
  (1.00) on every rail. recall@10 **un-saturated** (1.00 -> 0.95) once the
  corpus grew past the trivial seed and the TQ error-code reference page
  (d041) became a lexical decoy, so NDCG/MRR now genuinely discriminate.
- **PASS (the sub-gate that failed on the seed)** — on the scaled corpus
  `hybrid` now **leads** the ranking rails: NDCG@10 hybrid **0.80** >
  vector 0.78 > bm25 0.77; MRR hybrid **0.75** > vector 0.74 > bm25 0.72.
  ans-acc bm25 0.89 = hybrid 0.89 > vector 0.88. Index ~94KB, build
  ~7-8.6K docs/s.

  *Earlier seed result (10 docs / 8 tasks), kept for the record:* hybrid
  did NOT beat bm25 there (bm25 0.77 >= vector 0.76 > hybrid 0.74) because
  the invented-term corpus was lexically trivial: exact query/doc token
  overlap ranked gold near rank-1 and RRF *diluted* an already-near-ceiling
  top hit. Hybrid earns its keep only when the rankers are
  **complementary**; the paraphrase tasks (Q27/Q28) + the reference-page
  decoy supplied that complementarity, and the prediction held: scale the
  corpus, don't tune RRF. The dedicated typo/variant lever still lands in
  **Sprint 3**.

**Paired-track BM25 rows (added alongside Sprint 1).** Two real database
backends now rank the same corpus next to the reference engine, so the
"reproduce the reference" claim is measured, not asserted:

| mode | backend | track | ans-acc | recall@10 | NDCG@10 | MRR | p99 ms | build docs/s | index |
|---|---|---|---|---|---|---|---|---|---|
| `bm25` | pure-Python reference | standalone | 0.89 | 0.95 | 0.77 | 0.72 | 0.45 | 9124 | 94KB |
| `sqlite` | SQLite FTS5 `bm25()` | paired — others | 0.89 | 0.95 | 0.78 | 0.73 | 0.46 | 36694 | 80KB |
| `cuttledb` | CuttleDB `LSEARCH` (wire) | paired — CuttleDB | 0.87 | 0.85 | 0.75 | 0.72 | 2.02 | 18202 | 25KB |

- **`sqlite`** (`modes/mode_sqlite.py`) — zero new dependency (Python's
  bundled `sqlite3` ships FTS5). In-memory FTS5 virtual table, tokenizer
  `unicode61 tokenchars '_'` so `shard_fanout` stays one token, matching
  the reference analyzer. It **reproduces the reference band** (the +0.01
  NDCG edge is FTS5's default `k1=1.2` vs the reference `k1=1.5`). This is
  the proof a real DB backend matches the reference engine.
- **`cuttledb`** (`modes/mode_cuttledb.py`) — opt-in, drives a *running*
  cuttledb-server over the wire SDK (skips cleanly via `ModeUnavailable`
  if unreachable; no CuttleDB source touched — pure consumer). Its recall
  gap (0.85 vs 0.95) is the **informative finding**: CuttleDB's BM25
  tokenizer splits on the underscore (`shard_fanout` -> `shard` +
  `fanout`), so config-knob queries rank worse. That -0.10 recall is
  exactly the value the standalone analyzer adds on top of the substrate.
  The 2.02 ms p99 is the TCP round-trip vs the in-process engines; the
  attached/in-process fast path closes it in **Sprint 6**.
- **Scoped to the lexical lane.** Only LSEARCH (BM25) is wired — the
  embedding-free counterpart to `bm25`/`sqlite`. CuttleDB's `KNN`
  (vector) and `SEARCH` (RRF hybrid) verbs need the corpus vectorized
  into VEC columns; that paired-track wiring is **Sprint 6**.

### Sprint 2 — query DSL + search API
- [ ] Query DSL (filters + sort + pagination), compiled to
  `BSEARCH`/`SEARCH`/`KNN` wire verbs.
- [ ] REST + agent API: one documented contract, local-first, no auth on
  `localhost`.
- [ ] **Decide DSL dialect** — invent vs. speak a subset of an existing
  one (ES Query DSL / Meilisearch params) for drop-in adoption. *(Still
  open; see §5.)*

**Gate:** every bench task expressible as a DSL query; same scores as
the hand-wired Sprint-1 modes.

### Sprint 3 — analyzers + typo tolerance (the competitive edge)
- [x] **Structured-token analyzer (pulled forward, bench-proven).**
  "Keep-whole + also-parts": keep structured compounds whole (config
  knobs `shard_fanout`, error codes `E1054`, file paths `src/vm/interp.c`,
  versions `v3.7.21`, commit SHAs `a8e63fb`) AND emit their parts; ordinary
  hyphenated English / dotted abbrevs fall through to parts-only.
  Selectable (`analyzer_mode="structured"|"naive"`) so the naive split is
  the A/B control arm. **Proof:** on the isolating `corpus_struct`,
  `bm25` 1.00 vs `bm25-naive` 0.17 recall@10 (robust across seeds +
  haystack size); realistic mixed-query lift is canonical-30 `hybrid`
  +0.04/+0.06. Most valuable as a **query-construction** layer — the
  `sqlite` push-down (build an FTS5 phrase query from the whole-compound
  token) transfers the benefit to a backend whose own index splits the
  compound. See `bench/README.md` §"Isolating the analyzer".
- [ ] Analyzer chain: stemming, stop-words, synonyms, language.
- [ ] Typo tolerance — first cut above-substrate (query expansion);
  measure; only then consider fuzzy postings in C if latency warrants.
- [ ] Bench: add typo'd-query and morphological-variant tasks.

**Gate:** typo/variant recall jumps vs. Sprint 1; latency stays sane.
Structured-token sub-gate **met** (decisive A/B on `corpus_struct`).

### Sprint 4 — faceting + highlighting
- [ ] Facet counts over filtered result sets.
- [ ] Highlighting — confirm/extend BM25 positions; return marked
  snippets.

**Gate:** facet counts correct vs. brute-force; highlight offsets exact.

### Sprint 5 — relevance tuning
- [ ] Field boosts, ranking rules, hybrid fusion knobs.
- [ ] Bench: a relevance-tuning task where a boost rule changes ordering
  measurably (NDCG up).

**Gate:** documented knob moves the metric in the documented direction.

### Sprint 6 — multi-index + paired (attached) mode
- [ ] Multiple indexes, scoped access (per-handle AUTH).
- [ ] **Attached mode:** point at an external CuttleDB; CuttleDB governs
  public/private surfacing. In-process fast path when co-located.

**Gate:** same query, embedded vs. attached, identical results;
co-located path measurably faster than socket.

### Sprint 7 — agent-native mode
- [ ] Token-budgeted progressive disclosure (expand-on-demand).
- [ ] Bench: an agent mode that pays only for what it expands; tok/correct
  beats naive full-context retrieval.

**Gate:** agent mode matches hybrid accuracy at lower tok/correct.

### Sprint 8 — admin console
- [ ] Thin UI: create indexes, watch ingestion, sanity-check ranking.
  Operator surface, not the product.

### Sprint 9 — competitor bench + hardening + release
- [ ] Competitor brackets: Meilisearch, Typesense (Algolia / ES if
  feasible) on the **same** corpus/tasks — relevance, latency, footprint.
- [ ] Backup/restore (WAL replay verify), TLS guidance, observability.
- [ ] Landing page (footprint side-by-side), tutorials, signed binary
  release via the same pipeline as CuttleDB.

**Gate:** CuttleSearch within striking distance of Meilisearch/Typesense
on relevance at a fraction of the footprint; release artifacts signed.

---

## 5. Still open (decide in-sprint, not now)

- **Query DSL dialect** — invent vs. subset of ES/Meilisearch. Decided
  in Sprint 2. Leaning: speak a familiar subset for drop-in adoption,
  with our extensions namespaced.
- **Typo tolerance depth** — above-substrate expansion vs. C fuzzy
  postings. Decided by Sprint 3 latency numbers.
- **Embedder default** — CuttleMem NativeEmbedder vs. BYO-only.
- **Index = table vs. handle** — the multi-tenant mapping granularity.
  Decided in Sprint 1 / revisited in Sprint 6.
