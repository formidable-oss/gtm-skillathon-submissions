// Shared helpers for the submission system. Zero dependencies, Node >= 18.

export const SUBMISSIONS_REPO = process.env.GITHUB_REPOSITORY ?? "formidable-oss/gtm-skillathon-submissions";
export const TEMPLATE_REPO = "formidable-oss/gtm-skillathon-starter";
export const VALIDATOR_URL = `https://raw.githubusercontent.com/${TEMPLATE_REPO}/main/.agents/skills/skillathon-submit/scripts/validate.mjs`;
export const OPEN_AT = "2026-08-28T15:00:00Z"; // 18:00 Europe/Bucharest
export const CLOSE_AT = "2026-08-28T17:30:00Z"; // 20:30 Europe/Bucharest
export const TRACKS = [
  "ai-search-optimization",
  "personalized-growth-engines",
  "churn-detection",
  "synthetic-buyer-simulations",
  "plg-automation",
  "multi-agent-orchestration",
  "custom",
];
export const VERDICTS = ["accepted", "rejected", "superseded", "late", "dry-run"];
export const RECORD_MARK = "<!-- skillathon-record";

const token = process.env.GITHUB_TOKEN;

export async function gh(path, { method = "GET", body, raw = false } = {}) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gtm-skillathon",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status} ${data?.message ?? ""}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export async function ghAll(path) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

// Issue-form bodies render as "### Label\n\nvalue" blocks. gh-created bodies use the same shape.
export function parseIssueBody(body = "") {
  const fields = {};
  const re = /^###\s+(.+?)\s*\r?\n+([\s\S]*?)(?=^###\s|\s*$)/gm;
  let m;
  while ((m = re.exec(body))) {
    const value = m[2].trim().replace(/^_No response_$/i, "");
    fields[m[1].trim().toLowerCase()] = value;
  }
  return {
    team: fields["team name"] ?? "",
    members: (fields["members"] ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    track: fields["track"] ?? "",
    repoUrl: fields["repository url"] ?? "",
    sha: (fields["commit sha"] ?? "").trim(),
  };
}

export function parseRepoUrl(url) {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2], full: `${m[1]}/${m[2]}` } : null;
}

export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
}

// The canonical record of a submission is a JSON block inside the bot's verdict comment.
// Participants can edit issue bodies; they cannot edit bot comments.
export function encodeRecord(record) {
  return `${RECORD_MARK}\n${JSON.stringify(record)}\n-->`;
}

export function decodeRecord(commentBody = "") {
  const i = commentBody.indexOf(RECORD_MARK);
  if (i < 0) return null;
  const start = commentBody.indexOf("\n", i) + 1;
  const end = commentBody.indexOf("\n-->", start);
  try { return JSON.parse(commentBody.slice(start, end)); } catch { return null; }
}

export function localTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Returns the bot's record for every issue that has one, newest first.
export async function loadRecords() {
  const issues = await ghAll(`/repos/${SUBMISSIONS_REPO}/issues?state=all&sort=created&direction=desc`);
  const records = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const comments = issue.comments > 0 ? await ghAll(`/repos/${SUBMISSIONS_REPO}/issues/${issue.number}/comments`) : [];
    const botComments = comments.filter((c) => c.user?.type === "Bot" || c.user?.login === "github-actions[bot]");
    let record = null;
    for (const c of botComments) record = decodeRecord(c.body) ?? record;
    if (!record) continue;
    const labels = issue.labels.map((l) => l.name);
    record.current = VERDICTS.find((v) => labels.includes(v)) ?? record.verdict;
    record.state = issue.state;
    records.push(record);
  }
  return records;
}
