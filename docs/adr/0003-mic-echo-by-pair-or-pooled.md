# 0003. A mic segment is an echo by pair or by the system pieces around it

Date: 2026-10-26

## Context

Without headphones the mic also records the speakers, so every line the others say can come back as
a "Me" segment. `mergeTracks` dropped a "Me" segment when one "Others" segment overlapped more than
0.3 of the shorter of the two and shared at least half of the content words (Jaccard). On a real
5.5-minute call where the person recording said nothing, 36 segments still came out as "Me", and the minutes gave a
task to "Me". whisper cuts the two tracks differently: the system track in short pieces, the mic in
one long line, so no single pair passed.

Measured on that call (171 segments) and on the five eval fixtures, for every "Me" segment:

- words: the share of its content words found in the "Others" segments that overlap it;
- time: the share of its duration the union of those segments covers, clipped to it.

| | Words | Time |
|---|---|---|
| The 30 echoes the pooled check finds on the call | 0.50 to 1.00 | 0.83 to 1.00 |
| An answer that repeats the question and touches its edge (Others 10-14 s, Me 13.8-15.0 s) | 1.00 | 0.17 |
| "Opa! Bom dia, pessoal!" in `05-sprint-pix-pt`, answered 1.4 s later | 0.50 | 0 |

Words alone drop that answer. Time alone cannot tell an echo from a real line said over someone
else. Pooling the words of segments up to 1.5 s around it (whisper's timing drift) found the same
echoes on the call, but then unrelated talk over the line could give the time while the answer right
after it gave the words, so only overlapping segments count.

## Decision

A "Me" segment is an echo when either holds:

- pair (the rule from before): one "Others" segment overlaps more than 0.3 of the shorter of the two
  and the Jaccard of their content words is at least 0.5. It catches a quiet mic line whisper
  stretched over the silence before it (a 1.02 s mic line against a 0.5 s system piece that
  says one of its two content words: only 0.35 of the mic line is covered);
- pooled: the "Others" segments that overlap it cover at least 0.5 of its duration and say at least
  0.5 of its content words.

On the call 6 "Me" segments are left out of 36 ("Tá.", "Show." and four lines whose words the system
track transcribed differently). The fixtures keep every "Me" segment, and `pnpm eval` gives the same
totals as before.

## Consequences

A short real answer that repeats one or two content words of a longer line the others are still
saying ("Sexta, combinado." inside "...o painel fica pra sexta, combinado?") is dropped. On the
call, 3 of the 30 echoes have that same shape (one or two content words, all of them in the
system line around it), so text and timing cannot keep one without the others. Telling them apart needs the
audio itself (how loud the line is on the mic against the system track), which is left for later.

With headphones there is no echo, and the rule only costs that case.
