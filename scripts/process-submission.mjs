#!/usr/bin/env node
// Processes one submission issue: window check, repository and commit verification,
// clone at the exact SHA, canonical validation, verdict label and comment, supersede
// earlier accepted submissions for the same repository.
//
// Env: GITHUB_TOKEN, ISSUE_NUMBER, GITHUB_REPOSITORY (set by Actions).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBMISSIONS_REPO, TEMPLATE_REPO, VALIDATOR_URL, OPEN_AT, CLOSE_AT, TRACKS, VERDICTS,
  gh, ghAll, parseIssueBody, parseRepoUrl, encodeRecord, decodeRecord, localTime, slugify,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const issueNumber = Number(process.env.ISSUE_NUMBER);
if (!issueNumber) throw new Error("ISSUE_NUMBER is required");

const issue = await gh(`/repos/${SUBMISSIONS_REPO}/issues/${issueNumber}`);
const createdAt = issue.created_at;
const fields = parseIssueBody(issue.body);
const problems = [];
const warnings = [];

// ---- window ------------------------------------------------------------------------
const t = Date.parse(createdAt);
const late = t >= Date.parse(CLOSE_AT);
const early = t < Date.parse(OPEN_AT);

// ---- fields ------------------------------------------------------------------------
if (!fields.team) problems.push("Team name is missing.");
if (fields.members.length < 1 || fields.members.length > 2) problems.push("Members must list one or two names.");
if (!TRACKS.includes(fields.track)) problems.push(`Track must be one of: ${TRACKS.join(", ")}.`);
const repo = parseRepoUrl(fields.repoUrl);
if (!repo) problems.push("Repository URL must look like https://github.com/owner/repo.");
if (!/^[0-9a-f]{7,40}$/i.test(fields.sha)) problems.push("Commit SHA must be a 7–40 character hex SHA.");

// ---- repository and commit ---------------------------------------------------------
let fullSha = null;
let repoMeta = null;
if (repo && problems.length === 0) {
  try {
    repoMeta = await gh(`/repos/${repo.full}`);
    if (repoMeta.private) problems.push(`${repo.full} is private. Make it public and resubmit.`);
  } catch (e) {
    problems.push(e.status === 404 ? `${repo.full} was not found or is not public.` : `Could not read ${repo.full}: ${e.message}`);
  }
  if (repoMeta && !repoMeta.private) {
    try {
      const commit = await gh(`/repos/${repo.full}/commits/${fields.sha}`);
      fullSha = commit.sha;
    } catch (e) {
      problems.push(e.status === 404 || e.status === 422 ? `Commit ${fields.sha} was not found in ${repo.full}. Push it, then resubmit with the exact SHA.` : `Could not read commit: ${e.message}`);
    }
  }
}

// ---- clone and validate ------------------------------------------------------------
let validation = null;
let summary = null;
if (fullSha && !late) {
  const dir = mkdtempSync(join(tmpdir(), "submission-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    git("remote", "add", "origin", `https://github.com/${repo.full}.git`);
    git("fetch", "-q", "--depth", "1", "origin", fullSha);
    git("checkout", "-q", "FETCH_HEAD");

    const validator = join(dir, ".skillathon-validate.mjs");
    let source = null;
    try {
      const res = await fetch(VALIDATOR_URL, { headers: { "User-Agent": "gtm-skillathon" } });
      if (res.ok) source = await res.text();
    } catch { /* fall through to vendored copy */ }
    if (source) writeFileSync(validator, source);
    const validatorPath = source ? validator : join(HERE, "validate.mjs");

    let out;
    try {
      out = execFileSync("node", [validatorPath, dir, "--json"], { encoding: "utf8" });
    } catch (e) {
      out = e.stdout?.toString() ?? "";
    }
    try { validation = JSON.parse(out); } catch { problems.push("The validator could not run against the repository. Make sure it was created from the starter template."); }
    if (validation) {
      summary = validation.summary;
      for (const e of validation.errors) problems.push(`\`${e.code}\`${e.path ? ` in \`${e.path}\`` : ""}: ${e.message}`);
      for (const w of validation.warnings) warnings.push(`\`${w.code}\`${w.path ? ` in \`${w.path}\`` : ""}: ${w.message}`);
    }
  } catch (e) {
    problems.push(`Could not fetch commit ${fullSha.slice(0, 7)} from ${repo.full}: ${String(e.stderr ?? e.message).split("\n")[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- verdict -----------------------------------------------------------------------
let verdict;
if (late) verdict = "late";
else if (problems.length) verdict = "rejected";
else if (early) verdict = "dry-run";
else verdict = "accepted";

const record = {
  issue: issueNumber,
  verdict,
  submitted_at: createdAt,
  author: issue.user?.login ?? null,
  team: summary?.team ?? fields.team,
  members: summary?.members?.length ? summary.members : fields.members,
  track: summary?.track ?? fields.track,
  problem: summary?.problem ?? null,
  entry_skill: summary?.entry_skill ?? null,
  repo: repo?.full ?? fields.repoUrl,
  repo_url: repo ? `https://github.com/${repo.full}` : fields.repoUrl,
  sha: fullSha ?? fields.sha,
  slug: slugify(repo?.name ?? fields.team),
  warnings: warnings.length,
};

const at = `${localTime(createdAt)} local (${createdAt})`;
const lines = [];
if (verdict === "late") {
  lines.push(`## ❌ Late`, ``, `This issue was opened at **${at}**, after the 20:30 cutoff. Submissions closed; this one is not accepted. No exceptions.`);
} else if (verdict === "rejected") {
  lines.push(`## ❌ Rejected`, ``, `Opened at ${at}. Fix the items below, commit, push, and open a new submission issue. You can resubmit until 20:30.`, ``, ...problems.map((p) => `- ${p}`));
  if (warnings.length) lines.push(``, `Warnings (do not block):`, ``, ...warnings.map((w) => `- ${w}`));
  lines.push(``, `Run \`node .agents/skills/skillathon-submit/scripts/validate.mjs\` locally to see the same checks, or ask your agent to run \`$skillathon-submit\`.`);
} else if (verdict === "dry-run") {
  lines.push(`## ✅ Dry run passed`, ``, `Opened at ${at}, before submissions open at 18:00. Your pipeline works, but **this is not a submission**. Open a new issue after 18:00.`);
  if (warnings.length) lines.push(``, `Warnings:`, ``, ...warnings.map((w) => `- ${w}`));
} else {
  lines.push(
    `## ✅ Accepted`, ``,
    `| | |`, `| --- | --- |`,
    `| Team | ${record.team} (${record.members.join(", ")}) |`,
    `| Track | \`${record.track}\` |`,
    `| Entry skill | \`$${record.entry_skill}\` |`,
    `| Repository | ${record.repo_url} |`,
    `| Commit | \`${record.sha}\` |`,
    `| Submitted | ${at} |`,
    ``,
    `This commit is what the jury runs. Pushing more commits changes nothing; to submit an improved version, open a new submission issue before 20:30. The latest accepted one for this repository counts.`,
  );
  if (warnings.length) lines.push(``, `Warnings (do not block, but the jury sees them):`, ``, ...warnings.map((w) => `- ${w}`));
}
lines.push(``, encodeRecord(record));

await ensureLabels();
await gh(`/repos/${SUBMISSIONS_REPO}/issues/${issueNumber}/comments`, { method: "POST", body: { body: lines.join("\n") } });
await gh(`/repos/${SUBMISSIONS_REPO}/issues/${issueNumber}/labels`, { method: "POST", body: { labels: ["submission", verdict, ...(record.track && TRACKS.includes(record.track) ? [`track:${record.track}`] : [])] } });
if (verdict !== "accepted") {
  await gh(`/repos/${SUBMISSIONS_REPO}/issues/${issueNumber}`, { method: "PATCH", body: { state: "closed", state_reason: verdict === "dry-run" ? "completed" : "not_planned" } });
}

// ---- supersede earlier accepted submissions for the same repository ----------------
if (verdict === "accepted") {
  const open = await ghAll(`/repos/${SUBMISSIONS_REPO}/issues?state=open&labels=accepted`);
  for (const other of open) {
    if (other.number === issueNumber) continue;
    const comments = await ghAll(`/repos/${SUBMISSIONS_REPO}/issues/${other.number}/comments`);
    const rec = comments.map((c) => decodeRecord(c.body)).filter(Boolean).pop();
    if (!rec || rec.repo.toLowerCase() !== record.repo.toLowerCase()) continue;
    if (Date.parse(rec.submitted_at) > t) continue; // an even newer one already exists
    await gh(`/repos/${SUBMISSIONS_REPO}/issues/${other.number}/comments`, { method: "POST", body: { body: `Superseded by #${issueNumber} (commit \`${record.sha.slice(0, 7)}\`).` } });
    await gh(`/repos/${SUBMISSIONS_REPO}/issues/${other.number}/labels/accepted`, { method: "DELETE" }).catch(() => {});
    await gh(`/repos/${SUBMISSIONS_REPO}/issues/${other.number}/labels`, { method: "POST", body: { labels: ["superseded"] } });
    await gh(`/repos/${SUBMISSIONS_REPO}/issues/${other.number}`, { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
  }
}

console.log(`#${issueNumber} ${verdict} ${record.repo}@${String(record.sha).slice(0, 7)}`);

async function ensureLabels() {
  const wanted = {
    submission: ["0e8a16", "A submission issue"],
    accepted: ["2ea043", "Accepted; this commit will be judged unless superseded"],
    rejected: ["d73a4a", "Rejected; see the comment and resubmit"],
    superseded: ["8b949e", "Replaced by a later accepted submission"],
    late: ["d73a4a", "Opened after the 20:30 cutoff"],
    "dry-run": ["0075ca", "Validated before 18:00; not a submission"],
    ...Object.fromEntries(TRACKS.map((tr) => [`track:${tr}`, ["fbca04", `Track ${tr}`]])),
  };
  const existing = new Set((await ghAll(`/repos/${SUBMISSIONS_REPO}/labels`)).map((l) => l.name));
  for (const [name, [color, description]] of Object.entries(wanted)) {
    if (existing.has(name)) continue;
    await gh(`/repos/${SUBMISSIONS_REPO}/labels`, { method: "POST", body: { name, color, description } }).catch(() => {});
  }
}
