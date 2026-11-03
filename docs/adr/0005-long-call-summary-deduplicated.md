# 0005. A summary point another chunk already gave is dropped in grounding

Date: 2026-11-03

Builds on [0004](0004-minutes-one-request-per-list.md), which asks for the summary on chunks of
4000 characters.

## Context

Each chunk gives its own summary, and the prompt asks every one to open with the main subject. On a
long call the same subject can come back at the head of later chunks, and `groundSummary` kept every
point its lines support, so nothing dropped the repeats (issue #8). Decisions and tasks were already
deduplicated by word similarity in grounding (Jaccard of the content-word sets above 0.7); the
summary was not.

The issue left two options open: dedupe the points in grounding, or one last
short request that joins them. Both were built and measured on a new eval case,
[`08-agendamento-longo-pt`](../../evals/cases/08-agendamento-longo-pt/case.json): a 12.7 minute
invented call in Portuguese between three people about launching online booking at a vet clinic,
four summary chunks, with an answer key for the summary (the main subject and the six points a
person would write). It is a synthetic call with `say` voices, so it is easier than a real one.

On case 08 the chunks did not repeat the main subject: they opened with their own. Two variants of
its recorded points add what a chunk writes when it does. "Copied" puts the main subject at the
head of chunks 2 and 3 in about the same words ("Lançamento do agendamento online da clínica",
"Agendamento online na clínica, lançamento"); "reworded" puts it there in other words ("Recepção vê
os agendamentos do site na mesma agenda", "Agendamento online com consultas e vacinas, piloto no
centro"). The join was the real request to `qwen2.5:7b`. "Points with the subject" counts the
points that hold the answer key's subject words; one more than the main subject on case 08 is the
phone point, which names booking on the site.

| | Summary points | Points with the subject | Key points found |
|---|---|---|---|
| Case 08, as it was | 11 | 2 | 6/6 |
| Case 08, dedupe | 11 | 2 | 6/6 |
| Case 08, join, first version | 8 | 2 | 5/6 |
| Case 08, join, keeping the points it does not take in | 11 | 2 | 6/6 |
| Copied, as it was | 13 | 4 | 6/6 |
| Copied, dedupe | **11** | **2** | **6/6** |
| Copied, join | 9 | 2 | 6/6 |
| Reworded, as it was | 13 | 4 | 6/6 |
| Reworded, dedupe (also by word sets at 0.5; 12 and 3 at 0.2) | 13 | 4 | 6/6 |
| Reworded, join | 11 | 4 | 6/6 |

The join's first version took every point the model named as joined. The model names nearly every
point under the main subject, so the pilot unit was lost from the summary. Once the points it does
not take in stay, the join removed what dedupe removes, and the rest of its gain was folding three
different subjects into one point ("staffing on launch day and paying in advance, and promotion on
social media"). Neither joined the reworded repeats: they are on subjects of their own (the front
desk calendar, the pilot). The join also took one more request, a prompt that had to be argued out
of folding real subjects into the first point, and three rounds of word checks (how much of a joined
point its points say, a "not" it drops or adds, whose lines it takes) to keep it from writing what
nobody said.

## Decision

- `groundSummary` drops a point that says the same words as a point it already kept, in the same
  order, maybe starting at another word ("Lançamento do agendamento online na clínica" and
  "Agendamento online na clínica, lançamento"). Case, punctuation, articles and prepositions may
  differ; every other word, "não", "sem" and "no" included, must be there. A point with a "no"
  word ("não", "nem", "not", "never", the auxiliaries with "n't", "no", "sem", "without") must say
  it in the same place, so "X, not Y" turned around is not "X". The first one said stays, with its own lines.
- Not the word-set similarity decisions use. It was the first version here, and review found what
  it drops on a summary: a set has no order and "não", "no" and "can" are stopwords, so "O
  pagamento antecipado entra no piloto" and "... não entra no piloto", "Ship the beta" and "Can't
  ship the beta", "Divulgação nas redes" and "Sem divulgação nas redes", or two people swapping
  tasks were each one point, and the second, said later, was lost. Every patch for one of these
  (a list of "no" words, the words around them) left the next one open. On case 08 and its
  variants the exact rule drops the same points the similarity did.
- Decisions and tasks keep their dedupe as it was.
- No join request.
- [`evals/long-call.test.ts`](../../evals/long-call.test.ts) replays the "copied" variant on the
  recorded case 08 and checks that the summary comes out as it does without the repeats. The
  eval's independent grounding check now also checks each summary point against its lines.

## Consequences

A long call whose chunks open with the main subject again in the same words shows it once. On case
08, whose chunks did not, nothing changes. Nothing new can reach the minutes: dedupe only drops a
point that grounding already checked, and only when another kept point says the same thing.

It is not all gain. A main subject that a chunk says again in other words, or with one word
changed ("Lançamento do agendamento online" and "Lançamento do novo agendamento online"), still
shows twice: a longer summary is the price of never dropping a point that said something else.
Real calls are summarized by chunks that mostly lack the main subject rather than repeat it, and
neither option can add it. Decisions are asked per chunk with their old dedupe, which still takes a
decision and its "não" for one.
