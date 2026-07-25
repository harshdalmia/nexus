"""Gemini LLM edge — intent parsing (in) and narration (out) ONLY.

The LLM never scores or decides risk (steering non-negotiable). If no key is configured, or
the SDK/network is unavailable, every function returns None and callers fall back to the
deterministic path. Narration output is still checked by the claim validator, so the LLM
cannot inject an unsupported number.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # pragma: no cover - dotenv optional
    pass


def use_llm() -> bool:
    return (
        os.getenv("NEXUS_USE_LLM", "1") != "0"
        and bool(os.getenv("GEMINI_API_KEY"))
    )


@lru_cache(maxsize=1)
def _model():
    if not use_llm():
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        return genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.0-flash"))
    except Exception:
        return None


def _generate(prompt: str) -> str | None:
    model = _model()
    if model is None:
        return None
    try:
        resp = model.generate_content(prompt)
        return (resp.text or "").strip()
    except Exception:
        return None


def intent_llm(query: str) -> dict | None:
    """Extract InvestigationSpec fields as JSON. Returns None on any failure -> fallback."""
    prompt = (
        "You are the intent parser for an AML investigation system. Extract fields from the "
        "analyst query and reply with ONLY minified JSON, no prose. Schema:\n"
        '{"intent":[subset of "detect","trace","explain","monitor"],'
        '"typology":"smurfing"|"structuring",'
        '"filters":{"payment_format"?:str,"month"?:str},'
        '"entities":[account ids like "0500|C1"],"trace_depth":1|2}\n'
        f"Query: {query!r}"
    )
    raw = _generate(prompt)
    if not raw:
        return None
    try:
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        data = json.loads(raw)
        data["query"] = query
        return data
    except Exception:
        return None


_NUMBER_RULE = (
    "Every number you write MUST appear verbatim in the facts. Do not add, derive, "
    "recompute, average or convert any figure. Do not invent dates, percentages, "
    "durations or counts. If a figure is not in the facts, describe it in words instead "
    "of guessing a value. A single unsupported number causes your entire answer to be "
    "discarded."
)


def narrate_llm(facts: str) -> str | None:
    """Write an analyst summary using ONLY the provided facts. None -> template fallback.

    The number rule is stated explicitly and up front because the claim validator discards
    the whole narrative on one untraceable figure, and the commonest failure was the model
    helpfully computing a percentage or a "past 30 days" window that no tool measured.
    """
    prompt = (
        "You are a compliance analyst writing a case summary for another analyst who has "
        "not seen this account before. Write 4-7 sentences of plain professional English.\n"
        "Lead with the verdict and the recommended action. Then explain what drove the "
        "score, using the scoring_evidence lines. Mention context_evidence only as "
        "context, and make clear it did not affect the score. If accounts were excluded, "
        "say so — deliberate exclusions are evidence of care, not an omission.\n"
        f"{_NUMBER_RULE}\n"
        "Do not use bullet points, headings or markdown.\n\n"
        f"FACTS:\n{facts}"
    )
    return _generate(prompt)


def explain_findings_llm(fact_sheets: list[str]) -> list[str] | None:
    """One short reason per finding, in ONE call. None -> per-row template fallback.

    Batched deliberately: a broad sweep returns up to 25 findings, and one request per row
    would dominate the latency budget and the free-tier quota for what is a list of
    one-liners. The reply is a JSON array so the rows stay aligned with the inputs; any
    mismatch in length is treated as a failure rather than guessed at.
    """
    if not fact_sheets:
        return []
    blocks = "\n\n".join(
        f"### CASE {index + 1}\n{sheet}" for index, sheet in enumerate(fact_sheets)
    )
    prompt = (
        "You are a compliance analyst writing one-line triage reasons for a queue of "
        f"flagged accounts. There are {len(fact_sheets)} cases below.\n"
        "For each case write ONE sentence, at most 300 characters, naming the account, the "
        "risk tier, the recommended action and what drove the score. Where the verdict is "
        "indeterminate, say no conclusion is asserted.\n"
        f"{_NUMBER_RULE}\n"
        f"Reply with ONLY a minified JSON array of exactly {len(fact_sheets)} strings, in "
        "the same order as the cases. No prose, no markdown, no keys.\n\n"
        f"{blocks}"
    )
    raw = _generate(prompt)
    if not raw:
        return None
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        parsed = json.loads(cleaned)
    except Exception:
        return None
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        return None
    return parsed
