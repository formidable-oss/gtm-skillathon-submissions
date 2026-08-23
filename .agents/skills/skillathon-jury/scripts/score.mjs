#!/usr/bin/env node
// Asks Codex to score each submission against the rubric in references/rubric.md, enforcing
// references/score.schema.json. Writes runs/<slug>/scores.json. Incremental by SHA.
//
// Usage: node score.mjs [--force] [--only=slug1,slug2] [--parallel=3] [--model=<model>]

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { runDir, readJson, writeJson, sh, args, submissions, pool, REFS } from "./common.mjs";

const { force, only, opts } = args();
const parallel = Number(opts.parallel ?? 3);
const list = submissions({ only });
const rubric = readFileSync(join(REFS, "rubric.md"), "utf8");
const schema = join(REFS, "score.schema.json");

await pool(list, parallel, async (s) => {
  const dir = runDir(s.slug);
  const prior = readJson(join(dir, "scores.json"));
  if (!force && prior && prior.sha === s.sha && !prior.error) { console.log(`  = ${s.slug}: ${total(prior)}/25`); return; }
  if (!s.valid) { writeJson(join(dir, "scores.json"), { sha: s.sha, error: "invalid structure; not scored" }); console.log(`  - ${s.slug}: not scored (invalid)`); return; }

  const smoke = readJson(join(dir, "smoke.json"));
  const context = smoke ? `\n\nContext from the organizer's smoke run of the seed prompt (${smoke.status}, ${(smoke.duration_ms / 1000).toFixed(0)}s, files changed: ${smoke.changed_files?.join(", ") || "none"}). Use it only as evidence about "runs"; score the criteria from the files.` : "";
  const out = join(dir, "scores.raw.json");
  const r = sh("codex", [
    "exec", "-C", join(dir, "repo"), "--sandbox", "read-only", "-c", 'approval_policy="never"', "--skip-git-repo-check", "--ephemeral",
    "--color", "never", "--output-schema", schema, "-o", out, ...(opts.model ? ["-m", opts.model] : []), rubric + context,
  ], { timeout: 10 * 60 * 1000 });
  let scores = null;
  try { scores = JSON.parse(readFileSync(out, "utf8")); } catch { /* fall through */ }
  if (!scores) { writeJson(join(dir, "scores.json"), { sha: s.sha, error: `codex exec failed: ${(r.err || r.out).split("\n").slice(-3).join(" ")}` }); console.log(`  ✗ ${s.slug}: scoring failed`); return; }
  const record = { sha: s.sha, scored_at: new Date().toISOString(), ...scores };
  writeJson(join(dir, "scores.json"), record);
  console.log(`  ✓ ${s.slug}: ${total(record)}/25${record.gates?.fabrication_suspected ? "  ⚠ fabrication?" : ""}${record.gates?.personal_data ? "  ⚠ personal data" : ""}${record.gates?.needs_credentials ? "  ⚠ needs credentials" : ""}`);
});

function total(sc) {
  return ["gtm_job_clarity", "real_world_signal", "evidence", "skill_quality", "reusability"].reduce((n, k) => n + (sc[k]?.score ?? 0), 0);
}
