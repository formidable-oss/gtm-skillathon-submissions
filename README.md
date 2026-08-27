# GTM Skillathon — submissions

Submission system and jury tooling for the [GTM Skillathon](https://luma.com/82q9aclg), 28 August 2026. Participants start from [the template](https://github.com/formidable-oss/gtm-skillathon-starter); its `RULES.md` is the canonical rulebook.

## For participants

Submit by opening a **Submission** issue: [New submission](https://github.com/formidable-oss/gtm-skillathon-submissions/issues/new/choose). The easiest way is to ask your agent to run `$skillathon-submit` from your repository; it validates and files the issue for you.

- Open 18:00–20:30 Europe/Bucharest on 28 August. The issue timestamp is the submission time. Issues opened after 20:30:00 are rejected automatically; before 18:00 they are validated as dry runs.
- Within about two minutes the system comments **accepted** or **rejected** with the exact items to fix.
- Resubmit by opening a new issue. The latest accepted issue for your repository counts; earlier ones are closed as superseded.
- The jury clones the accepted commit SHA. Later pushes change nothing.

Live board: <https://gtm-skillathon-jury.vercel.app/> · Markdown: [`BOARD.md`](BOARD.md)

## For organizers

Open this repository in Codex and use `$skillathon-jury`. The skill pulls accepted submissions at their exact commits, smoke-tests every seed prompt, scores the automated criteria, draws the presentation order, and builds the scoreboard, runbook, and on-screen board. See [`.agents/skills/skillathon-jury/SKILL.md`](.agents/skills/skillathon-jury/SKILL.md) and [`DESIGN.md`](DESIGN.md).

## How it works

- `.github/ISSUE_TEMPLATE/submission.yml` — the form (team, members, track, repository URL, commit SHA).
- `.github/workflows/submission.yml` → `scripts/process-submission.mjs` — on every new issue: window check, public-repo and commit verification, clone at the SHA, canonical validation (`scripts/validate.mjs`, fetched from the template's `main` with a vendored fallback), verdict label + comment, supersede earlier accepted issues for the same repository. The verdict comment carries a machine-readable record; bot comments cannot be edited by participants, so the record is the source of truth.
- `scripts/build-board.mjs` — rebuilds `board.json` and `BOARD.md` from those records after every issue. The jury app (<https://gtm-skillathon-jury.vercel.app/>) renders `board.json` with a countdown.
- `.agents/skills/skillathon-jury/` — organizer pipeline, incremental by SHA.
