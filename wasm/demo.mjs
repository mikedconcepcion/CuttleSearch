// CuttleSearch WASM demo — runs ranked BM25 search fully in-process.
//
// No server, no socket, no install: load the bundled index snapshot and
// search it through the engine compiled to WebAssembly.
//
//   node demo.mjs
//   node demo.mjs "your query here"
//
// The bundled index (../server/index.snap) is a one-table `docs` index with
// a single BM25-indexed text column `body` at col 0 — the embed defaults.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CuttleSearch } from "./cuttlesearch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapPath = resolve(here, "../server/index.snap");
const query = process.argv[2] ?? "fox river";

const snap = await readFile(snapPath);
const cs = await CuttleSearch.create();
const hid = await cs.loadSnapshot(new Uint8Array(snap));

console.log(`index: ${snapPath}`);
console.log(`query: "${query}"\n`);

const hits = cs.search(hid, query);
if (hits.length === 0) {
  console.log("(no matches)");
} else {
  for (const [rank, hit] of hits.entries()) {
    console.log(`  ${rank + 1}. row ${hit.id}  score ${hit.score.toFixed(4)}`);
  }
}

cs.close(hid);
