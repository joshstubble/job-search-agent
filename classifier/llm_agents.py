"""Agents for the classifier pipeline.

All three route through OpenRouter via a shared AsyncOpenAI client. Tracing is
disabled because the Agents SDK tries to post traces to api.openai.com by default.

Models (picked 2026-04-18 from artificial-analysis + OpenRouter pricing):
  - CLASSIFIER_MODEL = google/gemini-3-flash-preview   ($0.50/$3, AA-intel 35, non-reasoning, 221 tok/s, 0.8s TTFT)
  - SCORER_MODEL     = google/gemini-3-flash-preview   (same; cheap numeric rating)
  - DRAFTER_MODEL    = google/gemini-3.1-pro-preview   ($2/$12, AA-intel 57, reasoning, prose quality)

Swap a model by editing the constants below.

The three instruction blocks (_CLASSIFIER_INSTRUCTIONS, _SCORER_INSTRUCTIONS,
_DRAFTER_INSTRUCTIONS) are deliberately generic so this project works for any
target job search. You *will* want to customize the scorer's "target candidate"
paragraph — that's how you tell the scorer what "good fit" means for you. The
scorer runs once per job, so tuning it pays compound dividends.
"""
from __future__ import annotations

import os

from agents import (
    Agent,
    ModelSettings,
    OpenAIChatCompletionsModel,
    Runner,
    set_default_openai_client,
    set_tracing_disabled,
)
from openai import AsyncOpenAI

from schema import JobClassification, ScoreOutput

CLASSIFIER_MODEL_ID = "google/gemini-3-flash-preview"
SCORER_MODEL_ID = "google/gemini-3-flash-preview"
DRAFTER_MODEL_ID = "google/gemini-3.1-pro-preview"


# Shared OpenRouter-pointed client. Async so Runner.run_sync works.
_openai_client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

set_default_openai_client(_openai_client)
set_tracing_disabled(True)


def _model(model_id: str) -> OpenAIChatCompletionsModel:
    return OpenAIChatCompletionsModel(model=model_id, openai_client=_openai_client)


# Optional user-profile tuning. Set these in .env to customize the scorer's
# sense of "good fit" without editing code — the dashboard's resume coach is
# still the primary way to teach the system what you want, but this gives the
# batch scorer a starting point on 7am/7pm cron runs.
_TARGET_FIELD = os.environ.get("TARGET_FIELD", "").strip()
_TARGET_SENIORITY = os.environ.get("TARGET_SENIORITY", "").strip()
_TARGET_PROFILE_NOTES = os.environ.get("TARGET_PROFILE_NOTES", "").strip()


# -------------------------- ClassifierAgent ----------------------------------
_CLASSIFIER_INSTRUCTIONS = """You classify job postings into a structured JobClassification record.

Rules:
- seniority: pick the closest career-level bucket from the enum. Use 'non_target' when the scraper keyword pulled something clearly outside the user's field (e.g. searching 'engineer' and the hit is 'sanitation engineer' meaning janitor). Use 'unknown' only when the posting itself is ambiguous on level.
- discipline: 1-3 words describing the specialty or domain (e.g. 'backend engineering', 'product design', 'clinical nursing', 'corporate law'). Use 'unknown' if unclear.
- remote: 'remote' / 'hybrid' / 'onsite' only when the posting explicitly states it. Otherwise 'unknown'.
- years_required: integer only when a minimum year count is explicitly stated. Otherwise null.
- salary_range: preserve as free text when stated; otherwise null.
- jd_summary: 1-2 plain-prose sentences describing what the role does.

Be terse. Output only the structured fields."""

classifier_agent = Agent(
    name="JobClassifier",
    model=_model(CLASSIFIER_MODEL_ID),
    output_type=JobClassification,
    instructions=_CLASSIFIER_INSTRUCTIONS,
    model_settings=ModelSettings(max_tokens=600),
)


# -------------------------- ScorerAgent --------------------------------------
def _build_scorer_instructions() -> str:
    profile_bits: list[str] = []
    if _TARGET_FIELD:
        profile_bits.append(f"Target field: {_TARGET_FIELD}.")
    if _TARGET_SENIORITY:
        profile_bits.append(f"Target seniority: {_TARGET_SENIORITY}.")
    if _TARGET_PROFILE_NOTES:
        profile_bits.append(_TARGET_PROFILE_NOTES)
    profile = (
        "\n\n".join(profile_bits)
        if profile_bits
        else "(No target profile configured — score based only on generic signals: clear title, clear responsibilities, realistic seniority.)"
    )
    return f"""You rate how well a job posting fits the target candidate (0-10).

Target candidate profile:
{profile}

Scale:
   0-2 — wrong field entirely, or off-target seniority (e.g. management role when user wants IC)
   3-4 — adjacent field, or same field but wrong seniority / geography
   5-7 — passable fit (niche specialty, unusual location, minor mismatch)
   8-10 — strong fit (right field, right seniority, location works or remote)

Return llm_match (0-10) and a one-sentence rationale."""


scorer_agent = Agent(
    name="JobScorer",
    model=_model(SCORER_MODEL_ID),
    output_type=ScoreOutput,
    instructions=_build_scorer_instructions(),
    model_settings=ModelSettings(max_tokens=300),
)


# -------------------------- DrafterAgent -------------------------------------
_DRAFTER_INSTRUCTIONS = """You draft a personalized cover letter for the candidate applying to the given job.

Tone: professional, specific to the employer and role, under 300 words. Do NOT invent qualifications
the candidate hasn't said they have — pull only from the job posting itself to explain interest.
Reference the discipline and location from the job.

Structure:
  Paragraph 1 — Why this employer / role specifically (cite a detail from the posting)
  Paragraph 2 — What the candidate brings (interest in the discipline and seniority level of the role)
  Paragraph 3 — Close with availability and contact

Output ONLY the letter body. No 'Dear …' salutation (the dashboard prepends it).
No signature block. Plain prose only."""

drafter_agent = Agent(
    name="CoverLetterDrafter",
    model=_model(DRAFTER_MODEL_ID),
    instructions=_DRAFTER_INSTRUCTIONS,
    # Gemini 3.1 Pro is a reasoning model; budget enough tokens for thinking + letter.
    model_settings=ModelSettings(max_tokens=4000),
)


# -------------------------- Sync entry points --------------------------------

def classify(prompt: str) -> JobClassification:
    return Runner.run_sync(classifier_agent, prompt).final_output


def score(prompt: str) -> ScoreOutput:
    return Runner.run_sync(scorer_agent, prompt).final_output


def draft(prompt: str) -> str:
    return Runner.run_sync(drafter_agent, prompt).final_output
