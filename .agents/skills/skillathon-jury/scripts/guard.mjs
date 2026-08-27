#!/usr/bin/env node
// Deterministic anti-gaming scan of the whole clone at the accepted SHA. Writes
// runs/<slug>/guard.json: { sha, scanned_at, findings: [{ kind, path, line?, excerpt }] }.
// Findings are leads for the jury and for the scoring prompt; the scan never fails a team.
// Incremental by SHA.
//
// Usage: node guard.mjs [--force] [--only=slug1,slug2]

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, runDir, readJson, writeJson, sh, args, submissions } from "./common.mjs";

const { force, only } = args();

// Line-level patterns. `when` restricts a pattern to some file kinds; default is any text file.
const PATTERNS = [
  { kind: "grader_text", re: /\bignore\s+(?:the\s+|all\s+)?(?:previous|prior|above|earlier)\b/i },
  { kind: "grader_text", re: /\byou\s+are\s+(?:a|the)\s+(?:judge|jury|juror|grader|scorer|evaluator)\b/i },
  { kind: "grader_text", re: /\bscore\s+(?:this|it|us)\s+(?:a\s+)?(?:5|five|highest|max)/i },
  { kind: "grader_text", re: /\b(?:rubric|scoring model|system prompt|scoring criteria)\b/i },
  { kind: "grader_text", re: /\b(?:jury|criteria)\b/i },
  { kind: "grader_text", re: /^\s*assistant\s*:/i },
  { kind: "hidden_text", re: /<!--/, when: (p) => /\.(md|markdown|html?)$/i.test(p) },
  { kind: "hidden_text", re: /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/ },
  { kind: "hidden_text", re: /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|color\s*:\s*#?(?:fff(?:fff)?|white)\b/i, when: (p) => /\.(html?|css|md)$/i.test(p) },
  { kind: "large_blob", re: /[A-Za-z0-9+/]{500,}={0,2}/ },
];

const TEXT_EXT = /\.(md|markdown|txt|json|jsonc|ya?ml|toml|csv|tsv|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|sql|xml|ini|cfg|env\.example)$/i;
const ALLOWED = [/^\.agents\/skills\//, /^demo\//, /^README\.md$/, /^DEMO\.md$/, /^LICENSE$/, /^\.gitignore$/, /^submission\.json$/];
const MAX_PER_KIND_PER_FILE = 3;
// Quoting context: the starter's own docs legitimately talk about the rubric and the jury.
const QUOTING = /^(?:RULES\.md|AGENTS\.md|CLAUDE\.md|\.agents\/skills\/skillathon-(?:guide|submit)\/)/;

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const rulesCriteria = loadRulesCriteria();
const list = submissions({ only });

for (const s of list) {
  const dir = runDir(s.slug);
  const repo = join(dir, "repo");
  const prior = readJson(join(dir, "guard.json"));
  if (!force && prior && prior.sha === s.sha) { console.log(`  = ${s.slug}: ${prior.findings.length} finding${prior.findings.length === 1 ? "" : "s"}`); continue; }
  if (!existsSync(repo)) { console.log(`  - ${s.slug}: no clone`); continue; }

  const findings = [];
  const add = (kind, path, line, excerpt) => findings.push({ kind, path, ...(line ? { line } : {}), excerpt: String(excerpt).trim().slice(0, 200) });
  const files = trackedFiles(repo);
  const manifest = s.manifest ?? readJson(join(repo, "submission.json"), {});
  const declared = declaredPaths(manifest);

  for (const file of files) {
    let size = 0;
    try { size = statSync(join(repo, file)).size; } catch { continue; }
    if (TEXT_EXT.test(file) && size > 1024 * 1024) add("large_blob", file, null, `${(size / 1048576).toFixed(1)} MB text file`);
    if (!declared.has(file) && !ALLOWED.some((re) => re.test(file))) add("undeclared_files", file, null, "outside the declared paths and the standard layout");
    if (size > 4 * 1024 * 1024 || !TEXT_EXT.test(file)) continue;
    let text;
    try { text = readFileSync(join(repo, file), "utf8"); } catch { continue; }
    const counts = new Map();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const seenKinds = new Set(); // one finding per kind per line, however many patterns match
      for (const { kind, re, when } of PATTERNS) {
        if (seenKinds.has(kind)) continue;
        if (kind === "grader_text" && QUOTING.test(file)) continue;
        if (when && !when(file)) continue;
        if (!re.test(lines[i])) continue;
        const n = counts.get(kind) ?? 0;
        if (n >= MAX_PER_KIND_PER_FILE) continue;
        counts.set(kind, n + 1);
        seenKinds.add(kind);
        add(kind, file, i + 1, lines[i]);
      }
    }
  }

  evalClones(repo, manifest, add);
  timeParadox(repo, manifest, add);
  rubricEcho(repo, manifest, add);

  writeJson(join(dir, "guard.json"), { sha: s.sha, scanned_at: new Date().toISOString(), findings });
  const kinds = [...new Set(findings.map((f) => f.kind))];
  console.log(`  ${findings.length ? "⚑" : "✓"} ${s.slug.padEnd(32)} ${findings.length} finding${findings.length === 1 ? "" : "s"}${kinds.length ? ` (${kinds.join(", ")})` : ""}`);
}

// ---- checks --------------------------------------------------------------------------

// Two or more "observed" cells in demo/evals.md that are identical or >90% similar: the cases
// were probably not run separately.
function evalClones(repo, manifest, add) {
  const rel = manifest.evals ?? "demo/evals.md";
  const text = readIf(join(repo, rel));
  if (!text) return;
  const cells = observedCells(text);
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const sim = similarity(cells[i].text, cells[j].text);
      if (sim < 0.9) continue;
      add("eval_clone", rel, cells[j].line, `${(sim * 100).toFixed(0)}% similar to the observed cell on line ${cells[i].line}: ${cells[j].text}`);
    }
  }
}

function observedCells(text) {
  const lines = text.split("\n");
  const out = [];
  let col = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("|")) { col = -1; continue; }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (col === -1) { col = cells.findIndex((c) => /observ|result|output/i.test(c)); continue; }
    if (/^-{2,}$/.test(cells[0]?.replace(/[\s:]/g, "") ?? "")) continue;
    const cell = cells[col];
    if (cell && cell.replace(/\W/g, "").length >= 12) out.push({ line: i + 1, text: cell });
  }
  return out;
}

// An evidence or output file whose last commit predates the last commit of the input it claims to
// use. Depth-1 clones put everything in one commit, so this only fires on deeper histories.
function timeParadox(repo, manifest, add) {
  const inputs = expand(repo, manifest.input);
  if (!inputs.length) return;
  const inputTime = Math.max(...inputs.map((p) => commitTime(repo, p)).filter(Boolean));
  if (!Number.isFinite(inputTime) || inputTime <= 0) return;
  for (const path of [...expand(repo, manifest.output), ...expand(repo, manifest.evals)]) {
    const t = commitTime(repo, path);
    if (t && t < inputTime) add("time_paradox", path, null, `last commit ${new Date(t * 1000).toISOString()} predates the input's ${new Date(inputTime * 1000).toISOString()}`);
  }
}

function commitTime(repo, path) { return Number(sh("git", ["-C", repo, "log", "-1", "--format=%ct", "--", path]).out) || 0; }

// DEMO.md echoing the criteria table back at the grader is not evidence.
function rubricEcho(repo, manifest, add) {
  if (!rulesCriteria.size) return;
  const rel = manifest.run_sheet ?? "DEMO.md";
  const text = readIf(join(repo, rel));
  if (!text) return;
  const words = normalize(text).split(" ").filter(Boolean);
  const hits = [];
  for (let i = 0; i + 6 <= words.length; i++) {
    const phrase = words.slice(i, i + 6).join(" ");
    if (!rulesCriteria.has(phrase)) continue;
    hits.push(phrase);
    i += 5;
  }
  if (hits.length >= 3) add("rubric_echo", rel, null, `${hits.length} verbatim phrases from the RULES.md criteria table: "${hits.slice(0, 3).join('", "')}"`);
}

// ---- helpers -------------------------------------------------------------------------

function trackedFiles(repo) {
  const r = sh("git", ["-C", repo, "ls-files", "-z"]);
  return r.ok ? r.out.split("\0").filter(Boolean) : [];
}

function declaredPaths(manifest) {
  const paths = [manifest.entry_skill, manifest.seed_prompt, manifest.input, manifest.output, manifest.evals, manifest.run_sheet, ...(manifest.skills ?? []).map((s) => s?.path)];
  return new Set(paths.filter((p) => typeof p === "string" && p).map((p) => p.replace(/\/+$/, "")));
}

// A declared path that is a directory expands to the files inside it.
function expand(repo, rel) {
  if (typeof rel !== "string" || !rel) return [];
  const clean = rel.replace(/\/+$/, "");
  const abs = join(repo, clean);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [clean];
  return trackedFiles(repo).filter((f) => f.startsWith(`${clean}/`));
}

function readIf(p) { return existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : ""; }

// Dice coefficient over character bigrams: cheap, order-insensitive enough for near-duplicates.
function similarity(a, b) {
  const A = normalize(a); const B = normalize(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(A); const gb = grams(B);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (A.length - 1 + B.length - 1);
}

// The criteria table lives in the starter repository's RULES.md (canonical). Checked out next to
// this repository at the event; override with SKILLATHON_RULES. Missing file: check is skipped.
function loadRulesCriteria() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.SKILLATHON_RULES, resolve(ROOT, "../gtm-skillathon-starter/RULES.md"), join(ROOT, "RULES.md"), resolve(here, "../references/RULES.md")].filter(Boolean);
  const path = candidates.find((p) => existsSync(p));
  if (!path) return new Set();
  const text = readFileSync(path, "utf8");
  const section = /###\s+Automated scores([\s\S]*?)(?=\n###\s|\n##\s|$)/.exec(text)?.[1] ?? "";
  const grams = new Set();
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    for (const cell of line.split("|").slice(1, -1)) {
      const words = normalize(cell).split(" ").filter(Boolean);
      for (let i = 0; i + 6 <= words.length; i++) grams.add(words.slice(i, i + 6).join(" "));
    }
  }
  return grams;
}
