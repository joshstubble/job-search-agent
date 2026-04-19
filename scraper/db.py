"""Postgres access for the scraper.

- Singleton psycopg 3 ConnectionPool reused across all source adapters.
- `upsert_job()` is the single write path: first pull inserts; re-pulls bump
  `last_seen_at` and refresh description/salary. Dedupe is by hash(title+company+location),
  enforced by a UNIQUE constraint in the schema.
- `seed_sources()` populates `sources` with every adapter name on first run.
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any, Iterable

from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

log = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=DATABASE_URL,
            min_size=1,
            max_size=4,
            open=True,
            name="scraper",
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def dedupe_hash(title: str, company: str, location: str) -> str:
    """Stable dedupe key: hash(title|company|location), case/space-normalized."""
    normalized = f"{(title or '').strip().lower()}|{(company or '').strip().lower()}|{(location or '').strip().lower()}"
    return hashlib.sha256(normalized.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Sources table — one row per adapter. Seeded on init so FK in jobs.source works.
# ---------------------------------------------------------------------------

SOURCE_NAMES: list[str] = [
    "jobspy_indeed",
    "jobspy_google",
    "jobspy_glassdoor",
    "jobspy_zip",
    "jobspy_linkedin",
    "usajobs",
    "adzuna",
    "remotive",
    "ats_greenhouse",
    "ats_lever",
    "ats_ashby",
]


def seed_sources() -> None:
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO sources (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            [(n,) for n in SOURCE_NAMES],
        )


def enabled_source_names() -> set[str]:
    """Names of sources currently enabled in the DB. The dashboard's /settings
    page is the source of truth; run.py filters adapters to this set."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM sources WHERE enabled = true")
        return {row[0] for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Job upsert
# ---------------------------------------------------------------------------

_UPSERT_JOB_SQL = """
INSERT INTO jobs (
    dedupe_hash, source, source_job_id, url, title, company, location,
    description, posted_at, salary_min, salary_max, salary_currency, remote_type, raw
) VALUES (
    %(dedupe_hash)s, %(source)s, %(source_job_id)s, %(url)s, %(title)s,
    %(company)s, %(location)s, %(description)s, %(posted_at)s,
    %(salary_min)s, %(salary_max)s, %(salary_currency)s, %(remote_type)s, %(raw)s
)
ON CONFLICT (dedupe_hash) DO UPDATE SET
    last_seen_at    = now(),
    description     = COALESCE(EXCLUDED.description, jobs.description),
    posted_at       = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
    salary_min      = COALESCE(EXCLUDED.salary_min, jobs.salary_min),
    salary_max      = COALESCE(EXCLUDED.salary_max, jobs.salary_max),
    salary_currency = COALESCE(EXCLUDED.salary_currency, jobs.salary_currency),
    remote_type     = COALESCE(EXCLUDED.remote_type, jobs.remote_type),
    url             = COALESCE(EXCLUDED.url, jobs.url),
    raw             = EXCLUDED.raw
RETURNING (xmax = 0) AS inserted
"""


def _normalize_posted_at(v: Any) -> Any:
    """Accepts None / datetime / date / ISO string / epoch seconds / epoch millis.
    Returns something psycopg can coerce to timestamptz (datetime or ISO str) — or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        # Lever returns epoch millis. Heuristic: >1e10 means ms.
        try:
            secs = v / 1000.0 if v > 1e10 else float(v)
            return datetime.fromtimestamp(secs, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    return v


def _job_params(job: dict[str, Any]) -> dict[str, Any] | None:
    """Build the parameter dict for _UPSERT_JOB_SQL. Returns None if the row
    is missing the minimum required fields (title, company) — caller skips it."""
    title = (job.get("title") or "").strip()
    company = (job.get("company") or "").strip()
    location = (job.get("location") or "").strip()
    if not title or not company:
        return None
    return {
        "dedupe_hash": dedupe_hash(title, company, location),
        "source": job["source"],
        "source_job_id": job.get("source_job_id"),
        "url": job.get("url"),
        "title": title,
        "company": company,
        "location": location,
        "description": job.get("description"),
        "posted_at": _normalize_posted_at(job.get("posted_at")),
        "salary_min": job.get("salary_min"),
        "salary_max": job.get("salary_max"),
        "salary_currency": job.get("salary_currency"),
        "remote_type": job.get("remote_type"),
        "raw": Jsonb(job.get("raw") or {}),
    }


def upsert_job(job: dict[str, Any]) -> bool | None:
    """Insert-or-mark-seen. Returns True if inserted, False if updated, None if skipped."""
    params = _job_params(job)
    if params is None:
        return None
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(_UPSERT_JOB_SQL, params)
        row = cur.fetchone()
        return bool(row[0]) if row else False


def upsert_many(jobs: Iterable[dict[str, Any]]) -> tuple[int, int, int]:
    """Batch upsert. Returns (inserted, updated, skipped)."""
    inserted = updated = skipped = 0
    with get_pool().connection() as conn, conn.cursor() as cur:
        for job in jobs:
            params = _job_params(job)
            if params is None:
                skipped += 1
                continue
            cur.execute(_UPSERT_JOB_SQL, params)
            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1
    return inserted, updated, skipped


def mark_seen(dedupe: str) -> bool:
    """Bump last_seen_at for a job already in the DB. Returns True if a row matched."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE jobs SET last_seen_at = now() WHERE dedupe_hash = %s", (dedupe,))
        return cur.rowcount > 0


def mark_source_run(source: str, *, success: bool, error: str | None = None) -> None:
    """Record a scrape attempt for a source. Called by run.py after each adapter runs."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sources SET
                last_run_at     = now(),
                last_success_at = CASE WHEN %(ok)s THEN now() ELSE last_success_at END,
                last_error      = CASE WHEN %(ok)s THEN NULL ELSE %(err)s END
            WHERE name = %(name)s
            """,
            {"ok": success, "err": error, "name": source},
        )
