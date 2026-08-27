#!/usr/bin/env node
// Writes jury/export.csv: one row per accepted, valid, scored team — the file the organizer
// uploads on the jury app's /board page. Upsert key is `slug`. Rationales stay in
// runs/<slug>/scores.json; the app only needs the numbers, the flags, and the leads.
//
// Usage: node export.mjs [--only=slug1,slug2]

import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { JURY, runDir, readJson, args, submissions, CRITERIA } from "./common.mjs";

const { only } = args();
const order = readJson(join(JURY, "order.json"));
const position = new Map((order?.order ?? []).map((o) => [o.slug, o.position]));

const HEADER = [
  "slug", "team", "skill_name", "one_liner", "sha", "repo_url", "order", "smoke_status",
  ...CRITERIA.map(([k]) => k),
  "flag_fabrication", "flag_personal_data", "flag_needs_credentials", "flag_grader_manipulation",
  "flag_notes", "guard_findings", "strongest", "weakest",
];

const bool = (v) => (v ? "true" : "false");
const rows = [];
for (const s of submissions({ only })) {
  const dir = runDir(s.slug);
  const scores = readJson(join(dir, "scores.json"));
  if (!s.valid || !scores || scores.error) continue;
  const smoke = readJson(join(dir, "smoke.json"));
  const guard = readJson(join(dir, "guard.json"));
  const gates = scores.gates ?? {};
  const findings = [...new Set((guard?.findings ?? []).map((f) => `${f.kind}:${f.path}`))].join("; ");
  rows.push([
    s.slug, s.team, s.entry_skill ?? "", scores.one_liner ?? "", s.sha, s.repo_url,
    position.get(s.slug) ?? "", smoke?.status ?? "not run",
    ...CRITERIA.map(([k]) => scores[k]?.score ?? ""),
    bool(gates.fabrication_suspected), bool(gates.personal_data), bool(gates.needs_credentials), bool(gates.grader_manipulation),
    [gates.notes, gates.gaming_notes].filter(Boolean).join(" · "), findings,
    scores.strongest ?? "", scores.weakest ?? "",
  ]);
}

const path = join(JURY, "export.csv");
writeFileSync(path, [HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", "utf8");
console.log(`jury/export.csv — ${rows.length} team${rows.length === 1 ? "" : "s"}${order ? "" : " (no order drawn yet; re-export after the draw)"}`);

// RFC 4180: quote when the value contains a comma, a quote, or a line break; escape quotes by doubling.
function cell(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
