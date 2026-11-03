# tacet

Local meeting transcription and grounded minutes from your terminal. whisper.cpp transcribes,
a local LLM on Ollama writes the minutes, and nothing leaves your machine.

Not on npm yet. Until it is, run it from a clone of the repository with `pnpm tacet <command>`
(see the [main README](https://github.com/OwlHugo/tacet#install)). Once published:

```bash
npm install -g tacet
tacet doctor
tacet transcribe meeting.m4a
tacet transcribe --mic me.wav --system others.wav -l en
```

Requirements:

- Node 22.18 or newer.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): `brew install whisper-cpp` on macOS. On
  Linux and Windows, build it or download a release and put `whisper-cli` on your `PATH` (or set
  `TACET_WHISPER_BIN`).
- [ffmpeg](https://ffmpeg.org) for `.m4a` and `.mp3`: `brew install ffmpeg`, `apt install ffmpeg`.
- [Ollama](https://ollama.com) for the minutes, with a model: `ollama pull qwen2.5:7b`. Without
  it, Tacet saves the transcript only.

Every item of the minutes cites the transcript lines it comes from; anything that cannot be traced
to the transcript is dropped. See the [project README](https://github.com/OwlHugo/tacet) for the
desktop app, the eval and the architecture.

MIT
