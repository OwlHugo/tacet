# Tacet: rules for agents and contributors

Local meeting transcriber (whisper.cpp + Ollama, Electron tray app, CLI). Nothing leaves the machine.

## Layout

- `packages/core`: the product logic, published as `@tacet/core`. Folders by feature:
  - pure: `transcript/`, `minutes/`, `matching/`, `meeting/`. No I/O, no adapters.
  - adapters: `whisper/`, `ollama/`, `audio/`, `library/`. Node I/O is allowed here.
  - `index.ts` is the public API. `browser.ts` is the only entry the renderer may import.
- `apps/cli`: `tacet` binary. `config.ts` is the only reader of `process.env`.
- `apps/desktop`: Electron. `src/main` (Node), `src/preload` (bridge), `src/renderer` (React,
  DOM), `src/shared/contract.ts` (IPC schemas). Three tsconfig targets.
- `evals`: cases, metrics and `rodar.ts`. `fixture.json` per case is the recorded whisper + LLM
  output that `eval:sem-ia` replays.

`scripts/arquitetura.ts` enforces these boundaries and fails on import cycles.

## Rules

- TypeScript strict per `tsconfig.base.json`, ESM only, relative imports end in `.ts`. No `enum`,
  no `any`, no `!`.
- zod at every edge: env (`config.ts`), CLI argv, IPC arguments, JSON read from disk, whisper.cpp
  output, Ollama answers. Types come from `z.infer`. Inside, trust the types: no `?? ''` or
  `if (!x) return` for cases the types rule out.
- Errors propagate to the edge that knows what to do (CLI prints and exits 1, IPC rejects, the
  desktop pipeline shows the message). No defensive try/catch. Wrap with `new Error(msg, { cause })`.
- Dependencies are injected as parameters (`processMeeting(input, { transcribeTrack, minutes })`).
  Composition happens in `apps/*/main.ts`. Tests pass fakes, not `vi.mock`.
- Ports exist only where there is a real swap: `TranscribeTrack` (whisper.cpp, fake) and
  `GenerateRawMinutes` (Ollama, fake).
- Minutes grounding is the product's promise: anything not traceable to the transcript is dropped,
  and timestamps come from the transcript. Changing the prompt or `minutes/ground.ts` means
  `pnpm eval:gravar` and committing the new `fixture.json` files.
- Electron: `contextIsolation`, `sandbox`, no `nodeIntegration`; renderer served from `tacet://app`;
  every `ipcMain` handler checks the sender frame and parses its arguments with the schema in
  `shared/contract.ts`; navigation and new windows are blocked; fuses off for `runAsNode` and
  `--inspect`.
- Child processes via `spawn(bin, [args])`, never a shell string.
- Network: only the loopback Ollama and the one-time model download. No telemetry, ever.
- Names: kebab-case files, PascalCase types, camelCase functions, UPPER_SNAKE module constants.
  No `utils.ts` / `helpers.ts`.
- Tests sit next to the code (`ground.ts` + `ground.test.ts`), integration through the public
  functions first.
- Conventional Commits, small, one subject each. Formatting (`pnpm format`) in its own commit.
- Do not commit generated files, reports, screenshots of a task, or anything from outside the
  product (personal tooling, prompts, review notes).

## Gates

Run from the root, in this order (`./scripts/verificar.sh` runs them all and stops at the first
failure; CI runs the same):

```bash
pnpm lint            # biome check .
pnpm typecheck       # tsc for every package and the three desktop targets
pnpm arquitetura     # layer boundaries and import cycles
pnpm knip            # dead files, exports and dependencies
pnpm test:cobertura  # vitest, coverage gate on packages/core (90% lines, 80% branches)
pnpm eval:sem-ia     # replayed fixtures: all items grounded, all injected hallucinations rejected
pnpm build           # tsdown for core and CLI, electron-vite for the desktop app
```

Also before delivering: `pnpm eval` (real whisper.cpp + Ollama on this machine) and the
end-to-end run `pnpm tacet transcribe --mic evals/cases/02-hiring-en/me.wav --system evals/cases/02-hiring-en/others.wav -l en`.

**No change is done until the maintainer's local QA gate (static analysis, secrets, audit, tests,
mutation testing on the changed lines, eval and end-to-end run) and the maintainer's independent
cross-review both pass.** Paste their output when you report.
