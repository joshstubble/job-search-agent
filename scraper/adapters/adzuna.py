"""Adzuna adapter.

Docs: https://developer.adzuna.com/docs/search
Free tier: 1,000 requests/day. We request 50 results/page.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Iterator

import requests

from retry_http import get_with_retry

log = logging.getLogger(__name__)

_BASE = "https://api.adzuna.com/v1/api/jobs/us/search"
_TIMEOUT = 30
_PER_PAGE = 50


def _default_keyword() -> str:
    """Take the first comma-separated keyword from SEARCH_KEYWORDS. Adzuna's
    `what` param is a single free-text query; if the user has multiple
    keywords, the first one is the most specific starting point."""
    raw = (os.environ.get("SEARCH_KEYWORDS") or "").strip()
    return raw.split(",", 1)[0].strip() if raw else ""


def iter_jobs(
    what: str | None = None,
    where: str | None = None,
    distance: int | None = None,
    max_pages: int = 5,
) -> Iterator[dict[str, Any]]:
    app_id = os.environ.get("ADZUNA_APP_ID") or ""
    app_key = os.environ.get("ADZUNA_APP_KEY") or ""
    if not app_id or not app_key:
        log.warning("adzuna: ADZUNA_APP_ID or ADZUNA_APP_KEY missing; skipping")
        return

    what = what if what is not None else _default_keyword()
    if not what:
        log.warning("adzuna: no search keyword (set SEARCH_KEYWORDS); skipping")
        return

    where = where or os.environ.get("SEARCH_LOCATION", "")
    distance = distance if distance is not None else int(os.environ.get("SEARCH_DISTANCE_MI", "200"))

    for page in range(1, max_pages + 1):
        url = f"{_BASE}/{page}"
        params = {
            "app_id": app_id,
            "app_key": app_key,
            "what": what,
            "where": where,
            "distance": distance,
            "results_per_page": _PER_PAGE,
            "content-type": "application/json",
        }
        try:
            r = get_with_retry(url, params=params, timeout=_TIMEOUT)
        except requests.RequestException as e:
            log.warning("adzuna page %d: %s", page, e)
            return
        data = r.json()
        results = data.get("results") or []
        log.info("adzuna page %d: %d results (of %s total)", page, len(results), data.get("count"))
        if not results:
            return
        for j in results:
            yield _map(j)
        if len(results) < _PER_PAGE:
            return


def _map(j: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "adzuna",
        "source_job_id": str(j.get("id")) if j.get("id") is not None else None,
        "url": j.get("redirect_url"),
        "title": j.get("title") or "",
        "company": (j.get("company") or {}).get("display_name") or "",
        "location": (j.get("location") or {}).get("display_name") or "",
        "description": j.get("description"),
        "posted_at": j.get("created"),
        "salary_min": _to_int(j.get("salary_min")),
        "salary_max": _to_int(j.get("salary_max")),
        "salary_currency": "USD",
        "raw": j,
    }


def _to_int(x: Any) -> int | None:
    if x is None:
        return None
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None
