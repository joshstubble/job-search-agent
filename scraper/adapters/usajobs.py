"""USAJobs.gov adapter.

Docs: https://developer.usajobs.gov/api-reference/get-api-search
Auth: Authorization-Key header (API key) + User-Agent header (registered email).
Returns: SearchResult.SearchResultItems[].MatchedObjectDescriptor{...}
"""
from __future__ import annotations

import logging
import os
from typing import Any, Iterator

import requests

from retry_http import get_with_retry

log = logging.getLogger(__name__)

_BASE = "https://data.usajobs.gov/api/search"
_TIMEOUT = 30
_PER_PAGE = 100  # API max per page


def _default_keyword() -> str:
    """USAJobs accepts a single free-text Keyword. Use the first comma-separated
    token from SEARCH_KEYWORDS."""
    raw = (os.environ.get("SEARCH_KEYWORDS") or "").strip()
    return raw.split(",", 1)[0].strip() if raw else ""


def iter_jobs(
    keyword: str | None = None,
    location: str | None = None,
    radius: int | None = None,
    max_pages: int = 5,
) -> Iterator[dict[str, Any]]:
    api_key = os.environ.get("USAJOBS_API_KEY") or ""
    email = os.environ.get("USAJOBS_EMAIL") or ""
    if not api_key or not email:
        log.warning("usajobs: USAJOBS_API_KEY or USAJOBS_EMAIL missing; skipping")
        return

    keyword = keyword if keyword is not None else _default_keyword()
    if not keyword:
        log.warning("usajobs: no search keyword (set SEARCH_KEYWORDS); skipping")
        return

    location = location or os.environ.get("SEARCH_LOCATION", "")
    radius = radius if radius is not None else int(os.environ.get("SEARCH_DISTANCE_MI", "200"))

    headers = {
        "Host": "data.usajobs.gov",
        "User-Agent": email,
        "Authorization-Key": api_key,
    }

    for page in range(1, max_pages + 1):
        params = {
            "Keyword": keyword,
            "LocationName": location,
            "Radius": str(radius),
            "ResultsPerPage": str(_PER_PAGE),
            "Page": str(page),
        }
        try:
            r = get_with_retry(_BASE, params=params, headers=headers, timeout=_TIMEOUT)
        except requests.RequestException as e:
            log.warning("usajobs page %d: %s", page, e)
            return

        data = r.json().get("SearchResult") or {}
        items = data.get("SearchResultItems") or []
        log.info("usajobs page %d: %d items (total %s)", page, len(items), data.get("SearchResultCountAll"))
        if not items:
            return
        for item in items:
            mo = item.get("MatchedObjectDescriptor") or {}
            yield _map(mo)
        if len(items) < _PER_PAGE:
            return


def _map(mo: dict[str, Any]) -> dict[str, Any]:
    # Salary: take the first PositionRemuneration entry (annual / hourly).
    rem = (mo.get("PositionRemuneration") or [{}])[0]
    salary_min = _to_int(rem.get("MinimumRange"))
    salary_max = _to_int(rem.get("MaximumRange"))

    # Location: a free-form display string; API also has PositionLocation[] with city/state.
    locs = mo.get("PositionLocation") or []
    loc_str = mo.get("PositionLocationDisplay") or ", ".join(
        filter(None, (l.get("LocationName") for l in locs))
    )

    org = mo.get("OrganizationName") or mo.get("DepartmentName") or ""

    return {
        "source": "usajobs",
        "source_job_id": mo.get("PositionID") or mo.get("MatchedObjectId"),
        "url": mo.get("PositionURI"),
        "title": mo.get("PositionTitle") or "",
        "company": org,
        "location": loc_str,
        "description": (mo.get("UserArea") or {}).get("Details", {}).get("JobSummary")
                        or mo.get("QualificationSummary"),
        "posted_at": mo.get("PositionStartDate"),
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": rem.get("RateIntervalCode") and "USD" or None,
        "remote_type": None,
        "raw": mo,
    }


def _to_int(x: Any) -> int | None:
    if x is None:
        return None
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None
