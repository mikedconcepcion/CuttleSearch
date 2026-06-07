# Deploying CuttleSearch

CuttleSearch ships as a **copy-and-run** service: one engine binary plus one
assembled program. There is no install step, no package manager, no language
runtime to provision.

```
cuttledb-server         the zero-dependency engine (shared with CuttleDB)
cuttlesearch.obin       the assembled CuttleSearch program (the open product)
index.snap              the read-only search snapshot (operator-built, optional)
```

Run it:

```
cuttledb-server cuttlesearch.obin
# -> cuttlesearch: listening on http://0.0.0.0:8787
```

That is the whole service. Everything below is about putting it behind TLS,
keeping it alive, and fronting it at the edge.

---

## 1. What the service does (and does not) do

CuttleSearch is a **read-only** JSON search API. Every request only reads the
snapshot loaded at boot. There is no request path that writes the database,
writes the filesystem, or spawns a process. That property *is* the security
model — see [§6](#6-security-model). Endpoint contract: [docs/API.md](../docs/API.md).

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | none | liveness probe |
| `/search?q=` | GET, POST | edge (optional) | BM25 ranked search |
| `*` | OPTIONS | none | CORS preflight (`204`) |

Unsupported methods get `405` (`Allow: GET, POST, OPTIONS`); a supported method
on an unknown path gets `404`; an over-long request line gets `413`.

---

## 2. Building the index snapshot (offline)

The index is built **offline** and loaded **at boot** — never over the request
path. The same engine binary, run as `cuttledb-server --port`, is the ingest server:

```
ingest tooling  ->  CuttleDB wire server  ->  index.snap  ->  CuttleSearch LOADs it at boot
(your pipeline)     (cuttledb-server --port)   (snapshot)      (cuttledb-server cuttlesearch.obin)
```

The wire grammar is line-delimited TCP (`OPEN` → `CREATE` → `INSERT…` →
`SAVE <path>`). A minimal snapshot, built with `nc`:

```bash
cuttledb-server --port 7780 &            # ingest server on :7780
printf 'OPEN\nCREATE 0 docs body:STRING\nINSERT 0 0 the quick brown fox\nINSERT 0 0 lazy dog by the river\nSAVE 0 index.snap\nCLOSE 0\n' \
  | nc 127.0.0.1 7780
```

Ship the resulting `index.snap` next to `cuttlesearch.obin`. To update the
index, build a new snapshot and restart the service (or use blue/green, §5).

> The service boots without a snapshot — it logs a warning and answers every
> search with a structurally valid empty result (`"total":0,"hits":[]`). This
> keeps health checks green during a cold deploy.

---

## 3. Run it locally

```bash
scripts/run.sh            # Linux / macOS / Git-Bash
scripts/run.ps1           # Windows PowerShell
```

Both resolve the engine from `bin/`, `cd` into `server/`, and exec
`cuttledb-server cuttlesearch.obin` so `index.snap` is found relative to the program.

---

## 4. systemd (bare VPS)

Copy `cuttledb-server`, `cuttlesearch.obin`, and `index.snap` to
`/opt/cuttlesearch/`, then install
[`deploy/cuttlesearch.service`](cuttlesearch.service):

```bash
sudo install -d /opt/cuttlesearch
sudo install -m755 bin/cuttledb-server /opt/cuttlesearch/cuttledb-server
sudo install -m644 server/cuttlesearch.obin server/index.snap /opt/cuttlesearch/
sudo cp deploy/cuttlesearch.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cuttlesearch
```

The unit runs as a dedicated unprivileged user and locks the process down
(`ProtectSystem=strict`, `ReadOnlyPaths`, `NoNewPrivileges`) — defense in depth
on top of the application-level read-only guarantee.

---

## 5. Docker

[`deploy/Dockerfile`](Dockerfile) wraps the prebuilt Linux binary in a slim
base image — no compiler, no source, ~tens of MB:

```bash
# bin/cuttledb-server must be a LINUX build of the engine (see bin/README.md).
docker build -f deploy/Dockerfile -t cuttlesearch:0.9.0 .
docker run --rm -p 8787:8787 cuttlesearch:0.9.0
```

The image is read-only-friendly: run it with `--read-only --tmpfs /tmp` and the
service still works, because it never writes anything.

**Blue/green index update:** bake `index.snap` into the image (or mount it), and
roll a new image/container to swap the index with zero in-place mutation.

---

## 6. Edge: nginx + TLS + rate limit + optional API key

Terminate TLS, rate-limit, and (optionally) require an API key at the edge —
not in the binary. The binary stays minimal and read-only; the edge owns the
public-internet concerns. [`deploy/nginx.conf`](nginx.conf) is a ready template:

- **TLS** termination (point `ssl_certificate` at your certs / Let's Encrypt).
- **Rate limiting** via `limit_req` (per-IP token bucket).
- **Optional API key** — uncomment the `if ($http_authorization != ...)` gate,
  or front it with `auth_request`. The public read-only shape (Algolia-style)
  often ships *without* a key; enforce one here if you want quotas.
- **Body/timeout caps** and a clean `proxy_pass` to `127.0.0.1:8787`.

```
client ──TLS──> nginx (:443) ──plain──> cuttlesearch (127.0.0.1:8787)
                 rate limit, key, caps      read-only search
```

> **The edge is not optional for public exposure.** The engine accepts and
> serves connections **serially**, with **blocking reads and no socket
> timeout**. A single slow or stalled client (a slowloris-style trickle) holds
> the accept loop and starves every other request. nginx's
> `client_header_timeout`, `client_body_timeout`, `send_timeout`, and
> `limit_req` are therefore **mandatory** in front of a public deployment —
> they are what bound a connection's lifetime and keep one client from blocking
> the service. Do not expose the port directly.

Because the engine binds `0.0.0.0:8787` with no bind-address flag, restrict
reachability **at the host level** rather than in the binary: publish the port
to loopback only (`-p 127.0.0.1:8787:8787` in Docker, or keep it
container-internal), or firewall `8787` so only nginx can reach it. A reverse
proxy is where retries, timeouts, and abuse controls belong.

---

## 7. Cloudflare (optional, recommended)

CuttleSearch is a public read-only GET API, which is exactly what a CDN edge is
good at:

- **DNS proxy (orange cloud)** — hides origin IP, absorbs L3/L4 floods.
- **Cache** — `GET /search?q=` responses are cacheable by query (set
  `Cache-Control` at nginx for hot queries); `/health` should stay `no-store`.
- **WAF + rate limiting** — a second layer in front of nginx.
- **TLS** — Cloudflare ↔ origin can run Full (strict) with the nginx cert.

Cloudflare **Workers cannot run the native binary** — they run JS/WASM at the
edge. Use Cloudflare as a proxy/cache/WAF in front of an origin that runs the
binary (a VPS or container host). It is not a substitute for the origin.

---

## 8. Security model

The guarantee is **read-only by construction**, enforced in the runtime, not by
configuration:

- The search opcode hardcodes CuttleDB's `LSEARCH` verb in C. A request can
  never select a write verb (`INSERT`/`UPDATE`/`DELETE`/`SAVE`); the query is a
  sanitized bound parameter, never a command.
- The query is URL-decoded then stripped of control bytes, `"`, and `\` before
  it touches the engine or is reflected into JSON — no command injection (the
  wire protocol is newline-delimited and the term is CR/LF-free) and no JSON
  injection.
- The index is loaded once at boot from an operator-configured path. There is
  no request-driven `LOAD`, file write, or process spawn.
- Request-line length is capped (`413`); header drain is bounded.

Note this is a *confidentiality/integrity* guarantee, not an availability one:
the engine serves connections serially with blocking reads and no socket
timeout, so a slow client can stall it. Availability is the edge's job — see
the mandatory timeout/`limit_req` note in [§6](#6-edge-nginx--tls--rate-limit--optional-api-key).

Operational hardening to layer on top: run unprivileged (systemd/`USER` in
Docker), read-only root filesystem, restrict the port to loopback/proxy at the
host level behind nginx (the binary listens on `0.0.0.0:8787`), TLS at the
edge, rate-limit at the edge, and keep ingestion tooling off the public host.

---

## 9. Pre-deploy checklist

- [ ] `bin/cuttledb-server` is the correct platform build (Linux for the VPS/container).
- [ ] `index.snap` built offline and shipped next to the program (or accept the
      empty-result cold-boot behavior).
- [ ] Port `8787` **not** published to the public internet — loopback-only
      publish (`-p 127.0.0.1:8787:8787`), container-internal, or firewalled —
      and fronted by nginx with mandatory connection timeouts (§6).
- [ ] TLS terminated; HTTP→HTTPS redirect in place.
- [ ] Rate limit + (optional) API key configured at the edge.
- [ ] Runs as an unprivileged user with a read-only root filesystem.
- [ ] `/health` wired into the orchestrator/uptime check.
