# Run CuttleSearch locally (Windows PowerShell). Resolves the runtime from bin/
# and execs the program from server/ so index.snap is found relative to it.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "bin\cuttledb-server.exe"
if (-not (Test-Path $engine)) { $engine = Join-Path $root "bin\cuttledb-server" }

if (-not (Test-Path $engine)) {
    Write-Error "engine not found at $root\bin\cuttledb-server[.exe] — see bin\README.md"
    exit 1
}

Set-Location (Join-Path $root "server")
& $engine "cuttlesearch.obin"
