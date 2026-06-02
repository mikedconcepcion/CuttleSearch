# Engine binary

CuttleSearch runs on **`cuttledb-server`**, a single zero-dependency engine
binary. It is the substrate the assembled program (`server/cuttlesearch.obin`)
executes on. Together they are the whole product — copy-and-run, no install, no
package manager, no language runtime.

```
cuttledb-server cuttlesearch.obin   ->  listening on http://0.0.0.0:8787
```

## Platform builds

The engine is shipped as a prebuilt binary per platform. It is **not committed
to this repo** — like CuttleDB, the binary is a release asset you drop into
`bin/` (see *Getting the binary* below):

| File | Platform | Used by |
|------|----------|---------|
| `cuttledb-server.exe` | Windows x64 | local dev (`scripts/run.ps1`, `scripts/run.sh`) |
| `cuttledb-server`     | Linux x64 (glibc) | Docker image, systemd on a VPS |

The engine has **no link-time dependencies** beyond the OS kernel, so the Linux
build runs on any modern glibc distro (debian-slim, ubuntu, alpine-glibc) with
nothing else installed.

## Provenance

The engine is not vendored as source into this repository — it ships as a
prebuilt artifact (the binary *is* the deliverable). `cuttlesearch.obin` is the
assembled program; it is committed and is reproducible from
`server/cuttlesearch.oasm` with the build toolchain (the toolchain itself is
not needed to run the product).

This is the **same engine CuttleDB ships** — `cuttledb-server` carries the
column store, the read-only retrieval opcodes (`db_load`, `db_search`,
`url_decode`), and the wire protocol that both products rely on. Because it is
one shared binary, CuttleSearch and CuttleDB move together on one version line
(both `0.8.0`).

## Getting the binary

The engine binary is **not committed to this repo** — it is the *same shared
binary* CuttleDB ships, so just download it from the CuttleDB release and drop
it into `bin/`:

> https://github.com/mikedconcepcion/CuttleDB/releases/latest

- `bin/cuttledb-server.exe` — Windows x64, for local dev
- `bin/cuttledb-server`     — Linux x64 (glibc), for `deploy/Dockerfile` / systemd

The release binaries are sigstore-signed (`.cosign.bundle` files attached to the
release); verify before use. Until the binary is present, `scripts/run.*` and the
container build fail at the missing-binary step (`COPY bin/cuttledb-server`) — by
design, so a mismatched-platform binary never ships silently. The v0.8.0 engine is
released once for both CuttleDB and CuttleSearch: one shared binary, one version line.

Nothing else needs to be checked in here — the assembled program
(`server/cuttlesearch.obin`) is committed and runs directly on the engine.
