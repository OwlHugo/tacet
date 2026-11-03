<p align="center">
  <img src="docs/icon.png" width="88" alt="" />
</p>

<h1 align="center">Tacet</h1>

<p align="center">
  Meeting notes that never leave your computer.<br/>
  Records your mic and the call audio, transcribes with whisper.cpp, writes the minutes with a local LLM.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-8B7CF6" alt="MIT" />
  <img src="https://img.shields.io/badge/macOS%20Apple%20Silicon-0E0F14" alt="macOS Apple Silicon" />
</p>

<p align="center">
  <a href="README.pt-BR.md">Português</a> · English
</p>

<p align="center">
  <img src="docs/demo-en.gif" width="860" alt="Tacet recording a one-minute planning call, then the minutes with two decisions and three tasks with owners and deadlines, and a click on a task that jumps to its line in the transcript" />
  <br/>
  <sub>A made-up one-minute call with synthetic voices, recorded on a MacBook Pro M4. The call plays at 1.5× and the wait for whisper.cpp and the local LLM (about 40 s) is cut to 6 s. With sound: <a href="docs/demo-en.mp4">docs/demo-en.mp4</a>. In Portuguese: <a href="docs/demo-pt.mp4">docs/demo-pt.mp4</a>.</sub>
</p>

## Install

Tacet needs two programs that run on your machine: whisper.cpp for the transcript and Ollama for
the minutes. On macOS with [Homebrew](https://brew.sh):

```bash
brew install whisper-cpp ffmpeg     # whisper-cli, and ffmpeg for .m4a / .mp3
brew install ollama                 # or the app from https://ollama.com/download
ollama serve &                      # skip if the Ollama app is running
ollama pull qwen2.5:7b              # 4.7 GB, runs on a 16 GB Mac
```

On Linux, build [whisper.cpp](https://github.com/ggml-org/whisper.cpp#quick-start) and put
`whisper-cli` on your `PATH` (or set `TACET_WHISPER_BIN`), install ffmpeg from your package manager
and Ollama with `curl -fsSL https://ollama.com/install.sh | sh`. Without Ollama, Tacet still saves
the transcript, only without minutes.

Tacet uses the best whisper model already in `~/.cache/whisper` (`large-v3-turbo`, then `small`,
`base`, `tiny`); with none there, the first run downloads `base` (142 MB) from Hugging Face. You can
pick another in Settings or with `-m`.

**Desktop app (macOS, Apple Silicon).** Download `Tacet-0.1.0-mac-arm64.dmg` from
[Releases](https://github.com/OwlHugo/tacet/releases) and drag Tacet to Applications. Tacet lives in
the menu bar.

> **The app is not signed by Apple.** The .dmg has an ad-hoc signature and is not notarized, so the
> first launch says Tacet "cannot be opened" or "is damaged". To open it, right-click Tacet in
> Applications → Open → Open (on macOS 15 and later: try once, then System Settings → Privacy &
> Security → Open Anyway). Or clear the quarantine flag in Terminal:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Tacet.app
> ```

**CLI (macOS, Linux; Node 22.18+).** The package is `@hugoowl/tacet` (npm refused the bare name as too
close to existing ones); the command is still `tacet`.

```bash
npm install -g @hugoowl/tacet
tacet doctor                        # checks whisper.cpp, ffmpeg, the model and Ollama
tacet transcribe meeting.m4a
```

**From source** (any platform, Node 24.12+ and pnpm 10):

```bash
git clone https://github.com/OwlHugo/tacet && cd tacet
pnpm install
pnpm tacet doctor
pnpm desktop                        # the app in dev mode
pnpm dist:mac                       # build the .dmg into apps/desktop/release
```

Windows and Linux desktop builds (`pnpm dist`) are configured but not tested or published yet.

## Your data stays on your machine

**Nothing leaves your computer.** No account, no server, no telemetry, no analytics.

- Audio is recorded to a local folder and transcribed by a whisper.cpp process on your CPU or GPU.
- Minutes are written by Ollama on `localhost`. The core refuses any Ollama host that is not loopback (`127.0.0.1`, `localhost`, `::1`), so a misconfigured `OLLAMA_HOST` cannot send a transcript to another machine. See [`ollama.ts`](packages/core/src/ollama/ollama.ts).
- The only network request Tacet ever makes is the one-time download of public model weights from Hugging Face. It sends nothing about you or your meetings. Put the `.bin` in `~/.cache/whisper` (or set `TACET_MODELS_DIR`) and Tacet never goes online at all.
- Notes are plain Markdown files in a folder you choose. Delete them and they are gone.

## Why

Granola, Otter and Fireflies are good products, but they upload every word of your meetings to someone else's servers. For a lot of people that is a deal breaker: client calls under NDA, health, legal, HR, anything in the EU.

The pieces to do this locally now exist and are fast. whisper.cpp transcribes a minute of audio in about 2 seconds on an M4, and a 7B model on Ollama writes good minutes. What was missing was the glue: capturing the call audio without installing a virtual audio driver, keeping "who said what" without diarization models, and making the LLM output trustworthy.

That last part is the one Tacet takes seriously. **If it is not in the transcript, it is not in the minutes.**

## What it does

- **Two tracks, no driver.** Your microphone and the system audio are recorded as separate files. System audio uses Chromium's loopback capture: ScreenCaptureKit on macOS 13+, WASAPI on Windows, the PulseAudio/PipeWire monitor on Linux. No BlackHole, no Loopback.app.
- **Me / Others.** Each track is transcribed separately, so speaker labels come for free. Mic echo of the speakers is detected and removed when you are not using headphones.
- **Timestamps you can trust.** Whisper's timestamps drift on tracks that are mostly silence. Tacet snaps each segment to the speech it actually covers, getting the error down from seconds to about 10 ms on the scripted cases (see the eval). On the 2.5 minute call (case 05) it is still about 6 s: whisper glues a line to the one before it, and a short reply ("Isso.") lands on the wrong segment (see Known limitations).
- **One request per part, each checked.** The summary, the decisions and the tasks are asked apart, so a small model looks at one thing at a time. Each decision is then confirmed on its own lines (a question, a joke or a complaint is not a decision), and each deadline is checked to be a time said for its task.
- **Grounded minutes.** Summary, decisions and action items with owners and deadlines. Every item cites transcript line ids and quotes the line. A deterministic check then drops anything whose quote is not in the transcript, any owner whose name was never said (except yours when you set it: on a recording your work goes to your "Me" track, and on an imported file work asked of "you" is yours, see *Who you are*), any deadline not said word for word on a line that only this task stands on and that names at most one of the owners the model gave (a missing deadline is preferred to a wrong one; a second person the model left out is not seen, see Known limitations), and any task whose wording is not supported by its source. Timestamps come from the transcript, never from the model.
- **Obsidian-ready Markdown.** YAML frontmatter, a `^t0003` block id on every transcript line, and every minutes item links to its line: `[[#^t0003|00:14]]`.
- **Search** across every meeting (titles, minutes, transcripts), accent and case insensitive.
- **Global shortcut** `⌘⇧M` / `Ctrl+Shift+M` to start and stop from anywhere.
- **Import audio.** Drop a `.wav`, `.m4a` or `.mp3` on the window (or use *Import audio*) to run the same pipeline on a recording you already have. No microphone or screen permission needed. An imported file is one mixed track, so lines are labelled "Speaker" and tasks only get an owner whose name was said, or you when the line asks it of you (see *Who you are*).
- **Who you are.** Set your name and nicknames in Settings (or `--me`, `--alias` in the CLI). On a recording, work given to you lands on your "Me" track; on an imported file it gets your name when one of your names was said or the line asks it of "you" ("can you…?", "please…"). A "you" that is not a request ("thank you", "I'll send you the deck") gives you nothing.
- **Your vocabulary.** List the names and terms you expect in Settings (or `--vocab words.txt`), and whisper.cpp spells them your way. The list stays on your machine.

## Eval

`pnpm eval:sem-ia` replays the recorded outputs and is one of the gates (`./scripts/verificar.sh`, and [`ci.yml`](.github/workflows/ci.yml) for macOS, Windows and Linux runners). The dataset is three synthetic two-track meetings (two in English, one in Brazilian Portuguese) generated with `say` from scripts with known text, timing and expected action items ([`evals/scripts.json`](evals/scripts.json)), a one-track sprint meeting as an imported file ([`04-sprint-import-en`](evals/cases/04-sprint-import-en/case.json)), where no line says who spoke, a 2.5 minute Portuguese sprint planning between three people with neural voices ([`05-sprint-pix-pt`](evals/cases/05-sprint-pix-pt/case.json)), two two-track calls recorded by someone who set their name, scored for who owns each task ([`06-bakery-self-en`](evals/cases/06-bakery-self-en/case.json), and [`07-print-shop-self-en`](evals/cases/07-print-shop-self-en/case.json), where the model writes that person's name as the owner and the minutes must say "Me"), and a 12.7 minute Portuguese call between three people that spans four summary chunks ([`08-agendamento-longo-pt`](evals/cases/08-agendamento-longo-pt/case.json), MP3 tracks to keep the repository small), with an answer key for the summary too. A task whose owner the answer key does not allow fails the eval.

One run on a MacBook Pro M4, whisper `base`, `qwen2.5:7b` on Ollama (the minutes move a little from run to run, see below):

| Case | Audio | WER | Speaker attribution | Timestamp error | Transcribe (s / audio min) | Minutes (s / audio min) | Grounded items | Expected tasks found | Deadlines right |
|---|---|---|---|---|---|---|---|---|---|
| 01-launch-sync-en | 30.2s | 1.2% | 100.0% | 0.01s | 2.04 | 70.23 | 9/9 | 3/3 | 2/3 |
| 02-hiring-en | 19.4s | 3.4% | 100.0% | 0.00s | 2.87 | 52.74 | 6/6 | 2/2 | 1/1 |
| 03-planejamento-pt | 22.7s | 15.1% | 100.0% | 0.01s | 2.36 | 51.51 | 6/6 | 1/2 | 1/1 |
| 04-sprint-import-en | 65.9s | 4.1% | – | 0.02s | 1.30 | 34.04 | 9/9 | 3/3 | 2/2 |
| 05-sprint-pix-pt | 151.8s | 15.0% | 89.3% | 5.92s | 1.44 | 28.68 | 13/13 | 4/4 | 2/4 |
| 06-bakery-self-en | 28.8s | 0.0% | 100.0% | 0.03s | 2.48 | 86.79 | 11/11 | 3/3 | 2/2 |
| 07-print-shop-self-en | 28.6s | 6.5% | 100.0% | 0.01s | 2.34 | 58.20 | 7/7 | 3/3 | 2/2 |
| 08-agendamento-longo-pt | 760.7s | 10.8% | 99.2% | 0.12s | 1.35 | 18.83 | 33/33 | 7/7 | 2/3 |
| **Total** | 1108.1s | 10.3% | | | 1.48 | 26.53 | 94/94 | 96.3% | 14/18 |

Hallucination guard: **106/106** fabricated items rejected (four made-up items citing real line ids are injected into every case, and every real task with a deadline is attacked three ways: a deadline nobody said, a deadline said for another task, both in the field and in the task's wording, and a second task citing the same line).

With `large-v3-turbo` (the default when it is downloaded), the WER drops to **6.5%** overall (0.0% / 3.4% / 5.7% / 3.5% / 9.6%) at 10.9 s per audio minute. That figure was measured with the minutes written in two requests (before [ADR 0004](docs/adr/0004-minutes-one-request-per-list.md)); the minutes columns above are the current pipeline.

The minutes are written one request per list (summary, decisions, tasks), then each decision and each deadline is checked on its own lines ([ADR 0004](docs/adr/0004-minutes-one-request-per-list.md)). This was tuned on real one-track calls that stay off this repository and are scored the same way against a written answer key.

### Reliability

One run says little about a 7B model: two recordings of the same call never give the same transcript, and the minutes move with it. `pnpm eval:confiabilidade` records every case 8 times with what a real capture changes (offset between the tracks, gain, background noise), transcribes each with whisper `base` and `large-v3-turbo` and counts how often each part of the minutes comes out. 80 runs, measured when the minutes were written in two requests (summary and decisions, then tasks; see [ADR 0002](docs/adr/0002-minutes-in-two-requests.md)); not yet re-run with one request per list:

| | Summary | Decisions | All expected tasks | Deadlines right | Wrong deadlines |
|---|---|---|---|---|---|
| One request | 96% | 96% | 65% | 59% | 1 |
| Two requests | **100%** | **100%** | **89%** | **74%** | 0 |

Measured before the demo case's "terça" deadline became optional; see the ADR.

What the columns mean:

- **WER**: word error rate per track against the script, pooled over all words.
- **Speaker attribution**: share of script lines that land on the right track (two-track cases only; the one-track import has nothing to attribute).
- **Timestamp error**: mean distance between when a line was spoken and the start of the segment holding it.
- **Grounded items**: summary points, decisions and action items that cite real lines and carry the timestamp of the first cited line; a decision's or task's quote must be found there, and a third of a summary point's words in those lines or the next ones; a task's owner must be a track of that meeting, a name that was said, your own name on a one-track file when the case sets one (`--me`), or nobody. Checked by an independent function ([`grounding.ts`](evals/metrics/grounding.ts)), separate from the guard that filters the output; for summary points it uses the guard's own one-third rule, so there it mostly checks the line ids and timestamps. CI fails if any item is ungrounded or any injected item survives.
- **Deadlines right**: deadlines said in the script that reach the right task, in the words that were said. A task carrying a deadline other than the one said, or one the script gives no deadline, fails the eval; a missing one only lowers this count.
- **Expected tasks found**: recall of the action items written in the script. The miss in the Portuguese case is on purpose kept visible: whisper `base` heard "como fornecedor" as "como for necedor", and Tacet would rather drop a task than write one the transcript does not say.

In CI, transcription runs for real on all three runners. The whisper and LLM outputs are recorded locally (`pnpm eval:gravar`) and replayed in CI, since GitHub runners have no GPU for a 7B model; the grounding checks run on those outputs every time.

```bash
pnpm eval:sem-ia             # replay the recorded outputs (what CI runs on every PR)
pnpm eval                    # real whisper.cpp + Ollama on this machine
pnpm eval:gravar             # same, and re-record evals/cases/*/fixture.json
pnpm eval:confiabilidade --whisper base,large-v3-turbo   # 8 recordings of each case (about 40 min)
node evals/gerar-audio.ts    # regenerate the audio (macOS, uses `say`)
```

## Architecture

```
apps/desktop  Electron tray app (React + Vite)
  main        tray, global shortcut, IPC, setDisplayMediaRequestHandler → audio: 'loopback'
  recorder    hidden window: getUserMedia (mic) + getDisplayMedia (system) → AudioWorklet
              → 16 kHz mono PCM → main process → one WAV per track
  renderer    meeting list, search, minutes next to the transcript

apps/cli      `tacet transcribe | search | list | doctor`

packages/core TypeScript, no Electron (@tacet/core, a workspace package bundled into the CLI)
  transcript  merge tracks into one timeline, drop mic echo           (pure)
  minutes     prompt, groundMinutes(): drop what is not said          (pure)
  meeting     processMeeting(), Obsidian Markdown, search             (pure)
  whisper     whisper.cpp adapter: spawn per track, snap to speech    (I/O)
  ollama      Ollama adapter: schema per request, loopback only       (I/O)
  library     folder of .md + .tacet/*.json                           (I/O)

evals         WER, attribution, timestamp error, grounding check, hallucination guard
```

Ports are plain function types (`TranscribeTrack`, `GenerateRawMinutes`), passed in as
parameters: whisper.cpp and Ollama in the apps, fakes in the tests. `scripts/arquitetura.ts`
fails CI if a pure module imports I/O or an adapter, or if there is an import cycle.

```
 mic ──► me.wav ─────┐                         ┌──► summary   [[#^t0001|00:04]]
                      ├─► whisper.cpp ─► merge ─┤
 system ► others.wav ─┘   (per track)   + snap  └──► Ollama ─► ground ─► decisions, tasks
                                                     (JSON)    (drop what is not said)
```

Using the core from your own code, inside this workspace (it is not published to npm on its own):

```ts
import { ensureModel, MeetingLibrary, ollamaMinutes, processMeeting, whisperTranscriber } from '@tacet/core'

const meeting = await processMeeting(
  {
    id: crypto.randomUUID(),
    title: 'Weekly sync',
    date: new Date(),
    tracks: [
      { path: 'me.wav', speaker: 'Me' },
      { path: 'others.wav', speaker: 'Others' },
    ],
  },
  {
    transcribeTrack: whisperTranscriber({
      bin: '/opt/homebrew/bin/whisper-cli',
      model: await ensureModel('large-v3-turbo', `${process.env.HOME}/.cache/whisper`),
      language: 'en',
      vocabulary: [],
      env: process.env,
    }),
    whisperModel: 'large-v3-turbo',
    minutes: { generate: ollamaMinutes({ host: '127.0.0.1:11434', model: 'qwen2.5:7b' }), model: 'qwen2.5:7b' },
    now: () => performance.now(),
  },
)
new MeetingLibrary(`${process.env.HOME}/Obsidian/Meetings`).save(meeting)
```

## CLI

```
tacet transcribe <audio...>        one file, or --mic me.wav --system them.wav, or file.wav:Name
  -m, --model tiny|base|small|large-v3-turbo|path.bin   (default: best one downloaded)
  -l, --language en|pt|...|auto
  --llm qwen2.5:7b   --no-minutes   -t "Title"   -o ~/notes   --json
  --vocab words.txt  names and terms whisper should expect, one per line (passed as its prompt)
  --me Ana --alias Aninha   who you are: on --mic/--system your tasks go to Me;
                            on a one-track file, work asked of you gets your name
tacet search "pricing page" [--dir ~/notes]
tacet list [--dir ~/notes]
tacet doctor
```

## Permissions

- **macOS**: Microphone, and Screen & System Audio Recording (System Settings → Privacy & Security). Screen capture is only used to get the system audio; the video track is stopped the moment it starts and never saved.
- **Windows**: microphone access in Settings → Privacy. System audio needs nothing.
- **Linux**: PulseAudio or PipeWire with `pipewire-pulse`. Tacet records the "Monitor of …" source of your output device.

## Known limitations (v0.1)

- **Summary and decisions on long calls.** The summary and decisions are asked on chunks of about 4000 characters ([ADR 0004](docs/adr/0004-minutes-one-request-per-list.md)), and a summary point another chunk already gave in the same words is dropped ([ADR 0005](docs/adr/0005-long-call-summary-deduplicated.md)). A chunk that says the main subject again in other words, or with one word changed, still adds it, so a 30-minute call can show more than one "main subject".
- **Timestamps on long, fast calls.** whisper sometimes glues a line to the one before it on the same track, and that line loses its own start (about 6 s mean error on case 05, against 10 ms on the scripted cases).
- **A deadline on a line that names two people.** "Ana reviews the contract and Pedro deploys by Friday": if the model returns only Ana's task, she can get Pedro's deadline. Deadlines are otherwise kept only on a line that a single task stands on.
- **Your tasks on an imported file.** With `--me`, a task the model gives you on a one-track file stays yours only when one of your names was said or the line asks it of "you" in a known form ("can you send…", "please…", "você pode revisar…", "pode mandar…?") and the request names some of the task's words. A request said to someone else by name ("Bia, can you…", "Can you send it, Bia?") is not yours, a request whisper wrote without its "?" ("pode mandar o contrato.") is not read as one, and anything else stays Unassigned: a missing owner is preferred to a wrong one.
- **A deadline in a reply.** A reply's deadline goes to the task asked just before only when the reply adds nothing else and says no "no": it agrees ("Great, by Friday"), or it takes the work on with no other word ("Consigo entregar até sexta"). Any other word may be other work, so "Sure, I'll deploy by Friday" or "Beleza, o deploy até sexta" after another task loses the deadline, even when the deploy is that task said in other words, and "No, not by Friday" keeps no deadline.
- **Only macOS Apple Silicon is built and tested.** The Windows and Linux paths (WASAPI and PulseAudio loopback, bundled whisper.cpp) are written but not tried on a real machine.
- macOS builds are signed ad-hoc, not notarized: the first launch needs right-click → Open, or System Settings → Privacy & Security → Open Anyway on macOS 15 and later, or `xattr -dr com.apple.quarantine /Applications/Tacet.app` (see Install). Local builds keep the identifier `dev.tacet.app`, so permissions granted once survive rebuilds.
- On macOS 14.2+ Electron can use either ScreenCaptureKit or the Core Audio tap for loopback. Tacet uses ScreenCaptureKit by default (it only needs the Screen Recording permission). Set `TACET_CATAP=1` to try the Core Audio tap, which only works from the packaged `.app`.
- If recording or playback hangs on macOS, Core Audio is wedged: `sudo killall coreaudiod` fixes it.

## Development

```bash
pnpm install && pnpm check      # what CI runs: lint, types, architecture, knip, tests, eval
./scripts/verificar.sh          # the same gates plus the build, stopping at the first failure
pnpm tacet transcribe x.wav     # the CLI straight from source (Node runs the .ts directly)
pnpm desktop                    # Electron in dev mode
pnpm e2e                        # records 60 s through the real app, runs the whole pipeline, checks the WAV length
pnpm dist:mac                   # .dmg for Apple Silicon into apps/desktop/release
```

Node 24.12+ and pnpm 10 for development. The published CLI and core run on Node 22.18+.
Rules for contributors and coding agents: [AGENTS.md](AGENTS.md).

## Roadmap

- Live transcript while recording
- Real diarization inside the "Others" track
- Calendar integration to name meetings
- Notarized macOS build and auto-update
- Larger eval set with real, consented recordings

## License

MIT
