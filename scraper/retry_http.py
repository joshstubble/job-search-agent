"""Retry-aware HTTP GET with exponential backoff + jitter.

Used by the direct-HTTP adapters (Adzuna, USAJobs, ATS direct, Remotive, etc.)
so a transient 429 / 5xx / network blip during the 7am/7pm scrape doesn't skip
a full day of a source.

Retryable:
  - ConnectionError / Timeout    (network-level)
  - 429 Too Many Requests        (honors Retry-After if present)
  - 5xx server errors

NOT retryable:
  - 4xx client errors other than 429 (our bug or auth problem — no sense retrying)

The helper returns the `requests.Response` on success (raise_for_status() called
by default). On exhausted retries or non-retryable failure, it raises the same
`requests.RequestException` subclasses the caller would get from `requests.get`,
so existing try/except blocks in adapters keep working unchanged.
"""
from __future__ import annotations

import logging
import random
import time
from typing import Any

import requests

log = logging.getLogger("scraper.http")

DEFAULT_TIMEOUT = 30
DEFAULT_MAX_RETRIES = 3
_BACKOFF_BASE = 1.8   # 1.8^n seconds, n = attempt number (1-based)
_BACKOFF_CAP = 30.0   # never sleep longer than 30s


def _delay_for(attempt: int, retry_after: float | None) -> float:
    """Compute backoff delay in seconds. Honors Retry-After when present, else
    exponential with ±20% jitter to avoid thundering-herd on concurrent clients."""
    if retry_after is not None:
        return min(retry_after, _BACKOFF_CAP)
    base = min(_BACKOFF_BASE ** attempt, _BACKOFF_CAP)
    return base * (0.8 + 0.4 * random.random())


def _parse_retry_after(r: requests.Response) -> float | None:
    ra = r.headers.get("Retry-After")
    if not ra:
        return None
    try:
        return float(ra)
    except ValueError:
        # Could be an HTTP-date — we don't bother parsing, fall back to backoff.
        return None


def get_with_retry(
    url: str,
    *,
    params: Any = None,
    headers: Any = None,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    raise_for_status: bool = True,
    allow_redirects: bool = True,
) -> requests.Response:
    """GET with retries. See module docstring for retry rules."""
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            r = requests.get(
                url,
                params=params,
                headers=headers,
                timeout=timeout,
                allow_redirects=allow_redirects,
            )
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt >= max_retries:
                raise
            delay = _delay_for(attempt + 1, None)
            log.warning(
                "GET %s failed (%s); retry %d/%d in %.1fs",
                url, type(e).__name__, attempt + 1, max_retries, delay,
            )
            time.sleep(delay)
            continue

        if r.status_code == 429 or 500 <= r.status_code < 600:
            if attempt >= max_retries:
                if raise_for_status:
                    r.raise_for_status()
                return r
            delay = _delay_for(attempt + 1, _parse_retry_after(r))
            log.warning(
                "GET %s -> %d; retry %d/%d in %.1fs",
                url, r.status_code, attempt + 1, max_retries, delay,
            )
            time.sleep(delay)
            continue

        if raise_for_status:
            r.raise_for_status()
        return r

    # Loop always either returns or raises, but keep the type-checker calm.
    if last_exc:
        raise last_exc
    raise RuntimeError(f"GET {url} exhausted retries without a response")
