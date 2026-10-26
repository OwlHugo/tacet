# 0002. The minutes take two requests: overview, then tasks

Date: 2026-10-25

## Context

`qwen2.5:7b` wrote the whole minutes (summary, decisions, action items) in one structured-output
request. On a Portuguese sprint planning of 2.5 minutes (eval case `05-sprint-pix-pt`, synthetic
voices) it sometimes returned an empty summary and empty decisions while the tasks came out fine
(issue #3). Asking twice on the same transcript gives the same answer (temperature 0); what varies in
real use is the transcript, since no two recordings of a call are the same.

`pnpm eval:confiabilidade` measures that: each case is recorded 8 times with what a real capture
changes (offset between the tracks, gain, background noise), transcribed with whisper `base` and
`large-v3-turbo`, and written into minutes. 80 runs each, same cases and expectations:

| | Summary | Decisions | All expected tasks | Deadlines right | Wrong deadlines |
|---|---|---|---|---|---|
| One request (before) | 96% | 96% | 65% | 59% | 1 |
| Two requests | 100% | 100% | 89% | 74% | 0 |

The demo case with turbo, the setting of a real call, went from 5/8 to 8/8 runs with a summary.

## Decision

`generateMinutes` asks two requests per chunk, each with its own system prompt and its own JSON
schema in Ollama's `format`: `overview` (summary and decisions) and `tasks` (action items with owner
and deadline). Both answers are merged and grounded exactly as before. The adapter also passes a fixed
`seed` with `temperature: 0`, so one transcript always gets the same minutes.

No retry: an empty part is shown as such ("The local model wrote no summary for this meeting. The
transcript is complete."), never filled in.

## Consequences

Two shorter requests take longer than one: an eval run (transcription plus minutes) went from 17 s
to 23 s on average on an M4.
The task prompt can ask the model to go line by line without the summary competing for its attention,
which is where the recall of expected tasks came from.
