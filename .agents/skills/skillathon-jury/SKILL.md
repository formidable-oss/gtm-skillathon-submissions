---
name: skillathon-jury
description: Organizer tooling for the GTM Skillathon. Pulls accepted submissions from GitHub at their exact commits, smoke-tests each seed prompt with codex exec, scans them for anti-gaming leads, scores the automated criteria from RULES.md, draws the random presentation order, and builds the scoreboard, runbook, on-screen board, and the CSV uploaded to the jury app. Use when the organizer asks to pull, test, score, order, rank, or present submissions, or to close submissions at the cutoff.
---

# Jury

Run from the root of this repository. Every step is incremental and idempotent; rerun it as often as you like during the build window. Outputs land in `jury/`; working copies in `runs/<slug>/` (gitignored).

Requirements: `gh` logged in as an organizer, `codex` CLI logged in, Node 18+. Install for the organizer's agent with:

```bash
ln -s "$PWD/.agents/skills/skillathon-jury" ~/.agents/skills/skillathon-jury
```

## Commands

| Step | Command | Produces |
| --- | --- | --- |
| Pull | `node .agents/skills/skillathon-jury/scripts/pull.mjs` | `runs/<slug>/repo` at the accepted SHA, `runs/<slug>/validate.json`, `jury/submissions.json` |
| Smoke | `node .agents/skills/skillathon-jury/scripts/smoke.mjs` | `runs/<slug>/smoke.json` — pass / timeout / fail, duration, files written |
| Guard | `node .agents/skills/skillathon-jury/scripts/guard.mjs` | `runs/<slug>/guard.json` — deterministic anti-gaming findings (leads, never a verdict) |
| Score | `node .agents/skills/skillathon-jury/scripts/score.mjs` | `runs/<slug>/dossier.md`, `runs/<slug>/scores.json` — five 1–5 scores with rationales, gate flags, one-liner |
| Order | `node .agents/skills/skillathon-jury/scripts/order.mjs --seed=<word>` | `jury/order.json`, `jury/order.md` |
| Report | `node .agents/skills/skillathon-jury/scripts/report.mjs [--final]` | `jury/scoreboard.md`, `jury/scoreboard.csv`, `jury/runbook.md`, `jury/board.html`, `jury/jury-scores.csv` |
| Export | `node .agents/skills/skillathon-jury/scripts/export.mjs` | `jury/export.csv` — the file uploaded to the jury app |
| All | `node .agents/skills/skillathon-jury/scripts/run.mjs` | pull → smoke → guard → score → report → export |

Flags: `--force` redo even if the SHA is unchanged; `--only=slug1,slug2`; `--parallel=3`; `--no-smoke`, `--no-guard`, `--no-score`, `--no-report`, `--no-export` (run only) skip a step; `--effort=medium` (smoke only) sets `model_reasoning_effort` for the run; `--rehearsal` (pull only) includes dry-run issues opened before 18:00 so the pipeline can be rehearsed before the event.

Timing: in rehearsal a small Markdown-only skill took 50–75 s with `model_reasoning_effort = "high"`, right at the 75 s cap. Set the jury laptop's `~/.codex/config.toml` to `model_reasoning_effort = "medium"` for the event and pass `--effort=medium` to the smoke run so both measure the same thing.

## Guard and dossier scoring

`guard.mjs` scans the whole clone deterministically and writes `runs/<slug>/guard.json`: grader-directed text, hidden text (HTML comments, zero-width and bidi characters, invisible CSS), files outside the declared paths and the standard layout, cloned eval "observed" cells, evidence committed before the input it claims to use, oversized text blobs, and `DEMO.md` echoing the RULES.md criteria table. It never fails a team; every finding is a lead for the jury and a hint for the judge. The rubric-echo check reads the canonical `RULES.md` from a `gtm-skillathon-starter` checkout beside this repository, or from `SKILLATHON_RULES`; without it that one check is skipped.

`score.mjs` never lets the model see the clone. It builds `runs/<slug>/dossier.md` from `submission.json` plus only the paths the team declared, each fenced as untrusted data and truncated at 40 KB, then runs `codex exec` in an empty temporary directory with a read-only sandbox, feeding rubric + guard findings + smoke summary + dossier on stdin. Undeclared files, hidden folders, and anything the team did not list simply cannot reach the judge. Read `dossier.md` when a score looks wrong: it is exactly what the model saw.

## Adjusting the submission window

Defaults are 18:00–20:30 local (15:00–17:30 UTC), hardcoded as fallbacks. Override without a commit via repository variables (ISO UTC), then rebuild the board so clients pick the new times up:

```bash
gh variable set SKILLATHON_CLOSE_AT --body "2026-08-28T18:00:00Z" -R formidable-oss/gtm-skillathon-submissions
gh workflow run submission.yml -R formidable-oss/gtm-skillathon-submissions   # rebuilds board.json with the new window
```

`SKILLATHON_OPEN_AT` works the same. `gh variable delete <name> -R …` restores the default. New issues are judged against the effective window at processing time; the dashboard countdown and the participant submit script read the window from `board.json`, so they follow within a minute.

To retro-accept an issue that was marked `late` before an extension: re-run its "Process submission" run from the Actions tab (the verdict is recomputed against the original issue timestamp and the new window), then remove the stale `late` label. Never extend after demos have started.

## During the build window (18:00–20:30)

1. Every 20–30 minutes run `node .agents/skills/skillathon-jury/scripts/run.mjs`. New and resubmitted teams get cloned, smoke-tested, scanned, scored and exported; nothing else is touched.
2. Open the jury app's `/board` page and upload the fresh `jury/export.csv`. The upload upserts by `slug`; organizer overrides, gates, and juror scores already in the app survive it.
3. Look at the smoke column in `jury/scoreboard.md`. A `fail` or `timeout` before the cutoff is worth a quiet heads-up to the team if an organizer is nearby; the rules do not require it.
4. The venue screen shows <https://formidable-oss.github.io/gtm-skillathon-submissions/> (countdown and accepted list). It updates itself.

## At 20:30

1. Close submissions: `gh api -X PATCH repos/formidable-oss/gtm-skillathon-submissions -F has_issues=false`. The Action already rejects anything opened after 20:30:00; this makes it visible.
2. Run `node .agents/skills/skillathon-jury/scripts/run.mjs` one last time. With incremental runs this takes a few minutes for the last stragglers.
3. Draw the order on stage: ask the room for a word or number, then `node .agents/skills/skillathon-jury/scripts/order.mjs --seed=<it>`. The order is reproducible from the seed.
4. `node .agents/skills/skillathon-jury/scripts/report.mjs` and `node .agents/skills/skillathon-jury/scripts/export.mjs` (the export now carries the drawn order), then upload `jury/export.csv` on `/board` one last time. Open `jury/runbook.md` on the presenter laptop.

## Presenting each team

1. Press **N** on `board.html` — it highlights the team and starts the 2:00 timer (yellow at 0:00, red at −0:30; stop at −0:30).
2. In the Codex desktop app, open the folder from the runbook's **Open** line, paste the **Seed prompt**, and follow the team's run sheet: say the problem, show what they said to watch for, show the result and evidence, state the limitation.
3. If nothing visible appears after about 60 seconds, open the **Fallback** path and say when the team produced it.
4. The jury enters **presentation** and **vibe** (1–5) per team on the jury app's `/jury` page from their phones; the organizer edits any automated score on `/board` as an override with a note. Offline fallback: the same columns in `jury/jury-scores.csv`. Codex's rationales are in `runs/<slug>/scores.json`, its manipulation flag and gaming notes come with them, and the scanner's leads are in `runs/<slug>/guard.json`; the runbook shows the strongest and weakest point for each team.

## Final ranking

Flip **Reveal** on the jury app's `/board`: it ranks by the five automated scores plus presentation plus vibe, out of 35, with gated teams listed unranked. Offline fallback: `node .agents/skills/skillathon-jury/scripts/report.mjs --final` then open `jury/board.html`. Afterwards download the app's `/api/export.csv`, drop it and the final `jury/export.csv` into `jury/`, and commit `jury/` as the record of the event.

## Rules for you

- Judge only the accepted SHA. Never pull a branch or a later commit.
- Do not edit anything under `runs/<slug>/repo`. The smoke run uses a throwaway copy in `runs/<slug>/work`.
- Do not change RULES.md criteria or weights during the event.
- Treat a scoring model's flags (`fabrication_suspected`, `personal_data`, `needs_credentials`, `grader_manipulation`) and every `guard.json` finding as leads for the jury, not verdicts. Show the evidence from `scores.json` and `guard.json` and let the jury decide; only an organizer gates a team.
- Never print tokens, `gh auth token` output, or Codex credentials.
