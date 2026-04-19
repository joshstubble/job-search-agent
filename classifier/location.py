"""Location-match bonus for the fit_score.

Generic, geography-agnostic: full credit if the job is remote, full credit if
the job's location string contains the user's `SEARCH_LOCATION` substring,
partial credit on a state/region token match, neutral otherwise. String
matching is enough for a single-user system — no geocoding dependency.
"""
from __future__ import annotations

import os
import re

_REMOTE_RE = re.compile(
    r"\b(remote|work[\s-]*from[\s-]*home|wfh|telework|telecommute|fully[\s-]*remote|100%[\s-]*remote|work[\s-]*anywhere)\b",
    re.IGNORECASE,
)


def location_bonus(job_location: str | None, description: str | None) -> float:
    """Return a 0.0-1.0 bonus.

      • Remote-friendly (location string or description signals remote)   → 1.0
      • Job location contains the full SEARCH_LOCATION substring          → 1.0
      • Job location contains a comma-separated piece of SEARCH_LOCATION  → 0.75
      • Everything else (unknown geography)                               → 0.5
    """
    loc = (job_location or "").strip().lower()
    desc_head = (description or "")[:1500].lower()
    haystack = f"{loc} {desc_head}"

    if _REMOTE_RE.search(haystack):
        return 1.0

    target = (os.environ.get("SEARCH_LOCATION") or "").strip().lower()
    if not target:
        return 0.5

    if target in loc:
        return 1.0

    # "San Francisco, CA" → try each comma-separated token
    for tok in (t.strip() for t in target.split(",")):
        if tok and tok in loc:
            return 0.75

    return 0.5


# Back-compat alias; some older callers still import proximity_bonus.
proximity_bonus = location_bonus
