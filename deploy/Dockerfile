# CuttleSearch — copy-and-run container.
#
# No compiler, no source, no package manager: the image is just the prebuilt
# engine + the assembled program + the read-only snapshot. The engine is the
# closed CuttleDB engine core (see bin/README.md); CuttleSearch itself is the .obin.
#
#   bin/cuttledb-server  MUST be a LINUX (glibc) build of the engine for this image.
#
# Build context is the repo root:
#   docker build -f deploy/Dockerfile -t cuttlesearch:0.9.0 .
#   docker run --rm --read-only --tmpfs /tmp -p 8787:8787 cuttlesearch:0.9.0

FROM debian:bookworm-slim

# Unprivileged runtime user — the service never needs root.
RUN useradd --system --no-create-home --uid 10001 cuttle

WORKDIR /opt/cuttlesearch

# The product: the engine + the assembled program.
COPY bin/cuttledb-server            ./cuttledb-server
COPY server/cuttlesearch.obin       ./cuttlesearch.obin

# index.snap is operator data (gitignored), so it is NOT baked in by default —
# mount it at runtime:
#     docker run -v ./index.snap:/opt/cuttlesearch/index.snap:ro ...
# The service boots without it (logs a warning, returns empty results), so the
# image builds from a fresh clone with no snapshot present. To bake a snapshot
# into an immutable image (blue/green index swaps), uncomment:
# COPY server/index.snap            ./index.snap

RUN chmod 0755 ./cuttledb-server && chown -R cuttle:cuttle /opt/cuttlesearch

USER cuttle
EXPOSE 8787

# Liveness: probe GET /health over bash's /dev/tcp — no curl/wget needed
# (debian ships bash). Verifies the service actually answers, not just that the
# binary exists.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8787 && printf "GET /health HTTP/1.0\r\n\r\n" >&3 && grep -q "\"status\":\"ok\"" <&3'

ENTRYPOINT ["/opt/cuttlesearch/cuttledb-server", "cuttlesearch.obin"]
