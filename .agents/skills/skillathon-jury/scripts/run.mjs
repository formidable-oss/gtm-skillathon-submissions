#!/usr/bin/env node
// Orchestrates the jury pipeline incrementally: pull → smoke → guard → score → report → export.
// Safe to run repeatedly during the build window; only new or changed submissions do work.
//
// Usage: node run.mjs [--force] [--only=slug1,slug2] [--parallel=3] [--no-smoke] [--no-guard] [--no-score] [--no-report] [--no-export]

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const skip = new Set(argv.filter((a) => a.startsWith("--no-")).map((a) => a.slice(5)));
const passthrough = argv.filter((a) => !a.startsWith("--no-"));

const step = (name, extra = []) => {
  console.log(`\n== ${name} ==`);
  const r = spawnSync("node", [join(HERE, `${name}.mjs`), ...passthrough, ...extra], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`${name} failed`); process.exit(r.status ?? 1); }
};

step("pull");
if (!skip.has("smoke")) step("smoke");
if (!skip.has("guard")) step("guard");
if (!skip.has("score")) step("score");
if (!skip.has("report")) step("report");
if (!skip.has("export")) step("export");
