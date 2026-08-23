#!/usr/bin/env node
// Regenerates board.json, docs/board.json, and BOARD.md from the bot records on all issues.
// Idempotent: every run rebuilds the whole board from GitHub state.
//
// Env: GITHUB_TOKEN (optional locally; raises the rate limit), GITHUB_REPOSITORY.

import { writeFileSync, mkdirSync } from "node:fs";
import { SUBMISSIONS_REPO, OPEN_AT, CLOSE_AT, loadRecords, localTime } from "./lib.mjs";

const records = await loadRecords();

// One row per repository: the latest accepted record, else the latest attempt.
const byRepo = new Map();
for (const r of records) {
  const key = String(r.repo).toLowerCase();
  const cur = byRepo.get(key);
  const isAccepted = r.current === "accepted";
  if (!cur) { byRepo.set(key, { ...r, accepted: isAccepted, attempts: 1 }); continue; }
  cur.attempts += 1;
  if (isAccepted && !cur.accepted) byRepo.set(key, { ...r, accepted: true, attempts: cur.attempts });
}

const rows = [...byRepo.values()]
  .map((r) => ({
    team: r.team,
    members: r.members,
    track: r.track,
    repo: r.repo,
    repo_url: r.repo_url,
    sha: r.accepted ? r.sha : null,
    status: r.accepted ? "accepted" : r.current === "dry-run" ? "dry-run" : r.current === "late" ? "late" : "rejected",
    issue: r.issue,
    issue_url: `https://github.com/${SUBMISSIONS_REPO}/issues/${r.issue}`,
    submitted_at: r.submitted_at,
    attempts: r.attempts,
    warnings: r.warnings ?? 0,
    slug: r.slug,
  }))
  .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));

const counts = {
  accepted: rows.filter((r) => r.status === "accepted").length,
  rejected: rows.filter((r) => r.status === "rejected").length,
  "dry-run": rows.filter((r) => r.status === "dry-run").length,
  late: rows.filter((r) => r.status === "late").length,
};

const board = { generated_at: new Date().toISOString(), open_at: OPEN_AT, close_at: CLOSE_AT, repo: SUBMISSIONS_REPO, counts, submissions: rows };
const json = JSON.stringify(board, null, 2) + "\n";
writeFileSync("board.json", json);
mkdirSync("docs", { recursive: true });
writeFileSync("docs/board.json", json);

const icon = { accepted: "✅", rejected: "❌", "dry-run": "🧪", late: "⏰" };
const md = [
  `# Submissions board`,
  ``,
  `Updated ${localTime(board.generated_at)} local. Live view: <https://formidable-oss.github.io/gtm-skillathon-submissions/>`,
  ``,
  `**${counts.accepted} accepted** · ${counts.rejected} need a fix · ${counts["dry-run"]} dry runs · ${counts.late} late`,
  ``,
  `| | Team | Track | Submitted | Commit | Issue |`,
  `| --- | --- | --- | --- | --- | --- |`,
  ...rows.map((r) => `| ${icon[r.status]} | ${r.team} | \`${r.track}\` | ${localTime(r.submitted_at)} | ${r.sha ? `[\`${r.sha.slice(0, 7)}\`](${r.repo_url}/tree/${r.sha})` : "—"} | [#${r.issue}](${r.issue_url}) |`),
  ``,
  `✅ accepted · ❌ latest attempt rejected, resubmit · 🧪 dry run before 18:00 · ⏰ after the cutoff`,
  ``,
].join("\n");
writeFileSync("BOARD.md", md);
console.log(`board: ${rows.length} repositories, ${counts.accepted} accepted`);
