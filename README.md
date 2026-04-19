# job-search-agent

A personal job-search assistant that runs entirely on your own laptop.
Every morning and evening it scrapes fresh job postings from a dozen
sources, reads them against your resume with an LLM, and shows you the
best matches first. It also helps you edit your resume, tailor it per
job, and draft cover letters on demand — but it never hits Submit for you.

**Who this is for:** anyone doing a focused job hunt who wants their feed
actually ranked — not the chronological firehose you get on Indeed or
LinkedIn. Works for software, healthcare, law, design, trades, academia,
or anything else: you tell it your keywords and upload your resume, and
the LLM does the rest.

**License:** [PolyForm Noncommercial 1.0.0](LICENSE) — free for personal,
hobby, academic, and nonprofit use. See [NOTICE](NOTICE) for a plain-English
summary. Commercial use requires a separate license — open an issue to
discuss.

---

## What it does

```
 ┌──────────── you ────────────┐         ┌─────────── LLM ───────────┐
 │  upload resume              │         │  • classify each new job  │
 │  set SEARCH_KEYWORDS        │         │  • score it 0-10 against  │
 │  review ranked feed         │         │    your profile           │
 │  tailor resume per job      │         │  • draft cover letters    │
 │  click "draft cover letter" │         │  • coach resume edits     │
 │  apply (Chrome extension    │         │                           │
 │   autofills, you Submit)    │         │                           │
 └──────────────┬──────────────┘         └─────────────┬─────────────┘
                │                                      │
                ▼                                      ▼
        ┌──────────────── Postgres + pgvector ─────────────┐
        │  jobs · job_classifications · resume_versions    │
        │  editor_state · applications · sources           │
        └──────────────────────────┬───────────────────────┘
                                   │
                                   ▼
              ┌──── Scrapers (7 AM + 7 PM daily) ────┐
              │  JobSpy (Indeed, LinkedIn, Google,   │
              │          Glassdoor, ZipRecruiter)    │
              │  USAJobs · Adzuna · Remotive         │
              │  Greenhouse / Lever / Ashby boards   │
              └──────────────────────────────────────┘
```

**The ranking (`fit_score` 0-100)** blends three signals:

| Weight | Signal | What it captures |
|---|---|---|
| **50%** | Cosine similarity between the job's embedding and your resume's embedding | "Does this posting read like a job your resume describes?" |
| **30%** | LLM rating 0-10 of how well the job fits the target profile you configured | Catches structural mismatches that pure semantic similarity misses (wrong seniority, wrong geography) |
| **20%** | Location bonus — 1.0 if remote or your city, 0.75 on state match, 0.5 otherwise | Tilts the feed toward jobs you can realistically take |

Activating a new resume re-ranks every job in the database in a single
SQL update (~1 second even at 10k+ rows) — no LLM calls needed, because
the LLM rating is cached per job.

---

## Quick start

You need **Docker Desktop**. That's it — no Python, Node, pnpm, or
Postgres on your host. One compose file boots the entire stack.

```bash
# 1. Clone
git clone https://github.com/joshstubble/job-search-agent.git
cd job-search-agent

# 2. Secrets + search config
cp .env.example .env
$EDITOR .env    # see "Configure" below

# 3. Boot everything
make up

# 4. Wait for the dashboard to come up (~60s first time while it compiles)
make logs-dashboard    # ctrl-C when you see "Ready in X ms"
```

Open http://127.0.0.1:3000 → upload your resume at `/resume` →
activate it → wait for the first 7am/7pm cycle, or kick one off
manually:

```bash
make scrape      # pulls fresh jobs from every enabled source
make classify    # LLM reads each new job, embeds it, scores it
```

Reload http://127.0.0.1:3000 — your feed is now sorted by best match.

### Configure

The only file you need to edit is `.env`. Minimum:

```bash
OPENROUTER_API_KEY=sk-or-v1-...          # https://openrouter.ai (required)
SEARCH_KEYWORDS=software engineer,backend,python
SEARCH_LOCATION=San Francisco, CA         # blank = remote-only is fine
SEARCH_DISTANCE_MI=50
```

Optional but recommended — these hint the LLM classifier toward your
situation so it doesn't have to guess from your resume alone:

```bash
TARGET_FIELD=backend engineering
TARGET_SENIORITY=mid-to-senior
TARGET_PROFILE_NOTES=5 years Python/Django; open to staff+; no management roles.
```

Two more free-tier API keys let more scrapers work — skip these and
those sources simply disable themselves:

```bash
# USAJobs (federal). Free. Register at developer.usajobs.gov.
USAJOBS_API_KEY=...
USAJOBS_EMAIL=your@email.tld

# Adzuna aggregator. Free tier = 1,000 req/day.
ADZUNA_APP_ID=...
ADZUNA_APP_KEY=...
```

---

## A day in the life

1. **7 AM / 7 PM**: the `scraper` container pulls every enabled source;
   10 minutes later the `classifier` LLM-reads + embeds + scores every
   new posting. Both schedules are America/New_York; change in
   `docker-compose.yml` if you're elsewhere.
2. **You open http://127.0.0.1:3000**: the feed is pre-sorted by
   `fit_score`. Hover a card to preview, click to open the full JD.
3. **On a job detail page** you can:
   - **Draft a cover letter** — Gemini 3.1 Pro drafts ~300 words
     referencing the posting. You review/edit; it never sends.
   - **Tailor your resume** — rewrites your active resume to lead with
     the bullets that match this job, without inventing anything.
     Saved as a new inactive version so you can compare.
   - **Mark status** — interested / applied / interview / offer /
     rejected / withdrawn. Appears on `/pipeline` as a Kanban.
4. **Open `/resume/edit`** to improve your resume in a canvas-style
   editor (left side is your draft, right side is a coach chatting with
   you). The coach can see your top-ranked jobs and suggest edits
   grounded in what those postings actually say, not generic advice.
   When you like a rewrite, click **Save + Activate + Re-rank** —
   every job is re-scored against the new version.
5. **Export** — the editor can render your resume in any of 6
   [JSON Resume](https://jsonresume.org) themes as HTML or PDF (even,
   kendall, macchiato, stackoverflow, onepage-plus, flat).

---

## The resume coach

Open `/resume/edit`. The editor has two panes:

- **Left:** your resume as plain text. Autosaves on every keystroke.
- **Right:** chat with a Gemini 3.1 Pro coach.

The coach can see your current draft *and* your top-ranked jobs. When
you ask for a rewrite, it streams the new version **directly into the
left pane, live** (Canvas-style). A green banner afterward lets you
**undo** or **view the diff**.

Four tools the coach can call:

| Tool | What it does |
|---|---|
| `keyword_gap` | Terms common in your top jobs that are missing from your draft |
| `score_against` | Embeds a proposed rewrite, reports fit_score delta vs your top 10 |
| `discipline_distribution` | What specialties dominate your ranked feed |
| `remember` | Saves a durable fact about you that survives future sessions |

Things you can say:

- "Open the conversation" (it'll interview you first)
- "What terms am I missing from my top-10 jobs?"
- "Rewrite my summary to emphasize backend experience"
- "Remember: I'm only open to fully remote"
- "Does this proposed version score higher than my current one?"
- "Which disciplines dominate my top 50 jobs?"

Everything — your chat history, the working draft, "remembered" facts
— persists in Postgres. Close the tab, come back tomorrow, pick up
exactly where you were.

---

## What's under the hood

All services run from `docker-compose.yml`. `make help` lists the
shortcuts; common ones:

| Command | Does |
|---|---|
| `make up` / `make down` | Boot / stop the stack |
| `make ps` / `make logs` | See status / tail all logs |
| `make logs-<service>` | Tail one service |
| `make psql` | Open a psql shell in the running Postgres |
| `make migrate` | Apply any pending SQL migrations |
| `make scrape` | Run a one-shot scrape now |
| `make classify ARGS='--limit 50'` | Classify + score 50 unscored jobs |
| `make reset` | **Wipe** the DB volume (asks for confirmation) |

### Services

| Service | Container | Purpose |
|---|---|---|
| **postgres** | `pgvector/pgvector:pg16` | Jobs + classifications + resumes + chat state |
| **dbmate** | `ghcr.io/amacneil/dbmate` | Runs once on boot to apply SQL migrations |
| **scraper** | Python | Pulls from JobSpy / ATS / USAJobs / Adzuna / Remotive; runs via ofelia |
| **classifier** | Python + OpenAI Agents SDK | LLM-classifies / embeds / scores / drafts; runs via ofelia |
| **dashboard** | Next.js 16 + React 19 | The UI at `127.0.0.1:3000` |
| **ofelia** | `mcuadros/ofelia` | Cron daemon that exec's scraper + classifier on schedule |
| **pgadmin** | `dpage/pgadmin4` (dev profile) | Browser-based Postgres inspector at `127.0.0.1:5050` |

### Costs

For a single user doing ~1000 jobs/day through the pipeline:

- **OpenRouter** — ~$0.50–3/month total (classifier + scorer use
  Gemini 3 Flash Preview which is cheap; drafter + resume coach use
  Gemini 3.1 Pro only when you click "draft" or chat).
- **Postgres / Docker / everything else** — free (local).
- **Job-board APIs** — all free tiers.

### Deeper dives

- [CLAUDE.md](CLAUDE.md) — project constitution (hard constraints,
  AI-assistant rules-of-the-road)
- [infra/migrations/](infra/migrations/) — the full schema, annotated
- [dashboard/AGENTS.md](dashboard/AGENTS.md) — "this is not the Next.js
  your training data knows"
- [classifier/run.py](classifier/run.py) — `--reclassify`,
  `--skip-embed`, `--draft-above-score N`, `--rescore-components`

---

## Making it yours

Everything generic lives in env vars; everything opinionated lives in
your resume. Two places you might want to customize in code:

1. **[scraper/adapters/ats_direct.py](scraper/adapters/ats_direct.py)
   `BOARDS`** — list of Greenhouse / Lever / Ashby company boards to
   poll. The seed list is tech-heavy; replace with companies in your
   target industry. Each takes one line.

2. **[classifier/llm_agents.py](classifier/llm_agents.py)
   `_CLASSIFIER_INSTRUCTIONS`** — the prompt that turns postings into
   structured records. The generic version works for most fields; if
   you want bespoke seniority buckets (e.g. `resident` / `attending`
   for medicine, `postdoc` / `tt-faculty` for academia), edit
   `Seniority` in [classifier/schema.py](classifier/schema.py) and
   update the prompt to match.

Neither is required to get value — the out-of-the-box defaults work.

---

## Hard constraints

These aren't configurable — they're baked into the design. See
[CLAUDE.md](CLAUDE.md) for the full list.

- **No auto-submit**, ever. The Chrome extension autofills forms but
  never clicks Submit. You review, you submit.
- **Single-user**, localhost only. No auth; no multi-user. Use
  Tailscale + Caddy if you want remote access.
- **No secrets in the repo.** `.env` is gitignored.
- **Dedupe on `hash(title + company + location)`.** Repeat scrapes
  refresh `last_seen_at`, never insert duplicates.

---

## Roadmap

- **M5** — Chrome MV3 extension (`apply-helper/extension/`):
  fetches the per-job draft from the dashboard, autofills Greenhouse /
  Lever / Workday forms, leaves Submit to you.
- **M7** (optional) — Stagehand-based apply agent for harder ATS
  flows, under the `apply-v2` compose profile.
- **M8** (optional) — Hetzner deploy behind Tailscale + Caddy
  basic-auth, `hetzner` compose profile.

---

## Known quirks

- **First dashboard boot is slow** (~60s). Turbopack compiles on first
  request.
- **JobSpy Glassdoor** throws 400s intermittently — JobSpy's problem,
  kept enabled since it sometimes works.
- **Remotive category slugs have drifted**, so the adapter fetches all
  jobs and filters by title. If you don't set `SEARCH_KEYWORDS`, every
  Remotive posting flows in.
- **Dashboard has no auth.** It binds to `127.0.0.1:3000`, which is
  already private on your machine. Don't expose it publicly without
  adding auth.

---

## License

[PolyForm Noncommercial 1.0.0](LICENSE). See [NOTICE](NOTICE) for a
plain-English summary. If you want a commercial license, open a GitHub
issue.

## Credits

Built on [Next.js](https://nextjs.org), [pgvector](https://github.com/pgvector/pgvector),
[JobSpy](https://github.com/Bunsly/JobSpy), [JSON Resume](https://jsonresume.org),
[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/),
[OpenRouter](https://openrouter.ai), [shadcn/ui](https://ui.shadcn.com),
[puppeteer-core](https://pptr.dev), [ofelia](https://github.com/mcuadros/ofelia),
and [dbmate](https://github.com/amacneil/dbmate). Thanks to all of them.
