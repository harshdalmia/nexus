"""Renderers: a draft report as downloadable bytes (PDF, CSV appendix, JSON payload).

Everything here turns an already-built `Report` into a byte string. No content decisions are
made in this module — if a sentence is not in the report, it is not in the PDF.

Why the bytes are produced server-side rather than in the browser: an artefact that can be
hashed is an artefact that can be attached to an audit trail. Every rendered artefact carries
its own sha256, which is what makes "who exported what" answerable later. A DOM-to-canvas
export in the client would produce a file the server has never seen and cannot attest to.

`reportlab` is an optional dependency. When it is missing, PDF rendering reports itself
unavailable with a reason and the CSV and JSON artefacts still work, because losing a font
library should not take the whole export path down with it.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from .schemas import Case, Report

try:  # pragma: no cover - exercised by whichever branch the environment provides
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )
    from reportlab.lib import colors

    PDF_AVAILABLE = True
    PDF_REASON: str | None = None
except Exception as exc:  # pragma: no cover
    PDF_AVAILABLE = False
    PDF_REASON = (
        f"reportlab is not installed ({type(exc).__name__}); install it to enable PDF export"
    )


@dataclass(frozen=True)
class Artifact:
    """One rendered file: its bytes plus everything needed to serve and attest to it."""

    name: str
    media_type: str
    content: bytes
    label: str = ""
    redaction_profile: str = "none"

    @property
    def bytes_len(self) -> int:
        return len(self.content)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


def _slug(text: str) -> str:
    """Filesystem-safe stem. Account ids contain '|', which is not portable in a filename."""
    keep = [ch if (ch.isalnum() or ch in "-_") else "-" for ch in text]
    return "".join(keep).strip("-") or "report"


# ------------------------------------------------------------------------------- JSON


def render_json(report: Report, case: Case | None = None) -> Artifact:
    """The machine-readable payload: the report plus, optionally, the whole case object."""
    payload: dict = {"report": report.model_dump(mode="json")}
    if case is not None:
        payload["case"] = case.model_dump(mode="json")
    payload["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    body = json.dumps(payload, indent=2, sort_keys=False, default=str).encode("utf-8")
    return Artifact(
        name=f"filing-{_slug(report.subject)}.json",
        media_type="application/json",
        content=body,
        label="machine-readable filing payload",
    )


# -------------------------------------------------------------------------------- CSV


def render_evidence_csv(report: Report, case: Case | None = None) -> Artifact:
    """The evidence appendix: one row per cited transaction, per claim.

    Rows are keyed on (claim, transaction) rather than on transaction alone, because the same
    transaction can be proof for more than one claim and collapsing them would lose which
    claim relied on it.
    """
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([
        "section", "source_kind", "claim_id", "detail", "tx_id", "tx_count_total",
    ])

    for section in report.sections:
        for source in section.sources:
            if source.tx_ids:
                for tx_id in source.tx_ids:
                    writer.writerow([
                        section.heading, source.kind, source.ref, source.detail,
                        tx_id, source.tx_count,
                    ])
            else:
                writer.writerow([
                    section.heading, source.kind, source.ref, source.detail, "",
                    source.tx_count,
                ])

    if case is not None:
        for node, reason in case.excluded:
            writer.writerow([
                "Counterparties examined and excluded", "exclusion", node, reason, "", 0,
            ])

    return Artifact(
        name=f"evidence-{_slug(report.subject)}.csv",
        media_type="text/csv",
        content=buffer.getvalue().encode("utf-8"),
        label="evidence appendix, one row per cited transaction",
    )


# -------------------------------------------------------------------------------- PDF


def _styles():  # pragma: no cover - trivial style construction
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "NexusTitle", parent=base["Title"], fontSize=16, leading=20, spaceAfter=2 * mm,
            alignment=TA_LEFT,
        ),
        "meta": ParagraphStyle(
            "NexusMeta", parent=base["Normal"], fontSize=8, leading=11,
            textColor=colors.HexColor("#555555"),
        ),
        "heading": ParagraphStyle(
            "NexusHeading", parent=base["Heading2"], fontSize=11, leading=14,
            spaceBefore=5 * mm, spaceAfter=1.5 * mm,
        ),
        "body": ParagraphStyle(
            "NexusBody", parent=base["BodyText"], fontSize=9.5, leading=13.5,
            spaceAfter=2 * mm,
        ),
        "source": ParagraphStyle(
            "NexusSource", parent=base["Normal"], fontSize=7.5, leading=10,
            leftIndent=4 * mm, textColor=colors.HexColor("#666666"),
        ),
    }


def _escape(text: str) -> str:
    """reportlab paragraphs are mini-HTML, so markup characters have to be neutralised."""
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def render_pdf(report: Report, case: Case | None = None) -> Artifact | None:
    """Render the draft to PDF, or None when reportlab is unavailable."""
    if not PDF_AVAILABLE:  # pragma: no cover - depends on the environment
        return None

    style = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Draft report - {report.subject}", author="NEXUS-AML",
    )

    flow = [
        Paragraph("Draft suspicious activity report", style["title"]),
        Paragraph(
            _escape(
                f"Subject {report.subject} | typology {report.typology} | verdict "
                f"{report.verdict} | risk {report.risk:g} of 100 ({report.tier} tier) | "
                f"recommended action {report.escalation}"
            ),
            style["meta"],
        ),
        Paragraph(
            _escape(
                f"Generated {report.generated_at}"
                + (f" from run {report.run_reference}" if report.run_reference else "")
                + ". NOT FILED - draft prepared for analyst review."
            ),
            style["meta"],
        ),
        Spacer(1, 4 * mm),
    ]

    for section in report.sections:
        flow.append(Paragraph(_escape(section.heading), style["heading"]))
        flow.append(Paragraph(_escape(section.body), style["body"]))
        for source in section.sources:
            cited = f" ({source.tx_count} transaction(s))" if source.tx_count else ""
            flow.append(Paragraph(
                _escape(f"source [{source.kind}] {source.ref}: {source.detail}{cited}"),
                style["source"],
            ))

    flow.append(PageBreak())
    flow.append(Paragraph("Filing readiness", style["heading"]))
    rows = [["Check", "Status", "Note"]]
    for item in report.readiness:
        rows.append([
            Paragraph(_escape(item.label), style["source"]),
            item.status,
            Paragraph(_escape(item.blocker or "satisfied"), style["source"]),
        ])
    table = Table(rows, colWidths=[70 * mm, 20 * mm, 80 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEEEEE")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CCCCCC")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]))
    flow.append(table)

    doc.build(flow)
    return Artifact(
        name=f"draft-report-{_slug(report.subject)}.pdf",
        media_type="application/pdf",
        content=buffer.getvalue(),
        label="draft narrative with evidence citations and readiness checks",
    )


# ------------------------------------------------------------------------------ bundle


def render_all(report: Report, case: Case | None = None) -> list[Artifact]:
    """Every artefact that can be produced in this environment, PDF first when available."""
    out: list[Artifact] = []
    pdf = render_pdf(report, case)
    if pdf is not None:
        out.append(pdf)
    out.append(render_evidence_csv(report, case))
    out.append(render_json(report, case))
    return out


def unavailable_reason() -> str | None:
    """Why PDF rendering is off, when it is."""
    return None if PDF_AVAILABLE else PDF_REASON
