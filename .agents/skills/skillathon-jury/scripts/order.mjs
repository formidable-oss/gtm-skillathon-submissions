#!/usr/bin/env node
// Draws the presentation order: a seeded shuffle of every accepted submission, so anyone can
// reproduce it from the seed. Writes jury/order.json and jury/order.md.
//
// Usage: node order.mjs --seed=<anything>   (say the seed out loud before drawing)

import { join } from "node:path";
import { createHash } from "node:crypto";
import { JURY, writeJson, args, submissions } from "./common.mjs";
import { writeFileSync } from "node:fs";

const { opts } = args();
if (!opts.seed) { console.error("Usage: node order.mjs --seed=<word or number announced on stage>"); process.exit(1); }

const list = submissions().slice().sort((a, b) => a.slug.localeCompare(b.slug));
// Sort by the hash of seed + slug: deterministic, auditable, independent of submission time.
const keyed = list.map((s) => ({ s, k: createHash("sha256").update(`${opts.seed}:${s.slug}`).digest("hex") })).sort((a, b) => a.k.localeCompare(b.k));
const order = keyed.map(({ s }, i) => ({ position: i + 1, slug: s.slug, team: s.team, track: s.track, repo_url: s.repo_url, sha: s.sha }));

writeJson(join(JURY, "order.json"), { seed: opts.seed, drawn_at: new Date().toISOString(), order });
writeFileSync(join(JURY, "order.md"), [
  `# Presentation order`, ``, `Seed: \`${opts.seed}\` · ${order.length} teams · 2 minutes each, 2:30 hard stop`, ``,
  `| # | Team | Track |`, `| --- | --- | --- |`,
  ...order.map((o) => `| ${o.position} | ${o.team} | \`${o.track}\` |`), ``,
].join("\n"));
for (const o of order) console.log(`${String(o.position).padStart(2)}. ${o.team}  (${o.track})`);
