# CLAUDE.md — Project Constitution

This file is the **constitution** for this project. Update sparingly —
changes should encode a real rule of the road, not a passing preference.

---

## Core directives

### 1. Always use context7 for third-party knowledge

Before writing or advising on code that touches **any** third-party library,
framework, SDK, API, CLI, or cloud service, call
`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`. This
applies even to libraries you think you know (React, Next.js, Postgres,
pgvector, OpenAI Agents SDK, JobSpy, Stagehand, Playwright, Tailwind,
shadcn/ui, OpenRouter, `postgres.js`, `psycopg`, etc.) — training data may
be stale.

Do **not** use context7 for: refactors, business logic, general programming
concepts, or code written from scratch with no third-party surface area.

### 2. Use the other attached MCPs to execute what context7 tells you

Context7 returns the *how*; MCPs do the *doing*. Map the task to the right
server:

- **Postgres** — use `psql` via Bash against the local container
  (`make psql`). No Supabase MCP: we run plain `pgvector/pgvector:pg16`.
- **Chrome / Computer-use** (`mcp__Claude_in_Chrome__*`,
  `mcp__computer-use__*`) — for testing the Chrome extension, Stagehand
  flows, and any ATS form-automation work.
- **Scheduled tasks** (`mcp__scheduled-tasks__*`) — useful during
  development before ofelia is wired up in compose.
- **Memory** (`mcp__memory__*`) — persistent graph memory for entities like
  companies, sources, job statuses when useful.
- **MCP registry** (`mcp__mcp-registry__*`) — if a task needs a capability
  not covered here, search for an MCP first before writing glue code.

### 3. Update this file sparingly

Add a rule here only when it's load-bearing for future sessions — a hard
constraint, a compliance boundary, a learned-the-hard-way lesson. Do **not**
log progress, TODOs, or per-task notes here; those belong in the issue,
commits, or plan files.

---

## Project context

**Goal:** A generic, single-user, local-first job-search pipeline. Scrapes
→ classifies → ranks → assists with applications, tuned to the user's own
resume. Works for any industry (software, healthcare, law, product, design,
academia, trades, etc.) — domain-specific behavior lives in env vars and
the user's resume embedding, not in the code.

**Repo layout:**
```
scraper/       Python. JobSpy + direct ATS APIs + USAJobs + Adzuna + Remotive → Postgres.
classifier/    Python. OpenAI Agents SDK → OpenRouter classifies, embeds, scores.
dashboard/     Next.js 16 + shadcn/ui + postgres.js. Single-user, localhost-bound.
apply-helper/  Chrome MV3 extension (phase A); Stagehand local mode (phase B).
infra/         docker-compose.yml, SQL migrations, .env templates.
```

**Stack pins** (all in containers — see host-deps constraint below):
Python 3.12, Node 20 + pnpm, Next.js 16 (App Router), Postgres 16 +
pgvector (`pgvector/pgvector:pg16`), OpenAI Agents SDK (Python),
`postgres.js`, `psycopg[binary,pool]`, OpenRouter, JobSpy. Everything runs
from one root `docker-compose.yml`.

**Budget:** $0–10/month. Free tiers only unless escalation is justified.

---

## Hard constraints — do not cross

- **No auto-submit on applications, ever.** Bot-submitted job applications
  risk misrepresentation under many professional rules (legal, medical,
  financial, federal), and generally violate ATS terms of service regardless
  of industry. Every final Submit is a human click. The apply helper is
  **assisted-apply only** — it fills in your draft, then waits for you.
- **Off-target roles hidden by default.** The feed defaults to hiding rows
  classified as `non_target`; users can opt in via the Seniority filter.
- **No secrets in the repo.** All keys live in `.env` (gitignored). Use
  `.env.example` for shape.
- **Dedupe key is `hash(title + company + location)`.** Repeat pulls update
  `last_seen_at`, never insert duplicates.
- **Single-user auth.** 127.0.0.1-bound locally (no auth); Tailscale +
  Caddy basic-auth on Hetzner. No multi-tenant complexity.
- **HITL via Agents SDK, not ad-hoc.** Anywhere human approval gates an
  action (application submit, outbound email), use
  `@function_tool(needs_approval=True)` and surface
  `result.interruptions` — don't invent bespoke approval flows.
- **Cover-letter drafts are user-initiated, per job.** Never batch-draft
  across the feed. User flow is: upload resume → LLM-assisted resume edits
  → re-rank jobs against the polished resume → user picks from the ranked
  list → per-job "draft" click generates a cover letter → extension
  autofills the application → user reviews and clicks Submit.
  Batch-drafting is dead spend because the user, not the scorer, makes the
  final apply call.
- **All services run under `docker-compose.yml`. Host deps: Docker Desktop
  + Chrome only.** Never `brew install python` / `node` / `pnpm` /
  `postgres`. Every dev command — scaffolding, `pnpm add`, `pip install`,
  tests, migrations, one-offs — dispatches through
  `docker compose run --rm <service>` or
  `docker run --rm -v $(pwd):/work -w /work <image>`. Chrome is the one
  exception (browser extensions unavoidably run in a browser).

---

## License

PolyForm Noncommercial 1.0.0 — see [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE). Personal / hobby / academic / nonprofit use is fine;
any commercial use (selling, reselling, hosting for a fee, embedding in a
paid product) requires a separate license. Open an issue on GitHub if you
want to discuss commercial terms.
