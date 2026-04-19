"""Remotive adapter — remote jobs from remotive.com.

Free public API: https://remotive.com/api/remote-jobs
Category slugs have been unstable, so we fetch everything and title-filter on
the user's SEARCH_KEYWORDS (see ats_direct.py for the same convention). If
SEARCH_KEYWORDS is empty, every posting is yielded.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Iterator

import requests

from retry_http import get_with_retry

log = logging.getLogger(__name__)

_URL = "https://remotive.com/api/remote-jobs"
_TIMEOUT = 30


def _build_title_re() -> re.Pattern[str] | None:
    raw = (os.environ.get("SEARCH_KEYWORDS") or "").strip()
    if not raw:
        return None
    tokens = [re.escape(t.strip()) for t in raw.split(",") if t.strip()]
    if not tokens:
        return None
    return re.compile(r"\b(" + "|".join(tokens) + r")\b", re.IGNORECASE)


_TITLE_RE = _build_title_re()


def iter_jobs() -> Iterator[dict[str, Any]]:
    try:
        r = get_with_retry(_URL, timeout=_TIMEOUT)
    except requests.RequestException as e:
        log.warning("remotive: %s", e)
        return
    jobs = (r.json() or {}).get("jobs") or []
    matched = 0
    for j in jobs:
        hay = f"{j.get('title') or ''} {j.get('category') or ''}"
        if _TITLE_RE is None or _TITLE_RE.search(hay):
            matched += 1
            yield _map(j)
    log.info("remotive: %d title matches (of %d total)", matched, len(jobs))


def _map(j: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "remotive",
        "source_job_id": str(j.get("id")),
        "url": j.get("url"),
        "title": j.get("title") or "",
        "company": j.get("company_name") or "",
        "location": j.get("candidate_required_location") or "Remote",
        "description": j.get("description"),
        "posted_at": j.get("publication_date"),
        "salary_min": None,
        "salary_max": None,
        "salary_currency": None,
        "remote_type": "remote",
        "raw": j,
    }
