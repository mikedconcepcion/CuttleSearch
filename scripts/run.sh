#!/usr/bin/env bash
# Run CuttleSearch locally. Resolves the runtime from bin/ and execs the program
# from server/ so index.snap is found relative to it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$ROOT/bin/cuttledb-server"
[ -x "$ENGINE" ] || ENGINE="$ROOT/bin/cuttledb-server.exe"   # Windows/Git-Bash fallback

if [ ! -x "$ENGINE" ]; then
    echo "error: engine not found at $ROOT/bin/cuttledb-server[.exe]" >&2
    echo "       see bin/README.md for how to obtain the engine binary." >&2
    exit 1
fi

cd "$ROOT/server"
exec "$ENGINE" cuttlesearch.obin
