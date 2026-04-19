"""JobSpy adapter: scrapes Indeed, Google Jobs, Glassdoor, ZipRecruiter, (LinkedIn).

Returns an iterator of job dicts in the shape `db.upsert_job` expects.
"""
from __future__ import annotations

import logging
import math
import os
from datetime import date, datetime
from typing import Any, Iterator

import pandas as pd
from jobspy import scrape_jobs

log = logging.getLogger(__name__)

# JobSpy's `site` column values → our internal source names.
_SITE_TO_SOURCE = {
    "indeed": "jobspy_indeed",
    "google": "jobspy_google",
    "glassdoor": "jobspy_glassdoor",
    "zip_recruiter": "jobspy_zip",
    "linkedin": "jobspy_linkedin",
}

# Bundle used when no explicit sites= filter is passed. Originally LinkedIn was
# excluded here as "rate-limits hard without proxies" — live testing 2026-04-18
# showed it actually returns results, so it's in.
DEFAULT_SITES = ["indeed", "linkedin", "google", "glassdoor", "zip_recruiter"]


def _jsonify(v: Any) -> Any:
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return v.isoformat()
    # NaN / NaT survives df.where(pd.notnull,…) in object columns; kill it here
    # or Postgres rejects the JSON.
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _to_int(x: Any) -> int | None:
    if x is None:
        return None
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def _default_search_term() -> str:
    """Build a JobSpy search_term from SEARCH_KEYWORDS (comma-separated).
    Falls back to an empty string if unset — JobSpy treats "" as "any job."""
    raw = (os.environ.get("SEARCH_KEYWORDS") or "").strip()
    if not raw:
        return ""
    tokens = [t.strip() for t in raw.split(",") if t.strip()]
    return " OR ".join(tokens)


def iter_jobs(
    sites: list[str] | None = None,
    search_term: str | None = None,
    location: str | None = None,
    distance_mi: int | None = None,
    results_wanted: int = 200,
    hours_old: int | None = None,
) -> Iterator[dict[str, Any]]:
    sites = sites or DEFAULT_SITES
    search_term = search_term if search_term is not None else _default_search_term()
    location = location or os.environ.get("SEARCH_LOCATION", "")
    distance = distance_mi if distance_mi is not None else int(os.environ.get("SEARCH_DISTANCE_MI", "200"))

    log.info("jobspy: sites=%s location=%r distance=%s results_wanted=%s",
             sites, location, distance, results_wanted)

    df = scrape_jobs(
        site_name=sites,
        search_term=search_term,
        google_search_term=f"{search_term} jobs near {location}",
        location=location,
        distance=distance,
        results_wanted=results_wanted,
        hours_old=hours_old,
        country_indeed="USA",
    )
    if df is None or df.empty:
        log.info("jobspy: 0 rows returned")
        return

    # Replace NaN/NaT with None so downstream dict handling is clean.
    df = df.where(pd.notnull(df), None)

    for row in df.to_dict(orient="records"):
        site = row.get("site")
        source = _SITE_TO_SOURCE.get(site, f"jobspy_{site}")
        yield {
            "source": source,
            "source_job_id": row.get("id"),
            "url": row.get("job_url") or row.get("job_url_direct"),
            "title": row.get("title") or "",
            "company": row.get("company") or "",
            "location": row.get("location") or "",
            "description": row.get("description"),
            "posted_at": row.get("date_posted"),
            "salary_min": _to_int(row.get("min_amount")),
            "salary_max": _to_int(row.get("max_amount")),
            "salary_currency": row.get("currency"),
            "remote_type": "remote" if row.get("is_remote") else None,
            "raw": {k: _jsonify(v) for k, v in row.items()},
        }
