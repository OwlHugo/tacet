# 0001. Default whisper model is the best one already downloaded

Date: 2026-10-25

## Context

The default model was `base`, for every user. Someone who already had `large-v3-turbo` in
`~/.cache/whisper` (for the CLI, another app or an earlier choice) still got `base` until they found
the setting. On Portuguese calls `base` writes "Quarto" for "quarta", and the minutes lose the
deadline. Settings were also saved whole, so the first change to any setting wrote `base` to disk as
if the user had chosen it.

## Decision

- The default model is the best one already on disk: `large-v3-turbo`, then `small`, `base`, `tiny`
  (`defaultModel` in `packages/core/src/whisper/models.ts`). With none there it stays `base`, which
  is downloaded on first use as before. Tacet never downloads a bigger model on its own.
- The desktop app saves only the settings that differ from the defaults, with `version: 2`. A file
  without a version comes from before this change: its `whisperModel` is ignored, because it was the
  old default written back, not a choice. Every other field in it is kept.
- The language default stays `auto`. Switching it to `pt` would break anyone who records in English.

## Consequences

A machine with the turbo model transcribes with it by default, slower (about 8 s per audio minute on
an M4 against 1.6 s with `base`, see the README eval) but with less than two thirds of the WER (3.1%
against 5.2%), and the Portuguese case finds both tasks. Someone who really wants `base` picks it in
Settings, and that choice is now saved as a choice.
