#!/usr/bin/env node
// Builds the jury artifacts from runs/: jury/scoreboard.md, jury/scoreboard.csv,
// jury/runbook.md, jury/board.html. Reads hand-filled jury/jury-scores.csv (created on first run)
// for presentation, vibe, and overrides.
//
// Usage: node report.mjs [--final]   (--final ranks by total instead of presentation order)

import { join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JURY, runDir, readJson, readText, args, submissions, CRITERIA, JURY_COLUMNS, localTime, fmtMs } from "./common.mjs";

const { flags } = args();
const final = flags.has("--final");
const order = readJson(join(JURY, "order.json"));
const position = new Map((order?.order ?? []).map((o) => [o.slug, o.position]));

// ---- jury-scores.csv: create or merge ----------------------------------------------
const csvPath = join(JURY, "jury-scores.csv");
const overrideCols = CRITERIA.map(([k]) => `override_${k}`);
const header = ["slug", "team", ...JURY_COLUMNS, ...overrideCols, "note"];
const existing = new Map();
if (existsSync(csvPath)) {
  const [cols, ...records] = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
  if (!cols?.includes("slug")) { console.error(`${csvPath} has no slug column; refusing to overwrite it. Fix the header or move the file.`); process.exit(1); }
  for (const cells of records) { const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])); if (row.slug) existing.set(row.slug, row); }
}
const list = submissions();
const rows = list.map((s) => ({ ...Object.fromEntries(header.map((c) => [c, ""])), ...(existing.get(s.slug) ?? {}), slug: s.slug, team: s.team }));
// Keep hand-entered rows for teams not in this run (for example a transient clone failure).
for (const [slug, row] of existing) if (!rows.some((r) => r.slug === slug)) rows.push({ ...Object.fromEntries(header.map((c) => [c, ""])), ...row });
writeFileSync(csvPath, [header.join(","), ...rows.map((r) => header.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n");

// ---- assemble -----------------------------------------------------------------------
const teams = list.map((s) => {
  const dir = runDir(s.slug);
  const validation = readJson(join(dir, "validate.json"), { ok: false, errors: [], warnings: [] });
  const smoke = readJson(join(dir, "smoke.json"));
  const scores = readJson(join(dir, "scores.json"));
  const jury = rows.find((r) => r.slug === s.slug) ?? {};

  const gates = [];
  if (!validation.ok) gates.push(`structure (${validation.errors.length} errors)`);
  const runs = !smoke ? "not run" : smoke.status === "pass" ? "pass" : smoke.status === "timeout" && smoke.fallback_present ? "timeout+fallback" : smoke.status;
  if (smoke && runs !== "pass" && runs !== "timeout+fallback") gates.push(`runs (${runs})`);
  if (scores?.gates?.personal_data) gates.push("personal data");
  if (scores?.gates?.needs_credentials && !(smoke?.fallback_present)) gates.push("needs credentials");
  const flagsOut = [];
  if (scores?.gates?.fabrication_suspected) flagsOut.push("fabrication?");
  if (scores?.gates?.needs_credentials) flagsOut.push("needs creds");
  if (validation.warnings?.length) flagsOut.push(`${validation.warnings.length} warn`);
  if (runs === "timeout+fallback") flagsOut.push("timeout, fallback");

  const auto = {};
  for (const [k] of CRITERIA) {
    const override = jury[`override_${k}`];
    auto[k] = override !== "" && override != null ? Number(override) : scores?.[k]?.score ?? null;
  }
  const autoTotal = Object.values(auto).every((v) => v != null) ? Object.values(auto).reduce((a, b) => a + b, 0) : null;
  const juryVals = Object.fromEntries(JURY_COLUMNS.map((c) => [c, jury[c] !== "" && jury[c] != null ? Number(jury[c]) : null]));
  const juryTotal = Object.values(juryVals).every((v) => v != null) ? Object.values(juryVals).reduce((a, b) => a + b, 0) : null;
  const total = autoTotal != null && juryTotal != null ? autoTotal + juryTotal : null;
  return { s, validation, smoke, scores, jury, gates, runs, flags: flagsOut, auto, autoTotal, juryVals, juryTotal, total, ranked: gates.length === 0, position: position.get(s.slug) ?? null };
});

const sorted = teams.slice().sort((a, b) => {
  if (final) return (b.ranked - a.ranked) || ((b.total ?? -1) - (a.total ?? -1)) || ((b.autoTotal ?? -1) - (a.autoTotal ?? -1));
  return ((a.position ?? 1e9) - (b.position ?? 1e9)) || (Date.parse(a.s.submitted_at) - Date.parse(b.s.submitted_at));
});

// ---- scoreboard.md / .csv -----------------------------------------------------------
const n = (v) => (v == null ? "" : String(v));
const mdHead = ["#", "Team", "Track", "Gates", ...CRITERIA.map(([, l]) => l.split(" ")[0]), "Auto /25", ...JURY_COLUMNS.map((c) => c[0].toUpperCase() + c.slice(1)), "Total /35", "Flags"];
const md = [
  `# Scoreboard${final ? " — final" : ""}`, ``,
  `Generated ${localTime(new Date().toISOString())} · ${teams.length} accepted · ${teams.filter((t) => t.ranked).length} ranked · ${order ? `order seed \`${order.seed}\`` : "no order drawn yet"}`, ``,
  `Automated scores are Codex proposals (see \`runs/<slug>/scores.json\` for rationales). Fill **Presentation** and **Vibe** in \`jury/jury-scores.csv\`, overrides in the \`override_*\` columns, then rerun \`node report.mjs --final\`.`, ``,
  `| ${mdHead.join(" | ")} |`, `| ${mdHead.map(() => "---").join(" | ")} |`,
  ...sorted.map((t, i) => `| ${final ? (t.ranked ? i + 1 : "—") : n(t.position) || "·"} | **${t.s.team}** | \`${t.s.track}\` | ${t.gates.length ? `❌ ${t.gates.join(", ")}` : "✅"} | ${CRITERIA.map(([k]) => n(t.auto[k])).join(" | ")} | ${n(t.autoTotal)} | ${JURY_COLUMNS.map((c) => n(t.juryVals[c])).join(" | ")} | ${t.total != null ? `**${t.total}**` : ""} | ${t.flags.join(", ")} |`),
  ``,
].join("\n");
writeFileSync(join(JURY, "scoreboard.md"), md);
const csvHead = ["position", "slug", "team", "members", "track", "repo_url", "sha", "submitted_at", "ranked", "gates", ...CRITERIA.map(([k]) => k), "auto_total", ...JURY_COLUMNS, "total", "flags", "runs", "smoke_seconds"];
writeFileSync(join(JURY, "scoreboard.csv"), [csvHead.join(","), ...sorted.map((t) => [
  t.position, t.s.slug, t.s.team, t.s.members.join("; "), t.s.track, t.s.repo_url, t.s.sha, t.s.submitted_at, t.ranked, t.gates.join("; "),
  ...CRITERIA.map(([k]) => t.auto[k]), t.autoTotal, ...JURY_COLUMNS.map((c) => t.juryVals[c]), t.total, t.flags.join("; "), t.runs, t.smoke ? (t.smoke.duration_ms / 1000).toFixed(0) : "",
].map(csvCell).join(","))].join("\n") + "\n");

// ---- runbook.md ---------------------------------------------------------------------
const rb = [`# Runbook`, ``, `One section per team in presentation order. Open the folder in the Codex app, paste the seed prompt, follow the run sheet. 2:00 target, 2:30 hard stop.`, ``];
for (const t of sorted) {
  const dir = runDir(t.s.slug);
  const repo = resolve(dir, "repo");
  const demo = readText(join(repo, t.s.manifest?.run_sheet ?? "DEMO.md")).replace(/^# .*\n/, "").trim();
  rb.push(
    `---`, ``, `## ${t.position ? `${t.position}. ` : ""}${t.s.team} — \`${t.s.track}\``, ``,
    `${t.s.members.join(", ")} · ${t.s.repo_url} @ \`${t.s.sha.slice(0, 7)}\` · submitted ${localTime(t.s.submitted_at)}`, ``,
    t.scores?.one_liner ? `> ${t.scores.one_liner}` : "", ``,
    `**Open:** \`${repo}\``, ``,
    `**Seed prompt:**`, ``, "```text", t.s.seed_prompt, "```", ``,
    `**Fallback:** \`${t.s.manifest?.output ?? "—"}\``, ``,
    `**Smoke:** ${t.smoke ? `${t.smoke.status} in ${fmtMs(t.smoke.duration_ms)}${t.smoke.changed_files?.length ? `, wrote ${t.smoke.changed_files.slice(0, 5).join(", ")}` : ", no files written"}` : "not run"}${t.gates.length ? ` · **GATED: ${t.gates.join(", ")}**` : ""}${t.flags.length ? ` · flags: ${t.flags.join(", ")}` : ""}`, ``,
    t.scores ? `**Auto:** ${CRITERIA.map(([k, l]) => `${l} ${t.auto[k]}`).join(" · ")} = ${t.autoTotal}/25` : "", ``,
    t.scores?.strongest ? `**Strongest:** ${t.scores.strongest}` : "", t.scores?.weakest ? `**Weakest:** ${t.scores.weakest}` : "", ``,
    `### Run sheet (from the team)`, ``, demo || "_No DEMO.md_", ``,
  );
}
writeFileSync(join(JURY, "runbook.md"), rb.filter((l) => l !== undefined).join("\n"));

// ---- board.html ---------------------------------------------------------------------
const data = sorted.map((t) => ({ position: t.position, team: t.s.team, members: t.s.members, track: t.s.track, one_liner: t.scores?.one_liner ?? t.s.problem ?? "", gates: t.gates, auto: t.auto, autoTotal: t.autoTotal, jury: t.juryVals, total: t.total, ranked: t.ranked, repo_url: t.s.repo_url }));
writeFileSync(join(JURY, "board.html"), boardHtml(data, final, order?.seed));
console.log(`jury/scoreboard.md, scoreboard.csv, runbook.md, board.html — ${teams.length} teams${final ? " (final ranking)" : ""}`);

// ---- helpers ------------------------------------------------------------------------
function csvCell(v) { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
// Quote-aware CSV parser over the whole text, so quoted newlines in notes survive.
function parseCsv(text) {
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}
function boardHtml(rowsData, isFinal, seed) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GTM Skillathon — ${isFinal ? "results" : "demos"}</title>
<style>
:root{--bg:#0b0c10;--fg:#f2f2f2;--muted:#8b949e;--yellow:#ffd23f;--green:#3fb950;--red:#f85149;--line:#21262d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 ui-monospace,Menlo,monospace}
header{display:flex;justify-content:space-between;align-items:baseline;padding:24px 40px 12px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:26px;letter-spacing:.08em;text-transform:uppercase}h1 b{color:var(--yellow)}
#timer{font-size:64px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}#timer.warn{color:var(--yellow)}#timer.over{color:var(--red)}
#now{padding:18px 40px;border-bottom:1px solid var(--line);display:flex;gap:24px;align-items:baseline}
#now .pos{font-size:48px;color:var(--yellow);font-weight:700}#now .team{font-size:32px;font-weight:700}#now .sub{color:var(--muted)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 24px 8px 0;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-weight:500}td:first-child,th:first-child{padding-left:40px}
tr.current td{background:rgba(255,210,63,.08)}tr.done td{color:var(--muted)}td.num{text-align:right}.gated{color:var(--red)}.total{font-weight:700;color:var(--green)}
footer{padding:14px 40px;color:var(--muted);font-size:13px}kbd{border:1px solid var(--line);padding:1px 6px;border-radius:4px}
</style></head><body>
<header><h1>GTM <b>Skillathon</b> · ${isFinal ? "results" : "demos"}</h1>${isFinal ? "" : '<div id="timer">2:00</div>'}</header>
${isFinal ? "" : '<div id="now"><span class="pos">—</span><div><div class="team">Press N to start</div><div class="sub"></div></div></div>'}
<table><thead><tr><th>#</th><th>Team</th><th>Track</th>${isFinal ? '<th class="num">Auto</th><th class="num">Pres</th><th class="num">Vibe</th><th class="num">Total</th>' : '<th class="num">Auto /25</th>'}<th>Gates</th></tr></thead>
<tbody>${rowsData.map((r, i) => `<tr data-i="${i}"><td>${isFinal ? (r.ranked ? i + 1 : "—") : r.position ?? "·"}</td><td><b>${esc(r.team)}</b> <span style="color:var(--muted)">· ${esc(r.members.join(", "))}</span></td><td>${esc(r.track)}</td>${isFinal ? `<td class="num">${r.autoTotal ?? ""}</td><td class="num">${r.jury.presentation ?? ""}</td><td class="num">${r.jury.vibe ?? ""}</td><td class="num total">${r.total ?? ""}</td>` : `<td class="num">${r.autoTotal ?? ""}</td>`}<td class="${r.gates.length ? "gated" : ""}">${r.gates.length ? esc(r.gates.join(", ")) : "✓"}</td></tr>`).join("")}</tbody></table>
<footer>${seed ? `Order seed <code>${esc(seed)}</code> · ` : ""}${isFinal ? "Final = automated (5 × 1–5) + presentation + vibe, max 35. Gated teams are not ranked." : "<kbd>N</kbd> next team and start timer · <kbd>Space</kbd> pause/resume · <kbd>R</kbd> reset timer · <kbd>P</kbd> previous. 2:00 target, 2:30 hard stop."}</footer>
${isFinal ? "" : `<script>
const rows=${JSON.stringify(rowsData.map((r) => ({ team: r.team, members: r.members, one_liner: r.one_liner, position: r.position })))};
let cur=-1,remaining=120,running=false,tick=null;
const el=(id)=>document.getElementById(id);
function render(){const t=el("timer");const m=Math.floor(Math.abs(remaining)/60),s=Math.abs(remaining)%60;t.textContent=(remaining<0?"-":"")+m+":"+String(s).padStart(2,"0");t.className=remaining<=-30?"over":remaining<=0?"warn":"";
document.querySelectorAll("tbody tr").forEach((tr,i)=>{tr.className=i===cur?"current":i<cur?"done":"";});
if(cur>=0){const r=rows[cur];document.querySelector("#now .pos").textContent=r.position??cur+1;document.querySelector("#now .team").textContent=r.team;document.querySelector("#now .sub").textContent=r.members.join(", ")+(r.one_liner?" — "+r.one_liner:"");document.querySelector("tr.current")?.scrollIntoView({block:"center"});}}
function start(){running=true;clearInterval(tick);tick=setInterval(()=>{remaining--;render();},1000);}
function pause(){running=false;clearInterval(tick);}
document.addEventListener("keydown",(e)=>{if(e.key==="n"||e.key==="N"){if(cur<rows.length-1)cur++;remaining=120;start();}
else if(e.key==="p"||e.key==="P"){if(cur>0)cur--;remaining=120;pause();}else if(e.key===" "){e.preventDefault();running?pause():start();}else if(e.key==="r"||e.key==="R"){remaining=120;pause();}render();});
render();
</script>`}
</body></html>`;
}
