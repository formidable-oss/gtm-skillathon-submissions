#!/usr/bin/env node
// Runs each team's seed prompt non-interactively with `codex exec` from a fresh copy of the
// clone, with a 75-second cap, and records what happened in runs/<slug>/smoke.json.
// Incremental: skips runs that already have a result for the current SHA.
//
// Usage: node smoke.mjs [--force] [--only=slug1,slug2] [--parallel=3] [--effort=medium]
//   --effort  sets model_reasoning_effort for the run; match the jury laptop's Codex config

import { rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runDir, readJson, writeJson, readText, sh, args, submissions, pool, fmtMs, SMOKE_TIMEOUT_MS } from "./common.mjs";

const { force, only, opts } = args();
const parallel = Number(opts.parallel ?? 3);
const list = submissions({ only });

await pool(list, parallel, async (s) => {
  const dir = runDir(s.slug);
  const prior = readJson(join(dir, "smoke.json"));
  if (!force && prior && prior.sha === s.sha) { console.log(`  = ${s.slug}: ${prior.status} (${fmtMs(prior.duration_ms)})`); return; }
  if (!s.valid) { writeJson(join(dir, "smoke.json"), { sha: s.sha, status: "skipped", reason: "invalid structure", duration_ms: 0 }); console.log(`  - ${s.slug}: skipped (invalid)`); return; }
  if (!s.seed_prompt) { writeJson(join(dir, "smoke.json"), { sha: s.sha, status: "skipped", reason: "no seed prompt", duration_ms: 0 }); console.log(`  - ${s.slug}: skipped (no seed prompt)`); return; }

  const work = join(dir, "work");
  rmSync(work, { recursive: true, force: true });
  cpSync(join(dir, "repo"), work, { recursive: true });
  sh("git", ["-C", work, "add", "-A"]); // so new files show in status after the run

  const lastMessage = join(dir, "smoke-last.md");
  const logPath = join(dir, "smoke.log");
  rmSync(lastMessage, { force: true });
  const started = Date.now();
  let timedOut = false;
  const result = await new Promise((resolveRun) => {
    // Detached so the whole process group (codex and anything it spawned) can be killed.
    const child = spawn("codex", [
      "exec", "-C", work, "--sandbox", "workspace-write", "-c", 'network_access="enabled"', "-c", 'approval_policy="never"',
      ...(opts.effort ? ["-c", `model_reasoning_effort="${opts.effort}"`] : []),
      "--skip-git-repo-check", "--ephemeral", "--color", "never", "-o", lastMessage, s.seed_prompt,
    ], { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(hard); resolveRun({ ...r, log }); };
    const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const timer = setTimeout(() => { timedOut = true; killGroup("SIGTERM"); setTimeout(() => killGroup("SIGKILL"), 5000); }, SMOKE_TIMEOUT_MS);
    const hard = setTimeout(() => finish({ code: null, signal: "SIGKILL" }), SMOKE_TIMEOUT_MS + 15000); // even if a pipe is held open
    child.on("exit", (code, signal) => finish({ code, signal }));
    child.on("error", (e) => { log += String(e); finish({ code: -1, signal: null }); });
  });
  const duration = Date.now() - started;
  writeFileSync(logPath, result.log);

  const changed = sh("git", ["-C", work, "status", "--porcelain"]).out.split("\n").filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, "").replace(/^.* -> /, ""));
  const status = timedOut ? "timeout" : result.code === 0 ? "pass" : "fail";
  const fallback = s.manifest?.output && existsSync(join(dir, "repo", s.manifest.output));
  const smoke = {
    sha: s.sha, status, duration_ms: duration, exit_code: result.code, signal: result.signal,
    changed_files: changed, last_message: readText(lastMessage).trim().slice(0, 4000),
    fallback_present: Boolean(fallback), ran_at: new Date().toISOString(),
  };
  writeJson(join(dir, "smoke.json"), smoke);
  console.log(`  ${status === "pass" ? "✓" : status === "timeout" ? "⏱" : "✗"} ${s.slug}: ${status} (${fmtMs(duration)}) ${changed.length} file${changed.length === 1 ? "" : "s"} changed`);
});
