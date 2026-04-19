"""Embedding helper. Routes text-embedding-3-small through OpenRouter.

OpenRouter serves OpenAI embeddings at the same `/v1/embeddings` endpoint, so a
plain `openai` client with a custom base_url works. 1536 dimensions matches the
vector(1536) column in job_classifications.embedding.
"""
from __future__ import annotations

import logging
import os
from typing import Iterable

from openai import OpenAI

log = logging.getLogger(__name__)

EMBED_MODEL = "openai/text-embedding-3-small"
EMBED_DIM = 1536  # must match schema

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ["OPENROUTER_API_KEY"],
        )
    return _client


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed a list of strings. OpenAI's embeddings endpoint accepts up to ~2048
    inputs per call; we stay well under that per batch."""
    if not texts:
        return []
    # Strip empty inputs to None positions and put zeroes there — the API rejects empty strings.
    cleaned = [t if (t and t.strip()) else " " for t in texts]
    resp = _get_client().embeddings.create(model=EMBED_MODEL, input=cleaned)
    out = [d.embedding for d in resp.data]
    assert all(len(e) == EMBED_DIM for e in out), f"unexpected embedding dim"
    return out


def embed_one(text: str) -> list[float]:
    return embed_texts([text])[0]


def job_text_for_embedding(job: dict) -> str:
    """Render a job row into the string we embed."""
    parts = [
        job.get("title") or "",
        job.get("company") or "",
        job.get("location") or "",
    ]
    desc = job.get("description") or ""
    if desc:
        parts.append(desc[:4000])  # cap to keep token budget sane
    return "\n".join(p for p in parts if p)
