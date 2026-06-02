# CuttleSearch — Active GEO (live enrichment for LLM crawlers)

> Feature concept doc. Checkable against [DEFINITION.md](DEFINITION.md).
> **Active GEO is the first feature in CuttleSearch's agent-native mold —
> the product's chosen front door.** It is not a separate product and not
> a new protocol; it is CuttleSearch's existing search surface, exposed to
> visiting LLMs through two *existing* open standards.
>
> **Status: design only.** No Active-GEO code exists yet. The surfaces it
> composes do: the agent-native response shaping (ROADMAP §7) and the
> retrieval engine, proven on the internal bench harness. This doc says
> *what the feature is*, not how it's built — that comes after further
> discussion.

## One sentence

**Active GEO lets a website embed CuttleSearch and advertise a live,
owner-curated query endpoint that a visiting LLM can choose to call —
getting ranked, structured, sanctioned data instead of scraping and
guessing from HTML.**

## The gap it fills

GEO (Generative Engine Optimization) today is **passive**: you publish
content and hope an LLM crawls it, parses it correctly, and cites you.
You have no channel to *serve* the model clean data, and no say over what
it extracts. The model scrapes HTML, mis-parses your prices/specs, and
may hallucinate the rest.

Active GEO makes that channel **active**: the site offers the visiting
model a *better option than scraping* — a real search query against the
owner's own index, returning exactly the fields the owner chose to
expose. The model opts in; the owner stays in control.

The inversion is the whole idea:

```
Passive GEO :  LLM  ──scrapes──>  your HTML        (LLM in control, guesses)
Active  GEO :  LLM  ──queries──>  your CuttleSearch (owner in control, curated)
```

The site becomes the *retrieval server*. CuttleSearch is the engine the
site runs — not a crawler CuttleSearch operates.

## How it works — two existing standards, zero new protocols

We invent nothing on the wire. Active GEO rides two open standards and
puts CuttleSearch *behind* them:

| Layer | Standard | Who owns it | What CuttleSearch does |
|---|---|---|---|
| **Discovery** ("the billboard") | `llms.txt` | open (J. Howard) | emits one spec-legal `## Live data` section linking the endpoint + a short descriptor |
| **Transport** ("the pipe") | MCP / WebMCP | Anthropic / W3C | exposes its search surface as an MCP `search`/`fetch` tool any agent can call |

- **`llms.txt` is cold discovery.** A model landing on the site for the
  first time reads `/llms.txt` and learns a live endpoint exists — no
  prior configuration. MCP alone assumes the agent already knows the
  server; llms.txt is the part of the loop nobody has wired up.
- **MCP is the call.** The endpoint is a *compatible* MCP tool server, so
  any MCP-capable agent (Claude today, Chrome WebMCP next) uses it with
  zero special-casing. We are a **citizen** of MCP, not a competitor to
  it. We never ship "our own MCP."
- The MCP tool maps almost 1:1 onto CuttleSearch's agent-native surface
  (`depth=compass|snippets|bodies|synthesis`, ROADMAP §7): compact index
  first, expand on demand, the agent pays tokens only for what it opens.

## Why it's CuttleSearch and not a `SELECT`

MCP defines *how* the agent calls a tool. It says nothing about *what
comes back* or *how well it's ranked*. A naive site wires
`search(q) -> SELECT … LIKE '%q%'` and returns noise. Two things make the
answers worth calling — and both are CuttleSearch's, not the protocol's:

1. **Ranking quality — the bench is the argument.** Hybrid (lexical +
   vector + RRF) leads MRR/NDCG on the internal harness; the analyzer keeps
   structured tokens whole (`shard_fanout`, a file path, a version string)
   where underscore-splitting tokenizers shatter them and lose recall.
   That measured gap *is* the reason the tool's results beat a raw query.
2. **Curation — the owner decides what the model sees.** The endpoint
   never exposes the whole database. It serves a **sanctioned view**:
   - **CuttleDB backend:** field/row-level visibility governs public vs
     private natively (the paired "CuttleDB governs surfacing" mechanic,
     DEFINITION.md / ROADMAP §1).
   - **SQL backend:** a **read-only VIEW** is the sanctioned surface; the
     agent hits CuttleSearch's constrained query interface, which only
     reads the view. **The agent never sends raw SQL** (injection stays
     impossible — it can't reach anything the view doesn't expose).

Token savings come from **retrieval**, not HTML compression: a handful of
ranked, typed rows answer the query instead of the agent ingesting the
whole site's page set. (There is no HTML-compression step — Active GEO is
self-contained in CuttleSearch.)

## Backend-pluggable — SQL is the adoption face, CuttleDB the peer

Active GEO is a retrieval/ranking layer over a **pluggable backend**, in
keeping with CuttleSearch and CuttleDB being two standalone peer products
on independent timelines:

- **SQL (SQLite / Postgres) — the standalone / adoption face.** Point
  CuttleSearch at an existing DB, define a read-only VIEW as the agent
  surface, get an MCP endpoint + an `llms.txt` entry + good ranking in one
  install. No Cuttle component required. This is how a site that has never
  heard of CuttleDB adopts the feature.
- **CuttleDB — the co-optimized peer / optimized path.** When the data
  already lives in CuttleDB, curation is native (field/row visibility) and
  the in-process fast path applies. A superpower, **never a requirement**.

## What's ours vs. borrowed — the honest competitive line

MCP already enables "an agent queries a site." That capability is **not**
novel and we should never claim it is. After MCP eats the transport,
three things remain, in descending order of defensibility:

1. **Retrieval quality** at the structured-token niche (the bench).
2. **Curation** — exactly what the agent may see (view / visibility), and
   eventually **signed provenance** (the data is owner-authored, not
   scraped guesswork — the one differentiator genuinely hard to copy, and
   aligned with the "your data, your machine, opt-in" promise).
3. **Drop-in packaging** — one install over existing SQL, both faces (your
   app's HTTP API *and* the visiting agent's MCP tool) from one engine.

So the novelty is the **packaging and the quality**, not the protocol.
That is a feature, honestly scoped — exactly how the user framed it.

## Where it sits in the product

- **Front door of the agent-native wedge.** CuttleSearch wins by being
  the right *shape* for agent-native retrieval (a niche the heavyweight
  incumbents fit badly), not by out-featuring Elasticsearch. Active GEO is
  the most legible expression of that shape: agents query your data, you
  stay sovereign, you control what they see.
- **First of a family.** More agent-native features follow in the same
  mold; Active GEO is where the wedge becomes concrete and demoable.
- **Smallest demo.** A site serves `/llms.txt` advertising a live search
  endpoint; a visiting agent issues one query and receives a handful of
  curated, typed rows instead of scraping the full page set. The retrieval
  half is proven on the internal bench harness; Active GEO adds the
  llms.txt emitter + the MCP tool surface on top.

## Open (decide later, in discussion — not now)

- **Front door vs. second channel** — is Active GEO the headline reason to
  adopt CuttleSearch, or a surface a site already running CuttleSearch-
  over-SQL turns on later? Decides whether the llms.txt/MCP story leads
  the pitch or sits one slide back.
- **Beachhead** — e-commerce/shopping agents vs. enterprise/internal vs.
  dev-docs/coding agents. Settles the value-lead and demo scope.
- **Value lead** — publisher's (accurate LLM citations) vs. agent's (cheap
  clean data). Drives the `llms.txt` descriptor wording.
- **Signed provenance** — whether owner-signed enrichment becomes the
  durable moat, and what signs it.
