# CuttleSearch — what it is

> Foundational identity doc. Everything else (spec, roadmap, bench,
> marketing) must be checkable against this. Supersedes the framing in
> `../SearchEngine/` (which positioned a consumer/agent product; this
> reframes to developer search infrastructure).

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
binary, its own API, useful on its own with zero other Cuttle components
installed. It bundles the retrieval substrate the way Elasticsearch
bundles Lucene.

It **pairs best with CuttleDB**: if your data already lives in a CuttleDB
deployment, CuttleSearch becomes the search/relevance layer over it, and
**CuttleDB governs what is surfaced public vs private**. The two snap
together because they share the same substrate — but neither requires the
other.

Mechanically this is two run modes (see [ROADMAP.md](ROADMAP.md) §1):

- **Embedded** (standalone default) — CuttleSearch bundles its own
  substrate and index files, the way Elasticsearch bundles Lucene.
- **Attached** (paired, *hyper-optimized*) — CuttleSearch points at an
  existing CuttleDB; CuttleDB governs surfacing and, when co-located in
  the same process, queries take the in-process fast path (~5μs/op) with
  no socket. Standalone always works; pairing is a superpower, never a
  requirement.

```
Lucene        : Elasticsearch   ::   CuttleDB : CuttleSearch
(retrieval)     (search server)       (retrieval)  (search server)
```

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

- **Own binary, not a mode-flag.** Ships as `cuttlesearch.exe` +
  `.obin` (same `cuttledb-server` engine as CuttleDB, search logic in
  OctoASM/OctoFlow), <1 MB, copy-and-run. Standalone identity gets its
  own front door. Also builds to WASM for embedded/browser.
- **Bundled substrate = internal build (embedded) / public CuttleDB
  (attached).** Embedded mode bundles the same closed CuttleDB engine core
  CuttleDB ships; attached mode speaks to a public CuttleDB over the
  wire. Both exist; embedded is the default.
