"""Direct ATS polling: Greenhouse, Lever, Ashby.

Each platform exposes a public, unauthenticated JSON board per company. We hit
those endpoints and yield only postings whose title contains one of the
configured keywords — the pre-filter keeps noise out of the DB. The classifier
does the real seniority and discipline work later.

Configuration:
  - SEARCH_KEYWORDS env var (comma-separated) drives the title filter. If the
    env var is empty / unset, every posting is yielded (no filter).
  - BOARDS list below is a starting set of well-known companies. Edit it for
    your target industry. Unknown tokens 404 gracefully and we move on.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Iterator

import requests

from retry_http import get_with_retry

log = logging.getLogger(__name__)

_TIMEOUT = 20


def _build_title_re() -> re.Pattern[str] | None:
    """Compile SEARCH_KEYWORDS into a case-insensitive \\b-word-boundary regex.
    Returns None if the env var is empty, meaning 'yield everything'."""
    raw = (os.environ.get("SEARCH_KEYWORDS") or "").strip()
    if not raw:
        return None
    tokens = [re.escape(t.strip()) for t in raw.split(",") if t.strip()]
    if not tokens:
        return None
    return re.compile(r"\b(" + "|".join(tokens) + r")\b", re.IGNORECASE)


_TITLE_RE = _build_title_re()


# (platform, board_token). Platforms: "greenhouse", "lever", "ashby".
# Tune for your target industry — this is a generic "known ATS users" seed.
BOARDS: list[tuple[str, str]] = [
    # Greenhouse
    ("greenhouse", "stripe"),
    ("greenhouse", "notion"),
    ("greenhouse", "airtable"),
    ("greenhouse", "databricks"),
    ("greenhouse", "plaid"),
    ("greenhouse", "cloudflare"),
    ("greenhouse", "datadog"),
    ("greenhouse", "dropbox"),
    ("greenhouse", "anthropic"),
    ("greenhouse", "squarespace"),
    ("greenhouse", "robinhood"),
    ("greenhouse", "benchling"),
    ("greenhouse", "discord"),
    ("greenhouse", "figma"),
    ("greenhouse", "gitlab"),
    # Lever
    ("lever", "netflix"),
    ("lever", "github"),
    ("lever", "palantir"),
    ("lever", "cruise"),
    ("lever", "kraken"),
    ("lever", "ro"),
    ("lever", "attentive"),
    # Ashby
    ("ashby", "ramp"),
    ("ashby", "linear"),
    ("ashby", "openai"),
    ("ashby", "vercel"),
    ("ashby", "retool"),
    ("ashby", "posthog"),
    ("ashby", "neon"),
    ("ashby", "modal"),
]


# ----- Greenhouse -----------------------------------------------------------

def _fetch_greenhouse(token: str) -> list[dict[str, Any]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    # 404 is an expected signal (board deleted / renamed) — raise_for_status=False
    # so the helper doesn't turn it into an exception. Retry still applies to 5xx/429.
    r = get_with_retry(url, timeout=_TIMEOUT, raise_for_status=False)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json().get("jobs") or []


def _map_greenhouse(token: str, job: dict[str, Any]) -> dict[str, Any]:
    loc = (job.get("location") or {}).get("name") or ""
    # Greenhouse `content` is HTML — leave raw, classifier/dashboard handle rendering.
    return {
        "source": "ats_greenhouse",
        "source_job_id": str(job.get("id")),
        "url": job.get("absolute_url"),
        "title": job.get("title") or "",
        "company": token,
        "location": loc,
        "description": job.get("content"),
        "posted_at": job.get("updated_at"),
        "raw": {"board": token, **job},
    }


# ----- Lever -----------------------------------------------------------------

def _fetch_lever(token: str) -> list[dict[str, Any]]:
    url = f"https://api.lever.co/v0/postings/{token}?mode=json"
    r = get_with_retry(url, timeout=_TIMEOUT, raise_for_status=False)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json() or []


def _map_lever(token: str, job: dict[str, Any]) -> dict[str, Any]:
    cats = job.get("categories") or {}
    return {
        "source": "ats_lever",
        "source_job_id": job.get("id"),
        "url": job.get("hostedUrl"),
        "title": job.get("text") or "",
        "company": token,
        "location": cats.get("location") or "",
        "description": job.get("descriptionPlain") or job.get("description"),
        "posted_at": job.get("createdAt"),  # epoch ms — we store as-is and normalize later
        "raw": {"board": token, **job},
    }


# ----- Ashby -----------------------------------------------------------------

def _fetch_ashby(token: str) -> list[dict[str, Any]]:
    url = f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true"
    r = get_with_retry(url, timeout=_TIMEOUT, raise_for_status=False)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json().get("jobs") or []


def _map_ashby(token: str, job: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "ats_ashby",
        "source_job_id": job.get("id"),
        "url": job.get("jobUrl"),
        "title": job.get("title") or "",
        "company": token,
        "location": job.get("locationName") or "",
        "description": job.get("descriptionPlain") or job.get("descriptionHtml"),
        "posted_at": job.get("publishedAt"),
        "raw": {"board": token, **job},
    }


_PLATFORMS = {
    "greenhouse": (_fetch_greenhouse, _map_greenhouse),
    "lever": (_fetch_lever, _map_lever),
    "ashby": (_fetch_ashby, _map_ashby),
}


# ----- Public ---------------------------------------------------------------

def iter_jobs(boards: list[tuple[str, str]] | None = None) -> Iterator[dict[str, Any]]:
    boards = boards or BOARDS
    totals: dict[str, int] = {}
    for platform, token in boards:
        if platform not in _PLATFORMS:
            log.warning("ats: unknown platform %r for token %r", platform, token)
            continue
        fetch, mapper = _PLATFORMS[platform]
        try:
            raw_jobs = fetch(token)
        except requests.HTTPError as e:
            log.warning("ats %s/%s: %s", platform, token, e)
            continue
        except requests.RequestException as e:
            log.warning("ats %s/%s: request failed: %s", platform, token, e)
            continue
        matched = 0
        for j in raw_jobs:
            job = mapper(token, j)
            title = job.get("title") or ""
            if _TITLE_RE is None or _TITLE_RE.search(title):
                matched += 1
                yield job
        totals[f"{platform}:{token}"] = matched
        if matched:
            log.info("ats %s/%s: %d title matches (of %d total)", platform, token, matched, len(raw_jobs))

    matched_total = sum(totals.values())
    log.info("ats: %d total title matches across %d boards", matched_total, len(boards))
