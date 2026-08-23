// Shared helpers for the jury scripts. Run from the submissions repository root.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const RUNS = join(ROOT, "runs");
export const JURY = join(ROOT, "jury");
export const REFS = resolve(dirname(fileURLToPath(import.meta.url)), "../references");
export const SMOKE_TIMEOUT_MS = 75_000;
mkdirSync(JURY, { recursive: true });

export const CRITERIA = [
  ["gtm_job_clarity", "GTM job clarity"],
  ["real_world_signal", "Real-world signal"],
  ["evidence", "Evidence"],
  ["skill_quality", "Skill quality"],
  ["reusability", "Reusability"],
];
export const JURY_COLUMNS = ["presentation", "vibe"];

export const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
export const writeJson = (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + "\n"); };
export const readText = (p, fallback = "") => (existsSync(p) ? readFileSync(p, "utf8") : fallback);

export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export function args() {
  const a = process.argv.slice(2);
  const flags = new Set(a.filter((x) => x.startsWith("--") && !x.includes("=")));
  const opts = Object.fromEntries(a.filter((x) => x.startsWith("--") && x.includes("=")).map((x) => x.slice(2).split(/=(.*)/s).slice(0, 2)));
  const positional = a.filter((x) => !x.startsWith("--"));
  return { flags, opts, positional, force: flags.has("--force"), only: opts.only ? opts.only.split(",") : null };
}

export function submissions({ only } = {}) {
  const list = readJson(join(JURY, "submissions.json"), []);
  return only ? list.filter((s) => only.includes(s.slug)) : list;
}

export const runDir = (slug) => join(RUNS, slug);
export const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function localTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit" });
}

// Runs up to `limit` async tasks concurrently, preserving order of results.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }));
  return results;
}
