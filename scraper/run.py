"""Scraper orchestrator.

Usage (inside the scraper container):
    python run.py               # real run, upserts to Postgres
    python run.py --dry-run     # counts only, no DB writes
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from typing import Callable, Iterable

from dotenv import load_dotenv

load_dotenv()

# Import db AFTER load_dotenv so DATABASE_URL is definitely in env.
import db  # noqa: E402
from adapters import (  # noqa: E402
    adzuna,
    ats_direct,
    jobspy_runner,
    remotive,
    usajobs,
)

log = logging.getLogger("scraper.run")


# Adapter-module name → iter function. Kept in intent order (highest-signal first).
ADAPTERS: list[tuple[str, Callable[..., Iterable[dict]]]] = [
    ("jobspy_runner", jobspy_runner.iter_jobs),
    ("adzuna",        adzuna.iter_jobs),
    ("usajobs",       usajobs.iter_jobs),
    ("ats_direct",    ats_direct.iter_jobs),
    ("remotive",      remotive.iter_jobs),
]

# Which fine-grained source names each adapter feeds.
ADAPTER_SOURCES: dict[str, list[str]] = {
    "jobspy_runner": ["jobspy_indeed", "jobspy_google", "jobspy_glassdoor", "jobspy_zip", "jobspy_linkedin"],
    "ats_direct":    ["ats_greenhouse", "ats_lever", "ats_ashby"],
    "usajobs":       ["usajobs"],
    "adzuna":        ["adzuna"],
    "remotive":      ["remotive"],
}


def _invoke_adapter(name: str, iter_fn, enabled_subs: list[str]):
    """Call an adapter with its sub-source filter applied.

    - jobspy_runner's sub-sources map onto JobSpy's `site_name=` list (after
      dropping the `jobspy_` prefix and fixing the `zip` → `zip_recruiter` alias).
    - ats_direct's sub-sources map onto platform names (greenhouse/lever/ashby),
      which it uses to filter its BOARDS list.
    - Other adapters are 1:1 with a single source — no filter needed.
    """
    if name == "jobspy_runner":
        site_aliases = {"jobspy_zip": "zip_recruiter"}
        sites = [site_aliases.get(s, s.removeprefix("jobspy_")) for s in enabled_subs]
        return iter_fn(sites=sites)
    if name == "ats_direct":
        from adapters import ats_direct
        platforms = {s.removeprefix("ats_") for s in enabled_subs}
        boards = [b for b in ats_direct.BOARDS if b[0] in platforms]
        return iter_fn(boards=boards)
    return iter_fn()


def _setup_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Run all scraper adapters.")
    ap.add_argument("--dry-run", action="store_true", help="Do not write to the DB.")
    ap.add_argument("--only", nargs="+", metavar="ADAPTER",
                    help="Run only the named adapter(s). Default: all.")
    args = ap.parse_args()

    _setup_logging()
    if not args.dry_run:
        db.seed_sources()

    selected = [(n, f) for n, f in ADAPTERS if not args.only or n in args.only]
    if not selected:
        log.error("--only %s matched no adapters", args.only)
        return 2

    enabled = db.enabled_source_names()

    all_jobs: list[dict] = []
    crashed: dict[str, str] = {}
    per_adapter_count: dict[str, int] = {}

    for name, iter_fn in selected:
        # Filter the adapter's sub-sources down to those marked enabled in the DB.
        sub_sources = ADAPTER_SOURCES.get(name, [name])
        enabled_subs = [s for s in sub_sources if s in enabled]
        if not enabled_subs:
            log.info("▶ adapter: %s — all sub-sources disabled, skipping", name)
            per_adapter_count[name] = 0
            continue

        log.info("▶ adapter: %s (enabled sub-sources: %s)", name, enabled_subs)
        try:
            jobs = list(_invoke_adapter(name, iter_fn, enabled_subs))
        except Exception as e:
            log.error("adapter %s crashed: %s", name, e)
            log.debug("traceback:\n%s", traceback.format_exc())
            crashed[name] = str(e)
            per_adapter_count[name] = 0
            continue
        per_adapter_count[name] = len(jobs)
        all_jobs.extend(jobs)
        log.info("  %s yielded %d jobs", name, len(jobs))

    # Break out by the fine-grained `source` each job is tagged with.
    by_source: dict[str, int] = {}
    for j in all_jobs:
        by_source[j["source"]] = by_source.get(j["source"], 0) + 1

    mode = "DRY RUN" if args.dry_run else "WRITE"
    print(f"\n===== Scrape summary ({mode}) =====")
    print(f"Adapters run:        {len(selected)}")
    print(f"Total jobs yielded:  {len(all_jobs)}")
    print(f"Sources hit (>=1):   {len(by_source)}")
    print()
    print("By adapter:")
    for name, _ in selected:
        if name in crashed:
            print(f"  {name:<16} ERROR: {crashed[name][:90]}")
        else:
            print(f"  {name:<16} {per_adapter_count[name]:>5} jobs")
    print()
    print("By source:")
    for s in sorted(by_source):
        print(f"  {s:<22} {by_source[s]:>5}")

    if args.dry_run:
        print("\n-- dry-run: nothing written --")
        return 0

    inserted, updated, skipped = db.upsert_many(all_jobs)
    print(f"\nDB write: inserted={inserted}  updated={updated}  skipped={skipped}")

    # Mark each source's last_run_at. A source with >=1 row is a success; a crashed
    # adapter's sources get marked errored. Sources that ran fine but returned 0 rows
    # are not marked (no news, no change).
    for adapter_name, sources in ADAPTER_SOURCES.items():
        err = crashed.get(adapter_name)
        for s in sources:
            if err is not None:
                db.mark_source_run(s, success=False, error=err)
            elif by_source.get(s, 0) > 0:
                db.mark_source_run(s, success=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
