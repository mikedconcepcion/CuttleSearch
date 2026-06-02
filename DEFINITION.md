# CuttleSearch — what it is

> Foundational identity doc. Everything else (spec, roadmap, bench,
> marketing) must be checkable against this. It reframes the product as
> developer search infrastructure rather than a consumer/agent product.

## One sentence

**CuttleSearch is an open-source search engine you point at your data —
full-text, vector, and hybrid ranking with faceting and relevance
tuning, in one self-contained binary under 1 MB.**

## The lane

Developer **search infrastructure** — the Elasticsearch / OpenSearch /
Algolia / Meilisearch / Typesense lane. General-purpose. It indexes
documents and serves ranked search over them. Both humans and LLM agents
are first-class clients of the same open API.

It is **not** a consumer search product (not Perplexity/Kagi). Use cases
like "internal product search for an online store" *demonstrate* it; they
don't *define* it. (Same discipline as CuttleDB: a database, not an
"agent memory store.")

## Standalone, pairs best with the family

CuttleSearch is a **standalone product**, exactly like CuttleDB — its own
API, its own front door, useful on its own with zero other Cuttle
components installed. It runs on the shared `cuttledb-server` engine (the
same zero-dependency binary CuttleDB runs on) executing its own assembled
program, `cuttlesearch.obin`; together they are one copy-and-run unit that
bundles the retrieval substrate the way Elasticsearch bundles Lucene. You
never install CuttleDB to use it — the engine ships with CuttleSearch.

It **pairs best with CuttleDB**: if your data already lives in a CuttleDB
deployment, CuttleSearch becomes the search/relevance layer over it, and
**CuttleDB governs what is surfaced public vs private**. The two snap
together because they ride the same engine — but neither requires the
other.

Mechanically this is two run modes (see [ROADMAP.md](ROADMAP.md) §1):

- **Embedded** (standalone default) — the `cuttledb-server` engine and the
  index files travel with CuttleSearch, the way Elasticsearch bundles
  Lucene.
- **Attached** (paired, *hyper-optimized*) — CuttleSearch points at an
  existing CuttleDB; CuttleDB governs surfacing and, when co-located in
  the same process, queries take the in-process fast path (~5μs/op) with
  no socket. Standalone always works; pairing is a superpower, never a
  requirement.

## What CuttleSearch adds (the product surface)

Over the raw retrieval primitives CuttleDB already has (BM25, HNSW
vector, RRF fusion, Boolean DSL), CuttleSearch is the *search-engine
product* on top:

- **Ingestion pipeline** — documents in → analyzed → tokenized →
  embedded → indexed, with a clear "ready to search" contract.
- **Analyzers / tokenizers** — language handling, stemming, stop-words,
  synonyms, typo tolerance. *First piece prototyped in the internal bench:*
  a structured-token analyzer ("keep-whole + also-parts") that keeps config
  knobs / version strings / error codes / file paths / identifiers one token
  where a raw substrate tokenizer would shatter them — decisive on code- and
  config-heavy corpora (proven in the internal bench harness).
- **Index & mapping management** — declare searchable fields, types,
  facets, what's vectorized, what's filterable.
- **Search API + query DSL** — full-text + filters + facets + sort +
  pagination + highlighting, in one documented contract.
- **Relevance tuning** — field boosts, business/ranking rules, hybrid
  (lexical+vector) fusion knobs, learn-to-rank later.
- **Multi-index / multi-tenant** — many indexes, scoped access.
- **Agent-native mode** — progressive disclosure / token-budgeted
  responses so an LLM pays only for what it expands (the old "compass"
  idea, demoted from product identity to one API feature).
- **Admin console** — a thin UI to create indexes, watch ingestion,
  sanity-check ranking. Operator surface, not the product.

## What it reuses (does not reinvent)

Storage, BM25, vector/HNSW, RRF, WAL durability, real-time SUB/UNSUB
push — all from the shared CuttleDB engine substrate. CuttleSearch
spends its code budget on the search-engine surface above, not on
re-implementing retrieval.

## Why it can win this lane

- **Self-contained, <1 MB, zero deps** — vs Elasticsearch (JVM, GBs) and
  even Meilisearch/Typesense (tens of MB). Copy-and-run.
- **Hybrid native** — lexical + vector + RRF are substrate primitives,
  not a bolt-on plugin.
- **Agent-native API** — token-budgeted progressive disclosure is built
  for LLM clients, which competitors retrofit.
- **Real-time built in** — SUB/UNSUB push from the substrate; live
  indexes without a separate stream layer.
- **Sovereign / file-you-own** — runs on your machine; your index is a
  file you control. CuttleDB decides public/private.

## Competitors (the bench must measure against these)

Meilisearch, Typesense, Algolia, Elasticsearch / OpenSearch. **Not**
Perplexity / Tavily / Brave.

## Open (decide later, not now)

- Query DSL: invent one vs. speak a subset of an existing dialect
  (Elasticsearch Query DSL / Meilisearch params) for drop-in adoption.
  *(Decided in ROADMAP Sprint 2.)*

## Resolved (see ROADMAP.md)

- **Own binary, not a mode-flag.** Ships as the `cuttledb-server` engine
  (same as CuttleDB) plus the assembled `cuttlesearch.obin` program, <1 MB,
  copy-and-run. Standalone identity gets its own front door. A WASM carrier
  (the engine compiled to WASM, running `cuttlesearch.obin` in-process) is on
  the roadmap for embedded/browser — not yet packaged.
- **Bundled engine (embedded) / separate CuttleDB (attached).** Embedded
  mode bundles the CuttleDB engine in-process; attached mode speaks to a
  separate CuttleDB over the wire. Both exist; embedded is the default.
