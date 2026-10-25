# Contributing

`pnpm install && pnpm check` is exactly what CI runs. The full rules and gates are in
[AGENTS.md](AGENTS.md); the short version:

1. **Nothing leaves the machine.** No telemetry, no remote APIs. A PR that adds a network call
   other than the model download will not be merged.
2. **Grounding is not optional.** Changes to the minutes prompt or guard must keep
   `pnpm eval:sem-ia` green: every item grounded, every injected hallucination rejected. Re-record
   the fixtures with `pnpm eval:gravar` and commit them.
3. **The core stays pure.** `packages/core` never imports Electron or browser-only code, and its
   pure features never do I/O. `pnpm arquitetura` checks it.

```bash
pnpm install
./scripts/verificar.sh   # lint, types, architecture, knip, tests + coverage, eval, build
pnpm eval                # with whisper.cpp + Ollama installed
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(core): …`,
`fix(desktop): …`).
