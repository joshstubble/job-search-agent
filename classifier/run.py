"""Classifier orchestrator.

Default run: classify + embed + score for every un-classified job, then print the
fit-score histogram. Drafting is OFF by default (it's the expensive step).

  python run.py                           # classify + score all unclassified
  python run.py --limit 10                # only 10 jobs (smoke test)
  python run.py --reclassify              # redo already-classified rows too
  python run.py --skip-embed              # cheap mode: skip OpenAI embeddings
  python run.py --draft-above-score 70    # after scoring, draft every row >= 70
  python run.py --draft-only --limit 5    # don't classify; draft the next 5 above threshold
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import traceback

from dotenv import load_dotenv

load_dotenv()

import db  # noqa: E402
import embed  # noqa: E402
import llm_agents  # noqa: E402
from location import location_bonus  # noqa: E402

log = logging.getLogger("classifier.run")


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _classifier_prompt(job: dict) -> str:
    desc = (job.get("description") or "")[:6000]
    return (
        f"Title: {job.get('title')}\n"
        f"Company: {job.get('company')}\n"
        f"Location: {job.get('location')}\n"
        f"Source: {job.get('source')}\n"
        f"URL: {job.get('url')}\n"
        f"Salary: min={job.get('salary_min')} max={job.get('salary_max')}\n"
        f"Description:\n{desc}"
    )


def _scorer_prompt(job: dict, clf) -> str:
    return (
        f"Title: {job.get('title')}\n"
        f"Company: {job.get('company')}\n"
        f"Location: {job.get('location')}\n"
        f"Classified seniority: {clf.seniority}\n"
        f"Classified discipline: {clf.discipline}\n"
        f"Classified remote: {clf.remote}\n"
        f"Summary: {clf.jd_summary}"
    )


def _drafter_prompt(job: dict) -> str:
    desc = (job.get("description") or "")[:4000]
    return (
        f"Title: {job.get('title')}\n"
        f"Company: {job.get('company')}\n"
        f"Location: {job.get('location')}\n"
        f"Discipline: {job.get('discipline')}\n"
        f"Summary: {job.get('jd_summary')}\n"
        f"Posting:\n{desc}"
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    import numpy as np
    va, vb = np.array(a), np.array(b)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    return float(va @ vb / denom) if denom else 0.0


def compute_fit_score(
    *,
    llm_match: int,
    location: str | None,
    description: str | None,
    job_embedding: list[float] | None,
    resume_embedding: list[float] | None,
) -> float:
    """fit_score ∈ [0, 100] = 100 · (0.5·cos + 0.3·llm/10 + 0.2·location).
    Without a resume, the cosine term is 0 and scores cap at ~50.

    MUST match the SQL `compute_fit_score()` function
    (infra/migrations/20260419000000_fit_score_fn.sql), which the dashboard's
    re-rank paths use after a resume activation. Change both in lockstep."""
    cos = 0.0
    if job_embedding and resume_embedding:
        cos = max(0.0, _cosine(job_embedding, resume_embedding))
    loc_bonus = location_bonus(location, description)
    raw = 0.5 * cos + 0.3 * (max(0, min(10, llm_match)) / 10) + 0.2 * loc_bonus
    return round(100 * raw, 2)


# ---------------------------------------------------------------------------
# Per-job pipelines
# ---------------------------------------------------------------------------

def classify_and_score_one(job: dict, *, do_embed: bool) -> dict:
    """Run classifier + embed + scorer on a single job. Writes to DB. Returns
    a dict summarizing what happened (for the caller's report)."""
    job_id = job["id"]

    # 1. Classify
    clf = llm_agents.classify(_classifier_prompt(job))
    db.save_classification(job_id, clf.model_dump(), llm_agents.CLASSIFIER_MODEL_ID)

    # 2. Embed (optional — cheap but skippable in dev)
    job_emb: list[float] | None = None
    if do_embed:
        job_emb = embed.embed_one(embed.job_text_for_embedding(job))
        db.save_embedding(job_id, job_emb)

    # 3. Score
    score_out = llm_agents.score(_scorer_prompt(job, clf))

    # 4. Combine into fit_score
    resume_emb = db.get_active_resume_embedding()
    loc_bonus = location_bonus(job.get("location"), job.get("description"))
    fit = compute_fit_score(
        llm_match=score_out.llm_match,
        location=job.get("location"),
        description=job.get("description"),
        job_embedding=job_emb,
        resume_embedding=resume_emb,
    )
    db.save_fit_score(
        job_id,
        fit,
        llm_match=score_out.llm_match,
        location_bonus=loc_bonus,
    )

    return {
        "job_id": job_id,
        "title": job.get("title"),
        "seniority": clf.seniority,
        "llm_match": score_out.llm_match,
        "fit_score": fit,
    }


def draft_one(job: dict) -> str:
    """Run DrafterAgent on one job (already classified). Writes draft to DB."""
    text = llm_agents.draft(_drafter_prompt(job))
    db.save_draft(job["id"], text)
    return text


# ---------------------------------------------------------------------------
# Histogram helper
# ---------------------------------------------------------------------------

def print_histogram() -> None:
    buckets = db.fit_score_histogram()
    if not buckets:
        print("  (no scored jobs yet)")
        return
    total = sum(c for _, c in buckets)
    print(f"  fit_score distribution ({total} classified jobs):")
    for lo, count in buckets:
        bar = "█" * max(1, round(40 * count / max(total, 1)))
        print(f"    {lo:>3}-{lo+9:<3}  {count:>4}  {bar}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Classify + score + (optionally) draft job rows.")
    ap.add_argument("--limit", type=int, default=None, help="Cap total jobs processed.")
    ap.add_argument("--reclassify", action="store_true", help="Re-run on already-classified rows.")
    ap.add_argument("--skip-embed", action="store_true", help="Skip the embedding step.")
    ap.add_argument("--draft-above-score", type=float, default=None, metavar="SCORE",
                    help="After scoring, draft cover letters for jobs with fit_score >= SCORE.")
    ap.add_argument("--draft-only", action="store_true",
                    help="Skip classify/score; only run the drafter on already-classified jobs. "
                         "Requires --draft-above-score.")
    ap.add_argument("--rescore-components", action="store_true",
                    help="One-shot backfill: rows with NULL llm_match get their scorer re-run "
                         "so fit_score can be decomposed into its three terms. Cheaper than a "
                         "full reclassify.")
    args = ap.parse_args()

    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.draft_only and args.draft_above_score is None:
        ap.error("--draft-only requires --draft-above-score")

    # ----- one-off: rescore components for already-classified rows -----
    if args.rescore_components:
        rows = db.fetch_needs_rescore(limit=args.limit)
        log.info("rescore-components: %d rows need backfill", len(rows))
        errors = 0
        t0 = time.time()
        for i, job in enumerate(rows, 1):
            try:
                # Rebuild the scorer prompt from stored classification fields.
                prompt = (
                    f"Title: {job.get('title')}\n"
                    f"Company: {job.get('company')}\n"
                    f"Location: {job.get('location')}\n"
                    f"Classified seniority: {job.get('seniority')}\n"
                    f"Classified discipline: {job.get('discipline')}\n"
                    f"Classified remote: {job.get('remote')}\n"
                    f"Summary: {job.get('jd_summary')}"
                )
                score_out = llm_agents.score(prompt)
                loc_bonus = location_bonus(job.get("location"), job.get("description"))
                # fit_score recomputed using the still-NULL cosine term (no resume yet) to match
                # the existing scoring logic. If a resume gets activated later, the dashboard's
                # re-rank SQL uses the stored llm_match + location_bonus + new cosine to recompute.
                resume_emb = db.get_active_resume_embedding()
                job_emb = None  # we don't re-embed during a component backfill
                fit = compute_fit_score(
                    llm_match=score_out.llm_match,
                    location=job.get("location"),
                    description=job.get("description"),
                    job_embedding=job_emb,
                    resume_embedding=resume_emb,
                )
                db.save_fit_score(
                    job["id"],
                    fit,
                    llm_match=score_out.llm_match,
                    location_bonus=loc_bonus,
                )
                log.info("[%d/%d] #%s %s → llm=%d loc=%.2f fit=%.1f",
                         i, len(rows), job["id"], (job.get("title") or "")[:40],
                         score_out.llm_match, loc_bonus, fit)
            except Exception as e:
                errors += 1
                log.warning("#%s rescore failed: %s", job.get("id"), e)
                log.debug("%s", traceback.format_exc())
        print(f"\nrescore-components: {len(rows) - errors}/{len(rows)} in {time.time() - t0:.1f}s ({errors} errors)")
        return 0

    # ----- classify + score pass -----
    if not args.draft_only:
        jobs = (
            db.fetch_all_jobs(limit=args.limit)
            if args.reclassify
            else db.fetch_unclassified(limit=args.limit)
        )

        log.info("classify+score: %d jobs (limit=%s, skip_embed=%s, reclassify=%s)",
                 len(jobs), args.limit, args.skip_embed, args.reclassify)
        errors = 0
        t0 = time.time()
        for i, job in enumerate(jobs, 1):
            try:
                r = classify_and_score_one(job, do_embed=not args.skip_embed)
                log.info("[%d/%d] #%s %s → %s (llm=%d, fit=%.1f)",
                         i, len(jobs), r["job_id"], r["title"][:50],
                         r["seniority"], r["llm_match"], r["fit_score"])
            except Exception as e:
                errors += 1
                log.warning("#%s %s failed: %s", job.get("id"), (job.get("title") or "")[:40], e)
                log.debug("%s", traceback.format_exc())
        elapsed = time.time() - t0
        print(f"\nclassify+score done: {len(jobs)-errors}/{len(jobs)} in {elapsed:.1f}s  ({errors} errors)")
        print_histogram()

    # ----- optional draft pass -----
    if args.draft_above_score is not None:
        drafts = db.fetch_for_drafting(min_fit_score=args.draft_above_score, limit=args.limit)
        log.info("drafting: %d jobs at fit_score >= %.1f", len(drafts), args.draft_above_score)
        if not drafts:
            print(f"(nothing to draft above fit_score {args.draft_above_score})")
            return 0
        errors = 0
        t0 = time.time()
        for i, job in enumerate(drafts, 1):
            try:
                draft_one(job)
                log.info("[%d/%d] drafted #%s %s (fit=%.1f)", i, len(drafts),
                         job["id"], (job["title"] or "")[:50], job["fit_score"])
            except Exception as e:
                errors += 1
                log.warning("draft #%s failed: %s", job.get("id"), e)
        print(f"\ndraft done: {len(drafts)-errors}/{len(drafts)} in {time.time()-t0:.1f}s ({errors} errors)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
