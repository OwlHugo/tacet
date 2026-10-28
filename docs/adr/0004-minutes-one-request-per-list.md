# 0004. One request per list, then a check per decision and per deadline

Date: 2026-10-27

Supersedes the request layout of [0002](0002-minutes-in-two-requests.md); its seed and its rule of
never filling an empty part stay.

## Context

On real recordings of one mixed track (an imported file, everyone on it), `qwen2.5:7b` asked for the
summary and the decisions together on 9000 characters of transcript lost the main subject, left the
decisions empty, took a sarcastic remark for a decision and gave a deadline said about one piece of
work to another task. Grounding cannot see any of that: the words were said.

Those recordings stay off the repository. They are scored outside it with the same eval
(`TACET_EVAL_CASES`) against a written answer key (subject, decisions, tasks).

## Decision

- Three requests per chunk, one per list: `summary`, `decisions`, `tasks`. The summary and the
  decisions are asked on chunks of 4000 characters; the tasks keep 9000, so a reply that gives a
  deadline stays with its task.
- The decision prompt carries an invented example where a question, sarcasm and small talk are not
  decisions.
- Each decision is then confirmed in its own request on its source lines and two lines around them
  (`confirm`: what kind of talk this is, and was it settled). Tasks are not: asked about one line,
  the model called a plain request "other" and dropped real tasks.
- Each deadline is checked in its own request (`deadline`: is it a time, said for this task). A
  refused one is cut from the task's wording too.
- Grounding drops a deadline said on a line that names other work, unless the line is a short reply.
- What the checks drop is listed in `rejected`, like what grounding drops.
- The Ollama context is 8192, enough for the longest prompt plus a chunk, and light enough for a
  16 GB laptop.

## Consequences

On the four private one-track calls the main subject went from 2 to 3 of 4, decisions found went
from 3 of 16 to 7 of 16, and no deadline lands on the wrong task (one did before). It is not all
gain: tasks found went from 11 to 10 of 12, and items that match nothing in the answer key from 5
to 8, most of them small talk or a sarcastic remark taken as a task, which the task prompt does not
check. Decisions right on 3 of 4 calls is still not reached. On the versioned cases nothing moved: 8/11 deadlines, 92.9% of the expected
tasks, every injected item rejected. Writing minutes takes more requests: about one more per
decision and per deadline.
