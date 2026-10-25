# Contributing

Thanks for helping. A few rules keep Tacet honest:

1. **Nothing leaves the machine.** No telemetry, no remote APIs. A PR that adds a network call other than model downloads will not be merged.
2. **Grounding is not optional.** Any change to the minutes prompt or the guard must keep `pnpm eval` green: every item grounded, every injected hallucination rejected. If you change the prompt, re-record the fixtures with `pnpm eval:record` and commit them.
3. **Core stays pure.** `packages/core` must not import Electron or anything that only runs in a browser.

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
pnpm eval
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(core): …`, `fix(desktop): …`).
