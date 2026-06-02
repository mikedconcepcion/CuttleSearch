// CuttleSearch — embeddable WASM search.
//
// Runs the CuttleDB engine compiled to WebAssembly entirely in-process: no
// server, no socket, no install. You load a pre-built index snapshot (the
// same `index.snap` the native server boots from) and run ranked BM25 search
// over it through the engine's in-process wire entry point.
//
// Works in Node and the browser — the loader (cuttledb-engine.js) targets
// both. In the browser, serve this folder so cuttledb-engine.wasm is fetchable
// alongside the loader.
//
//   import { CuttleSearch } from "./cuttlesearch.mjs";
//   const cs = await CuttleSearch.create();
//   const hid = await cs.loadSnapshot(snapshotBytes);   // Uint8Array
//   const hits = cs.search(hid, "fox river");           // [{ id, score }, ...]
//
// The bundled demo index (server/index.snap) has one table `docs` with a
// single BM25-indexed text column `body` at col 0 — the defaults below.

import createCuttleDB from "./cuttledb-engine.js";

const OUT_CAP = 1 << 16; // 64 KiB response buffer, matches the wire send cap.

export class CuttleSearch {
  constructor(module) {
    this._m = module;
  }

  // Boot the engine. `opts` is forwarded to the Emscripten module factory
  // (e.g. { locateFile } if you host the .wasm somewhere non-default).
  static async create(opts = {}) {
    const module = await createCuttleDB({ noInitialRun: true, ...opts });
    return new CuttleSearch(module);
  }

  // Execute one wire-protocol line in-process. Returns the raw response
  // string (e.g. "+OK 0", "+OK [3:1.2040;7:0.8133]", "-ERR ...").
  exec(line) {
    const m = this._m;
    const outPtr = m._malloc(OUT_CAP);
    try {
      // The entry point returns the number of bytes written and does NOT
      // null-terminate, so bound the read by `n` — otherwise a reused buffer
      // leaks the tail of a longer prior response into this one.
      const n = m.ccall(
        "cuttledb_exec_line",
        "number",
        ["string", "number", "number"],
        [line, outPtr, OUT_CAP]
      );
      if (n <= 0) return "";
      return m.UTF8ToString(outPtr, n).replace(/\r?\n$/, "");
    } finally {
      m._free(outPtr);
    }
  }

  // Open an empty handle. Returns its numeric id.
  open() {
    return this._expectId(this.exec("OPEN"), "OPEN");
  }

  // Mount a snapshot into the engine's virtual FS and LOAD it into a fresh
  // handle. `bytes` is a Uint8Array (the contents of an index.snap). Returns
  // the handle id the snapshot was loaded into.
  loadSnapshot(bytes, name = "/index.snap") {
    this._m.FS.writeFile(name, bytes);
    return this._expectId(this.exec(`LOAD ${name}`), "LOAD");
  }

  // BM25 search over a loaded handle. Returns ranked [{ id, score }] (row id
  // and BM25 score, highest first). `tid`/`col` default to the bundled demo
  // index's schema (table 0, text column 0). Point `col` at whichever column
  // your own index BM25-indexed.
  search(hid, query, { tid = 0, col = 0, k = 5 } = {}) {
    const clean = String(query).replace(/[\r\n]+/g, " ").trim();
    const resp = this.exec(`LSEARCH ${hid} ${tid} ${col} ${k} ${clean}`);
    if (!resp.startsWith("+OK")) {
      throw new Error(`LSEARCH failed: ${resp}`);
    }
    return CuttleSearch._parseHits(resp);
  }

  // Release a handle.
  close(hid) {
    this.exec(`CLOSE ${hid}`);
  }

  // "+OK [3:1.2040;7:0.8133]" -> [{ id: 3, score: 1.204 }, ...]
  static _parseHits(resp) {
    const open = resp.indexOf("[");
    const end = resp.lastIndexOf("]");
    if (open < 0 || end <= open) return [];
    const body = resp.slice(open + 1, end);
    if (!body) return [];
    return body.split(";").map((pair) => {
      const [id, score] = pair.split(":");
      return { id: Number(id), score: Number(score) };
    });
  }

  _expectId(resp, what) {
    if (!resp.startsWith("+OK")) throw new Error(`${what} failed: ${resp}`);
    const id = Number(resp.slice(3).trim());
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`${what} returned no handle id: ${resp}`);
    }
    return id;
  }
}
