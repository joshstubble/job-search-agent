"""Pydantic schemas for the classifier pipeline.

These are passed as `output_type=` to the openai-agents Agents so the SDK
requests a strict JSON schema from the model.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Generic career-level buckets. Works for most industries — tune for your field
# if needed (e.g. add "resident" for medicine, "postdoc" for academia). Just a
# string in the DB, so downstream code doesn't care.
Seniority = Literal[
    "intern",
    "entry",            # 0-2 years / junior / early-career
    "mid",              # 3-5 years
    "senior",           # 5-10 years
    "staff",            # principal / staff / lead IC
    "management",       # manager / director / VP
    "executive",        # C-suite / partner / owner
    "non_target",       # false positive — scraper caught something irrelevant
    "unknown",
]

RemoteType = Literal["remote", "hybrid", "onsite", "unknown"]


class JobClassification(BaseModel):
    """Structured output for ClassifierAgent. One row per job."""

    seniority: Seniority = Field(
        description="Career level of the role. Use 'non_target' for false positives where the scraper keyword caught something outside the user's target field.",
    )
    discipline: str = Field(
        description="Primary discipline / specialty in 1-3 words (e.g. 'backend engineering', 'product design', 'clinical nursing', 'corporate law'). Use 'unknown' if unclear or off-target.",
    )
    remote: RemoteType = Field(description="Work location mode.")
    years_required: int | None = Field(
        default=None,
        description="Minimum years of experience explicitly required. Null if unspecified.",
    )
    salary_range: str | None = Field(
        default=None,
        description="Stated salary range as free text (e.g. '$80,000-$110,000'), or null if not in the posting.",
    )
    jd_summary: str = Field(
        description="One- or two-sentence summary of the role, in plain prose.",
    )


class ScoreOutput(BaseModel):
    """Structured output for ScorerAgent."""

    llm_match: int = Field(
        ge=0, le=10,
        description="0-10 rating of how well the job fits the target candidate profile (see prompt).",
    )
    rationale: str = Field(
        description="One short sentence justifying the score.",
    )
