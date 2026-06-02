# CuttleSearch — embeddable WASM search

Run ranked **BM25 search entirely in-process** — no server, no socket, no
install. The CuttleDB engine is compiled to WebAssembly; you load a pre-built
index snapshot and query it through the engine's in-process entry point.

Works in **Node and the browser** from the same files.

## Files

| File | What it is |
|------|------------|
| `cuttledb-engine.wasm` | The CuttleDB engine compiled to WebAssembly (~350 KB). |
| `cuttledb-engine.js` | Emscripten loader glue (ES module). |
| `cuttlesearch.mjs` | The embed layer — a small `CuttleSearch` class over the engine. |
| `demo.mjs` | Node demo: load the bundled snapshot and search it. |

## Quick start (Node)

```bash
node demo.mjs                      # query "fox river" over the bundled index
node demo.mjs "quantum cryptography"
```

```
query: "fox river"

  1. row 1  score 1.7509
  2. row 0  score 0.8288
  3. row 4  score 0.8288
```

## API

```js
import { CuttleSearch } from "./cuttlesearch.mjs";

const cs  = await CuttleSearch.create();          // boot the engine
const hid = await cs.loadSnapshot(snapshotBytes); // Uint8Array of an index.snap
const hits = cs.search(hid, "fox river");         // [{ id, score }, ...]
cs.close(hid);
```

- **`CuttleSearch.create(opts?)`** — boot the engine. `opts` is forwarded to
  the Emscripten module factory (e.g. `{ locateFile }` to host the `.wasm`
  somewhere non-default).
- **`loadSnapshot(bytes, name?)`** — mount a snapshot into the engine's virtual
  FS and `LOAD` it. `bytes` is the raw contents of an `index.snap`. Returns the
  handle id.
- **`search(hid, query, { tid = 0, col = 0, k = 5 })`** — ranked BM25 search.
  Returns `[{ id, score }]`, highest score first. `tid`/`col` default to the
  bundled demo index (table 0, text column 0). Point `col` at whichever column
  *your* index BM25-indexed.
- **`exec(line)`** — escape hatch: run one raw wire-protocol line and get the
  raw response string back (e.g. `cs.exec("INFO")`).
- **`close(hid)`** — release a handle.

## In the browser

Serve this folder over HTTP so `cuttledb-engine.wasm` is fetchable next to the
loader, then:

```html
<script type="module">
  import { CuttleSearch } from "./cuttlesearch.mjs";
  const cs  = await CuttleSearch.create();
  const buf = await (await fetch("./index.snap")).arrayBuffer();
  const hid = await cs.loadSnapshot(new Uint8Array(buf));
  console.log(cs.search(hid, "fox river"));
</script>
```

## The bundled demo index

`../server/index.snap` is a one-table `docs` index with a single
BM25-indexed text column `body` at col 0, holding five short documents. It is
the same snapshot the native server boots from — the embedded and server paths
share one engine and one index format.

## How it works

The engine exposes one in-process entry point, `cuttledb_exec_line`, that runs a
single wire-protocol line and writes the response into a caller-supplied buffer
— the same grammar the TCP server speaks (`OPEN`, `LOAD`, `LSEARCH`, …), minus
the socket. `cuttlesearch.mjs` is a thin wrapper that marshals strings across
the WASM boundary and parses the `+OK [id:score;…]` responses into objects.
