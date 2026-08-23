---
name: skillathon-jury
description: Organizer tooling for the GTM Skillathon. Pulls accepted submissions from GitHub at their exact commits, smoke-tests each seed prompt with codex exec, scores the automated criteria from RULES.md, draws the random presentation order, and builds the scoreboard, runbook, and on-screen board. Use when the organizer asks to pull, test, score, order, rank, or present submissions, or to close submissions at the cutoff.
---

# Jury

Run from the root of this repository. Every step is incremental and idempotent; rerun it as often as you like during the build window. Outputs land in `jury/`; working copies in `runs/<slug>/` (gitignored).

Requirements: `gh` logged in as an organizer, `codex` CLI logged in, Node 18+.

## Commands

| Step | Command | Produces |
| --- | --- | --- |
| Pull | `node .agents/skills/skillathon-jury/scripts/pull.mjs` | `runs/<slug>/repo` at the accepted SHA, `runs/<slug>/validate.json`, `jury/submissions.json` |
| Smoke | `node .agents/skills/skillathon-jury/scripts/smoke.mjs` | `runs/<slug>/smoke.json` — pass / timeout / fail, duration, files written |
| Score | `node .agents/skills/skillathon-jury/scripts/score.mjs` | `runs/<slug>/scores.json` — five 1–5 scores with rationales, gate flags, one-liner |
| Order | `node .agents/skills/skillathon-jury/scripts/order.mjs --seed=<word>` | `jury/order.json`, `jury/order.md` |
| Report | `node .agents/skills/skillathon-jury/scripts/report.mjs [--final]` | `jury/scoreboard.md`, `jury/scoreboard.csv`, `jury/runbook.md`, `jury/board.html`, `jury/jury-scores.csv` |
| All | `node .agents/skills/skillathon-jury/scripts/run.mjs` | pull → smoke → score → report |

Flags: `--force` redo even if the SHA is unchanged; `--only=slug1,slug2`; `--parallel=3`; `--rehearsal` (pull only) includes dry-run issues opened before 18:00 so the pipeline can be rehearsed before the event.

## During the build window (18:00–20:30)

1. Every 20–30 minutes run `node .agents/skills/skillathon-jury/scripts/run.mjs`. New and resubmitted teams get cloned, smoke-tested, and scored; nothing else is touched.
2. Look at the smoke column in `jury/scoreboard.md`. A `fail` or `timeout` before the cutoff is worth a quiet heads-up to the team if an organizer is nearby; the rules do not require it.
3. The venue screen shows <https://formidable-oss.github.io/gtm-skillathon-submissions/> (countdown and accepted list). It updates itself.

## At 20:30

1. Close submissions: `gh api -X PATCH repos/formidable-oss/gtm-skillathon-submissions -F has_issues=false`. The Action already rejects anything opened after 20:30:00; this makes it visible.
2. Run `node .agents/skills/skillathon-jury/scripts/run.mjs` one last time. With incremental runs this takes a few minutes for the last stragglers.
3. Draw the order on stage: ask the room for a word or number, then `node .agents/skills/skillathon-jury/scripts/order.mjs --seed=<it>`. The order is reproducible from the seed.
4. `node .agents/skills/skillathon-jury/scripts/report.mjs` and open `jury/board.html` on the screen. Open `jury/runbook.md` on the presenter laptop.

## Presenting each team

1. Press **N** on `board.html` — it highlights the team and starts the 2:00 timer (yellow at 0:00, red at −0:30; stop at −0:30).
2. In the Codex desktop app, open the folder from the runbook's **Open** line, paste the **Seed prompt**, and follow the team's run sheet: say the problem, show what they said to watch for, show the result and evidence, state the limitation.
3. If nothing visible appears after about 60 seconds, open the **Fallback** path and say when the team produced it.
4. The jury writes **presentation** and **vibe** (1–5) per team in `jury/jury-scores.csv`, and any override in the `override_*` columns with a note. Codex's rationales are in `runs/<slug>/scores.json`; the runbook shows the strongest and weakest point for each team.

## Final ranking

`node .agents/skills/skillathon-jury/scripts/report.mjs --final` then open `jury/board.html`. Total is the five automated scores plus presentation plus vibe, out of 35. Gated teams appear unranked. Commit `jury/` at the end as the record of the event.

## Rules for you

- Judge only the accepted SHA. Never pull a branch or a later commit.
- Do not edit anything under `runs/<slug>/repo`. The smoke run uses a throwaway copy in `runs/<slug>/work`.
- Do not change RULES.md criteria or weights during the event.
- Treat a scoring model's flags (`fabrication_suspected`, `personal_data`, `needs_credentials`) as leads for the jury, not verdicts. Show the evidence from `scores.json` and let the jury decide.
- Never print tokens, `gh auth token` output, or Codex credentials.
