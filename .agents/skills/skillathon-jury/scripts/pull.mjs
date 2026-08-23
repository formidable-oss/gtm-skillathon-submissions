#!/usr/bin/env node
// Pulls every accepted submission: reads the bot records from GitHub, clones each repository
// at its exact SHA into runs/<slug>/repo, runs the canonical validator, writes
// runs/<slug>/meta.json and jury/submissions.json. Incremental: a repository already cloned
// at the same SHA is left untouched.
//
// Usage: node pull.mjs [--force] [--rehearsal]
//   --rehearsal  also pull dry-run records (issues opened before 18:00) to rehearse the pipeline
// Requires gh auth; GITHUB_TOKEN is derived from gh.

import { rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, JURY, runDir, readJson, writeJson, sh, args, localTime } from "./common.mjs";

if (!process.env.GITHUB_TOKEN) {
  const t = sh("gh", ["auth", "token"]);
  if (t.ok) process.env.GITHUB_TOKEN = t.out;
}
const { loadRecords } = await import(join(ROOT, "scripts/lib.mjs"));
const { force, flags } = args();
const rehearsal = flags.has("--rehearsal");

const records = (await loadRecords()).filter((r) => (r.current === "accepted" && r.state === "open") || (rehearsal && r.current === "dry-run"));
// One per repository: the newest accepted.
const byRepo = new Map();
for (const r of records) {
  const key = r.repo.toLowerCase();
  if (!byRepo.has(key) || Date.parse(r.submitted_at) > Date.parse(byRepo.get(key).submitted_at)) byRepo.set(key, r);
}
const accepted = [...byRepo.values()].sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
console.log(`${accepted.length} accepted submission${accepted.length === 1 ? "" : "s"}`);

const out = [];
for (const r of accepted) {
  const dir = runDir(r.slug);
  const repoDir = join(dir, "repo");
  const meta = readJson(join(dir, "meta.json"));
  const fresh = force || !meta || meta.sha !== r.sha || !existsSync(join(repoDir, ".git"));
  if (fresh) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(repoDir, { recursive: true });
    const git = (...a) => sh("git", ["-C", repoDir, ...a]);
    git("init", "-q");
    git("remote", "add", "origin", `https://github.com/${r.repo}.git`);
    const f = git("fetch", "-q", "--depth", "1", "origin", r.sha);
    if (!f.ok) { console.log(`  ✗ ${r.slug}: fetch failed — ${f.err.split("\n")[0]}`); writeJson(join(dir, "meta.json"), { ...r, clone_error: f.err.split("\n")[0] }); continue; }
    git("checkout", "-q", "FETCH_HEAD");
  }
  const v = sh("node", [join(ROOT, "scripts/validate.mjs"), repoDir, "--json"]);
  let validation = null;
  try { validation = JSON.parse(v.out); } catch { validation = { ok: false, errors: [{ code: "validator", message: v.err || "validator failed" }], warnings: [], summary: {} }; }
  writeJson(join(dir, "validate.json"), validation);

  const manifest = readJson(join(repoDir, "submission.json"), {});
  const seedPrompt = existsSync(join(repoDir, manifest.seed_prompt ?? "demo/seed-prompt.md")) ? readFileSync(join(repoDir, manifest.seed_prompt ?? "demo/seed-prompt.md"), "utf8").trim() : "";
  const entry = { ...r, problem: manifest.problem ?? r.problem, entry_skill: validation.summary?.entry_skill ?? r.entry_skill, seed_prompt: seedPrompt, manifest, valid: validation.ok, validation_errors: validation.errors.length, validation_warnings: validation.warnings.length, pulled_at: new Date().toISOString() };
  writeJson(join(dir, "meta.json"), entry);
  out.push(entry);
  console.log(`  ${fresh ? "↓" : "="} ${r.slug.padEnd(32)} ${r.sha.slice(0, 7)}  ${localTime(r.submitted_at)}  ${validation.ok ? "valid" : `INVALID (${validation.errors.length})`}`);
}
writeJson(join(JURY, "submissions.json"), out);
