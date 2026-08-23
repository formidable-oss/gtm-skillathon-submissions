You are scoring one GTM Skillathon submission for the jury. You are in the repository root of the submitted commit. Read `submission.json`, `DEMO.md`, every `SKILL.md` listed in `submission.json`, `demo/seed-prompt.md`, the input, the fallback output, and `demo/evals.md`. Read files; do not run the skill.

Score each criterion from 1 to 5. Be strict and consistent: 3 is "adequate, nothing missing, nothing remarkable". Give 5 only when every element in the description is present and specific. Give 1 when the element is absent or fabricated. Every rationale cites a file path.

**GTM job clarity** — 5: `DEMO.md` names one user role at one kind of company, one real problem, one narrow job, and one explicit boundary, and the skill does exactly that job. 3: the job is clear but the user or boundary is vague. 1: generic ("helps sales teams"), several jobs, or no boundary.

**Real-world signal** — 5: the output is grounded in live or genuinely sourced public web data; every claim carries a source URL and retrieval date; cached data is labeled as such; the input is real public data with provenance. 3: sources exist but are incomplete or undated. 1: no sources, invented sources, or cached output described as live.

**Evidence** — 5: `demo/evals.md` has three distinguishable cases (intended; insufficient evidence; failure, exclusion, or safety), each with an observed result, an honest pass/fail, and an evidence path that exists and supports the judgment; failures are recorded as failures. 3: three cases but thin observations or missing evidence paths. 1: placeholders, cases that are not distinguishable, or results that look written before the run.

**Skill quality** — 5: `SKILL.md` has a description that says what it does and when to trigger; imperative steps with explicit input, output path and shape, provenance requirements, behavior on missing evidence, refusals, and a completion criterion; no dead or duplicate skills; the seed prompt works cold. 3: steps are clear but failure behavior or completion is missing. 1: prose without steps, or several overlapping skills.

**Reusability** — 5: the skill would work unchanged on another input of the same kind; inputs are parameterized, not hard-coded; limitations are stated honestly. 3: it would work with small edits. 1: it only works on the committed example.

Gates: flag fabrication when eval results, fallback output, sources, or dates are inconsistent with the repository (for example, an output file older than the input it claims to use, sources that do not exist, identical text across "observed" results). Flag personal data when the repository contains names, emails, or profiles of private individuals without documented permission. Flag needs-credentials when the seed prompt cannot produce a meaningful result without an API key, MCP server, or login and there is no committed fallback that carries the demo.

Write the one-liner as the jury will hear it: "<skill> turns <input> into <artifact> for <user>."
