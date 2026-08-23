# Design — GTM Skillathon submission system and jury tooling

Decided 23 August 2026. Event 28 August 2026, Builders House, București. 60 registered, teams of 1–2, 30–40 submissions expected.

## Constraints that shaped this

- No hosted app. GitHub is the server: issue timestamps are tamper-proof, any GitHub account can file one, Actions run the checks, Pages serves the board.
- Hard cutoff 20:30 local with no grace and no manual acceptance. Enforced by the Action on `issue.created_at`; organizer additionally disables issues at 20:30.
- Demos start at 20:30 from one laptop, presented by the organizer in the Codex desktop app. 30–40 teams × 2:00 (2:30 hard stop) fits 20:30–21:45 only if the pre-run work happens during the build window, so the jury pipeline is incremental by SHA and safe to rerun every 20–30 minutes.
- No credentials on the jury laptop. Skills must degrade and the committed fallback output must carry the demo.
- Non-technical participants must be able to win: two organizer skills in the template (`$skillathon-guide`, `$skillathon-submit`) let their agent do the whole lifecycle.

## Flow

1. Participant creates a public repo from the template, builds, fills `submission.json`, `DEMO.md`, `demo/`.
2. `$skillathon-submit` runs `validate.mjs` (same checks as the server), commits/pushes with the participant, files the issue with `gh` (or prints a prefilled form URL), and waits for the verdict.
3. Action: parse body → window → public repo + SHA exist (API) → shallow fetch at SHA → run canonical `validate.mjs` (fetched from template `main`, vendored fallback) → label `accepted` / `rejected` / `dry-run` / `late` → comment with a hidden JSON record → supersede older accepted issues for the same repository → rebuild `board.json` + `BOARD.md` and push with retries (no concurrency group, so nothing is dropped; each run regenerates the full board).
4. `docs/index.html` on Pages polls `board.json` every 30 s, shows countdown and accepted list.
5. Organizer runs `$skillathon-jury` repeatedly: pull (clone at SHA, validate) → smoke (`codex exec` with 75 s cap in a throwaway copy; records status, duration, files written) → score (`codex exec --output-schema` against the rubric; five 1–5 scores with rationales, gate flags, one-liner) → report (scoreboard, runbook, board.html).
6. At 20:30: disable issues, final run, draw order with a seed announced on stage, present from `runbook.md` with `board.html` on screen, jury fills `jury-scores.csv`, `report.mjs --final`.

## Identity and tamper resistance

- A team is identified by its repository (`owner/name`), not by the issue author or team name. Resubmissions for the same repository supersede.
- The accepted record lives in the bot's comment, which participants cannot edit. The jury pulls from those records, never from issue bodies, so editing an issue after the cutoff changes nothing.
- The judged artifact is the SHA recorded at accept time. Later pushes are irrelevant by construction.

## Judging (from RULES.md)

Gates: in window, valid structure, runs, clean. Automated scores: GTM job clarity, real-world signal, evidence, skill quality, reusability (Codex-proposed, jury may override). Jury scores: presentation, vibe. Total 35.

## Known limitations

- `codex exec` must find `.agents/skills` in the working directory; verified for Codex CLI 0.149. If a later version changes discovery, smoke results degrade to "fail" uniformly and the live demo still runs in the app.
- The Action's secret scan covers the submitted tree, not git history. The template validator does the same. A deliberately hidden secret in history is not caught.
- Pages and raw.githubusercontent cache for up to a few minutes; the board may lag slightly. `BOARD.md` on the repository page is always current.
- GitHub API unauthenticated rate limits do not apply to the Action (it uses `GITHUB_TOKEN`) or to the jury scripts (they use `gh auth token`).
