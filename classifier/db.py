"""Postgres access for the classifier pipeline.

Reuses the `job_classifications` / `jobs` / `resume_versions` tables from the
M1 migration. Embeddings are written through a string cast (`$1::vector`) so
we don't need the extra `pgvector` Python package.
"""
from __future__ import annotations

import logging
import os
from typing import Any

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
            name="classifier",
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def fetch_unclassified(limit: int | None = None) -> list[dict[str, Any]]:
    """Jobs that don't yet have a row in job_classifications."""
    sql = """
        SELECT j.id, j.title, j.company, j.location, j.description, j.url,
               j.source, j.salary_min, j.salary_max, j.remote_type
        FROM jobs j
        LEFT JOIN job_classifications c ON c.job_id = j.id
        WHERE c.job_id IS NULL
        ORDER BY j.id
    """
    params: tuple = ()
    if limit is not None:
        sql += " LIMIT %s"
        params = (limit,)
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_all_jobs(limit: int | None = None) -> list[dict[str, Any]]:
    """Every job, regardless of classification state. Most-recent first so
    that a --reclassify --limit N pass operates on the N freshest postings.
    save_classification() upserts on job_id, so re-runs overwrite."""
    sql = """
        SELECT j.id, j.title, j.company, j.location, j.description, j.url,
               j.source, j.salary_min, j.salary_max, j.remote_type
        FROM jobs j
        ORDER BY j.last_seen_at DESC, j.id DESC
    """
    params: tuple = ()
    if limit is not None:
        sql += " LIMIT %s"
        params = (limit,)
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_for_drafting(min_fit_score: float, limit: int | None = None) -> list[dict[str, Any]]:
    """Classified jobs above `min_fit_score` that don't yet have a cover-letter draft."""
    sql = """
        SELECT j.id, j.title, j.company, j.location, j.description, j.url,
               j.source, c.seniority, c.discipline, c.jd_summary, c.fit_score
        FROM jobs j
        JOIN job_classifications c ON c.job_id = j.id
        WHERE c.llm_cover_letter_draft IS NULL
          AND c.fit_score IS NOT NULL
          AND c.fit_score >= %s
        ORDER BY c.fit_score DESC
    """
    params: tuple = (min_fit_score,)
    if limit is not None:
        sql += " LIMIT %s"
        params = (min_fit_score, limit)
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_needs_rescore(limit: int | None = None) -> list[dict[str, Any]]:
    """Classified rows missing llm_match — used for the score-components backfill
    after the 20260418150000 migration added the column."""
    sql = """
        SELECT j.id, j.title, j.company, j.location, j.description,
               c.seniority, c.discipline, c.remote, c.jd_summary
        FROM jobs j
        JOIN job_classifications c ON c.job_id = j.id
        WHERE c.llm_match IS NULL
        ORDER BY j.id
    """
    params: tuple = ()
    if limit is not None:
        sql += " LIMIT %s"
        params = (limit,)
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def fit_score_histogram() -> list[tuple[int, int]]:
    """Return [(bucket_low, count), ...] in 10-point buckets 0-100."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT floor(fit_score / 10) * 10 AS bucket, count(*)
            FROM job_classifications
            WHERE fit_score IS NOT NULL
            GROUP BY bucket
            ORDER BY bucket
        """)
        return [(int(b), int(c)) for b, c in cur.fetchall()]


def get_active_resume_embedding() -> list[float] | None:
    """Return the embedding of the currently active resume, or None if no resume yet."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT embedding FROM resume_versions
            WHERE is_active = true AND embedding IS NOT NULL
            LIMIT 1
        """)
        row = cur.fetchone()
        if not row or row[0] is None:
            return None
        # psycopg returns vector as a string like '[0.1,0.2,...]'
        s = row[0]
        if isinstance(s, str):
            s = s.strip("[]")
            return [float(x) for x in s.split(",")] if s else None
        return list(s)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

_INSERT_CLASSIFICATION_SQL = """
INSERT INTO job_classifications (
    job_id, seniority, discipline, remote, years_required,
    salary_range, jd_summary, llm_model
) VALUES (
    %(job_id)s, %(seniority)s, %(discipline)s, %(remote)s, %(years_required)s,
    %(salary_range)s, %(jd_summary)s, %(llm_model)s
)
ON CONFLICT (job_id) DO UPDATE SET
    seniority       = EXCLUDED.seniority,
    discipline   = EXCLUDED.discipline,
    remote          = EXCLUDED.remote,
    years_required  = EXCLUDED.years_required,
    salary_range    = EXCLUDED.salary_range,
    jd_summary      = EXCLUDED.jd_summary,
    llm_model       = EXCLUDED.llm_model,
    classified_at   = now()
"""


def save_classification(job_id: int, clf: dict[str, Any], model: str) -> None:
    """Insert-or-update the classifications row. The `remote` column in the schema is
    a boolean, but Pydantic gives us {'remote','hybrid','onsite','unknown'} — we map."""
    remote_str = clf.get("remote") or "unknown"
    remote_bool = True if remote_str == "remote" else False if remote_str == "onsite" else None
    params = {
        "job_id": job_id,
        "seniority": clf.get("seniority"),
        "discipline": clf.get("discipline"),
        "remote": remote_bool,
        "years_required": clf.get("years_required"),
        "salary_range": clf.get("salary_range"),
        "jd_summary": clf.get("jd_summary"),
        "llm_model": model,
    }
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(_INSERT_CLASSIFICATION_SQL, params)


def save_embedding(job_id: int, embedding: list[float]) -> None:
    literal = "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE job_classifications SET embedding = %s::vector WHERE job_id = %s",
            (literal, job_id),
        )


def save_fit_score(
    job_id: int,
    fit_score: float,
    *,
    llm_match: int | None = None,
    location_bonus: float | None = None,
) -> None:
    """Save the final fit_score plus its two stable components so a future re-rank
    against a new resume can recompute fit_score with only a cosine lookup."""
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE job_classifications
                  SET fit_score       = %s,
                      llm_match       = COALESCE(%s, llm_match),
                      location_bonus = COALESCE(%s, location_bonus)
                WHERE job_id = %s""",
            (round(fit_score, 2), llm_match, location_bonus, job_id),
        )


def save_draft(job_id: int, draft_text: str) -> None:
    with get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE job_classifications
               SET llm_cover_letter_draft = %s,
                   draft_updated_at = now()
               WHERE job_id = %s""",
            (draft_text, job_id),
        )
