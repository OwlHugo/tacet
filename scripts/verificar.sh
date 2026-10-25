#!/usr/bin/env bash
# Quality gates, cheapest first. Run from the root: ./scripts/verificar.sh
# Same sequence as CI. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n▶ %s\n' "$1"; shift; "$@"; }

step "lint (biome)"            pnpm lint
step "types (tsc)"             pnpm typecheck
step "architecture"            pnpm arquitetura
step "dead code (knip)"        pnpm knip
step "tests + coverage"        pnpm test:cobertura
step "eval without AI"         pnpm eval:sem-ia
step "build"                   pnpm build

printf '\n✔ all gates passed\n'
