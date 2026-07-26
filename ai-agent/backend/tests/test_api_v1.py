"""Contract tests for the v1 API layer.

These assert the *transport* contract only: envelope shape, status codes, validation,
pagination, and that each payload is populated from pipeline output. Pipeline correctness
is covered by the phase tests, which this layer must not disturb.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from nexus.api.app import create_app
from nexus.api.state import EngineState, state_from_parts
from nexus.config import Settings
from nexus.ingest import load_transactions
from nexus.peers import PeerModel
from nexus.planner import ROSTER
from nexus.profiles import build_profiles

FIXTURES = Path(__file__).parent / "fixtures"
C1 = "0500|C1"
C1_ENCODED = "0500%7CC1"
V1 = "/api/v1"
QUERY = {"query": f"trace ring at {C1}"}


@pytest.fixture(scope="module")
def client() -> TestClient:
    con, _, _ = load_transactions(FIXTURES / "case_Trans.csv", Settings())
    profiles = build_profiles(con)
    dataset = SimpleNamespace(
        con=con, n_transactions=len(profiles), account_to_entity={}, accounts=[],
    )
    state = state_from_parts(dataset, profiles, PeerModel(profiles, k=3))
    return TestClient(create_app(state=state, warm=False))


@pytest.fixture(scope="module")
def run_id(client: TestClient) -> str:
    response = client.post(f"{V1}/investigations", json=QUERY)
    assert response.status_code == 201, response.text
    return response.json()["data"]["run_id"]


@pytest.fixture(scope="module")
def broad_run_id(client: TestClient) -> str:
    """A population query, so the screener and the feature builder actually run.

    The entity-scoped `run_id` fixture declines both by design (nothing consumes the feature
    table when the account is named), so anything about candidate screening or per-account
    feature values has to be asserted against a broad sweep.
    """
    response = client.post(f"{V1}/investigations", json={"query": "flag high-risk customers"})
    assert response.status_code == 201, response.text
    return response.json()["data"]["run_id"]


def _data(response) -> object:
    body = response.json()
    assert response.status_code == 200, response.text
    assert set(body) == {"data", "meta"}
    assert body["meta"]["request_id"]
    assert body["meta"]["generated_at"]
    return body["data"]


# ------------------------------------------------------------------ envelope + health

def test_health_is_enveloped_and_ready(client: TestClient):
    data = _data(client.get(f"{V1}/health"))
    assert data["status"] == "ready"
    assert data["data_loaded"] is True
    assert data["accounts"] > 0
    # The report builder exists now (nexus/reports.py) and is deterministic, so it is always
    # available. PDF rendering is reported separately because it depends on reportlab: a
    # missing font library must not make the whole export path look absent.
    assert data["capabilities"]["report_generator"] is True
    assert isinstance(data["capabilities"]["pdf_export"], bool)


def test_health_answers_while_warming(client: TestClient):
    cold = TestClient(create_app(state=EngineState(), warm=False))
    data = _data(cold.get(f"{V1}/health"))
    assert data["status"] == "warming" and data["data_loaded"] is False


def test_investigating_while_warming_is_503(client: TestClient):
    cold = TestClient(create_app(state=EngineState(), warm=False))
    response = cold.post(f"{V1}/investigations", json=QUERY)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "WARMING_UP"


def test_response_carries_request_id_header(client: TestClient):
    response = client.get(f"{V1}/health")
    assert response.headers["X-Request-Id"]
    assert float(response.headers["X-Response-Time-Ms"]) >= 0.0


def test_roster_matches_the_planner_roster(client: TestClient):
    data = _data(client.get(f"{V1}/roster"))
    assert [tool["tool"] for tool in data] == [tool.id for tool in ROSTER]
    assert all(tool["stage"] for tool in data)


# ----------------------------------------------------------------------- validation

def test_blank_query_is_rejected(client: TestClient):
    response = client.post(f"{V1}/investigations", json={"query": "   "})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_field_is_rejected(client: TestClient):
    response = client.post(f"{V1}/investigations", json={**QUERY, "nope": 1})
    assert response.status_code == 422


def test_unknown_account_is_404_not_a_fabricated_case(client: TestClient):
    response = client.post(f"{V1}/investigations", json={"query": "trace ring at 9999|NOPE"})
    assert response.status_code == 404
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "ACCOUNT_NOT_FOUND"
    assert body["error"]["detail"]["node"] == "9999|NOPE"


def test_unknown_run_is_404(client: TestClient):
    response = client.get(f"{V1}/investigations/deadbeef/execution")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RUN_NOT_FOUND"


def test_bad_sort_field_is_rejected(client: TestClient, run_id: str):
    response = client.get(f"{V1}/investigations/{run_id}/findings", params={"sort": "hax:asc"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_SORT_FIELD"


def test_oversized_page_is_rejected(client: TestClient):
    response = client.get(f"{V1}/transactions", params={"page_size": 100_000})
    assert response.status_code in {400, 422}


def test_invalid_amount_range_is_rejected(client: TestClient):
    response = client.get(f"{V1}/transactions", params={"min_amount": 10, "max_amount": 1})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_AMOUNT_RANGE"


def test_invalid_node_format_is_rejected(client: TestClient):
    response = client.get(f"{V1}/transactions", params={"node": "no-pipe-here"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_NODE"


# --------------------------------------------------------------------- investigations

def test_run_document_is_complete(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}"))

    assert data["query"] == QUERY["query"]
    assert data["execution"]["investigation_summary"]
    assert data["execution"]["selected_tools"]
    assert len(data["steps"]) == len(ROSTER)
    assert len(data["planning"]) == 6
    assert data["findings"], "the fixture ring should produce a finding"
    assert data["risk"]["score"] > 0
    assert data["explanation"]["narrative"]
    assert data["recommendation"]["action"] in {"monitor", "review", "report"}


def test_planning_covers_the_six_derivations(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/planning"))
    assert [item["stage"] for item in data] == [
        "intent_extraction", "entity_extraction", "filter_detection",
        "pattern_detection", "tool_selection", "execution_planning",
    ]


def test_plan_trace_reports_ran_and_skipped_with_reasons(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/plan"))
    statuses = {step["status"] for step in data}
    assert "ran" in statuses
    assert all(step["reason"] for step in data)
    assert all(step["stage"] for step in data)
    # An entity-scoped query must decline the profiler — the selective-EDA claim.
    eda = next(step for step in data if step["tool"] == "eda_profile")
    assert eda["status"] == "skipped" and eda["reason"]


def test_execution_summary_reports_eda_verdict(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/execution"))
    assert data["eda"]["status"] in {"ran", "skipped", "failed"}
    assert data["eda"]["reason"]
    assert data["execution_time_ms"] >= 0
    assert data["cost"]["max_investigations"] >= 0


def test_sections_do_not_duplicate_tabular_payloads(client: TestClient, run_id: str):
    """One table in the report: flagged accounts.

    `findings_table`, `evidence_table` and `data_profile_amounts` all restate numbers
    the flagged-accounts section, the explanation and the execution summary already
    carry, so they must not also arrive as their own sections.
    """
    sections = _data(client.get(f"{V1}/investigations/{run_id}/sections"))
    charts = _data(client.get(f"{V1}/investigations/{run_id}/charts"))
    tabular = {dataset["id"] for dataset in charts if dataset["kind"] == "table"}

    assert tabular, "the fixture should still produce tabular datasets"
    for section in sections:
        assert section["id"] not in {f"v-chart-{name}" for name in tabular}, section

    evidence_sections = [item for item in sections if item["kind"] == "evidence"]
    assert len(evidence_sections) == 1
    assert evidence_sections[0]["title"] == "Flagged accounts"


def test_tabular_datasets_remain_available_on_the_charts_endpoint(
    client: TestClient, run_id: str
):
    charts = _data(client.get(f"{V1}/investigations/{run_id}/charts"))
    ids = {dataset["id"] for dataset in charts}
    assert {"findings_table", "evidence_table", "data_profile_amounts"} <= ids


def test_sections_only_unlock_after_tools_that_ran(client: TestClient, run_id: str):
    plan = _data(client.get(f"{V1}/investigations/{run_id}/plan"))
    ran = {step["tool"] for step in plan if step["status"] == "ran"}
    sections = _data(client.get(f"{V1}/investigations/{run_id}/sections"))

    assert sections
    for section in sections:
        assert section["unlock_after"] in ran, section


def test_risk_components_are_weighted_and_explained(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/risk"))
    assert data["available"] is True
    assert data["tier"] in {"low", "medium", "high"}
    assert data["evidence"]
    assert data["components"]
    assert all("weight" in component for component in data["components"])


def test_recommendation_exposes_the_full_ladder(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/recommendation"))
    assert [rung["action"] for rung in data["ladder"]] == ["monitor", "review", "report"]
    assert sum(1 for rung in data["ladder"] if rung["selected"]) == 1


def test_detection_publishes_real_cutoffs_and_no_invented_probability(
    client: TestClient, run_id: str
):
    """Thresholds are published because the engine genuinely has them; probability is not.

    `risk.TIERS` is a real cutoff table on the additive 0-100 scale, so `threshold` and the
    `tiers` ladder are reported facts. `probability` stays null: there is no supervised
    classifier in this pipeline, so no calibrated probability exists to report and filling it
    in would be an invention.
    """
    data = _data(client.get(f"{V1}/investigations/{run_id}/detection"))
    assert data["models"], "scoring tools that ran should be listed"
    assert data["hypotheses"], "the duel should publish competing explanations"

    assert data["probability"] is None

    # The lowest cutoff above plain monitoring, on the 0-100 risk scale.
    assert data["threshold"] == 40.0
    assert [rung["escalation"] for rung in data["tiers"]] == ["monitor", "review", "report"]
    assert [rung["min_score"] for rung in data["tiers"]] == [0.0, 40.0, 70.0]
    # Exactly one rung is the one the engine chose for this case.
    assert sum(1 for rung in data["tiers"] if rung["selected"]) == 1


def test_detection_reports_the_model_artifact_or_says_it_is_absent(
    client: TestClient, run_id: str
):
    """Model provenance is read off the artefact's bytes, never asserted without one."""
    artifact = _data(client.get(f"{V1}/investigations/{run_id}/detection"))["artifact"]
    assert artifact["features"], "the feature list is a static declaration and always present"
    assert artifact["psi"] is None, "no drift computation exists, so no drift value is claimed"
    if artifact["present"]:
        assert artifact["sha256"] and artifact["trained_at"] and artifact["version"]
    else:
        assert artifact["reason"], "an absent model must say why rather than report nulls"
        assert artifact["sha256"] is None


def test_features_reflect_the_manifest_or_say_why_not(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/features"))
    if data["available"]:
        assert data["features"] and all(item["definition"] for item in data["features"])
    else:
        assert data["reason"]


def test_findings_pagination_and_sorting(client: TestClient, run_id: str):
    body = client.get(
        f"{V1}/investigations/{run_id}/findings",
        params={"page": 1, "page_size": 1, "sort": "risk:desc"},
    ).json()
    assert len(body["data"]) <= 1
    page = body["meta"]["page"]
    assert page["page"] == 1 and page["page_size"] == 1
    assert page["total"] >= len(body["data"])


def test_latest_alias_resolves_to_the_newest_run(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/latest/execution"))
    assert data["run_id"]


def test_run_is_cached_not_recomputed(client: TestClient, run_id: str):
    first = _data(client.get(f"{V1}/investigations/{run_id}"))
    second = _data(client.get(f"{V1}/investigations/{run_id}"))
    assert first["risk"] == second["risk"]
    assert first["created_at"] == second["created_at"]


def test_run_list_is_enveloped_and_paginated(client: TestClient, run_id: str):
    body = client.get(f"{V1}/investigations").json()
    assert body["meta"]["page"]["total"] >= 1
    assert any(item["run_id"] == run_id for item in body["data"])


# --------------------------------------------------------------------------- charts

def test_charts_are_structured_datasets(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/charts"))
    assert data
    for dataset in data:
        assert dataset["kind"] in {
            "bars", "hbars", "line", "area", "stacked", "pie", "donut", "gauge",
            "heatmap", "sankey", "waterfall", "scatter", "treemap", "corridor", "table",
        }
        # Unavailable datasets must explain themselves rather than arrive empty.
        if not dataset["available"]:
            assert dataset["reason"]


def test_available_only_filter(client: TestClient, run_id: str):
    data = _data(
        client.get(f"{V1}/investigations/{run_id}/charts", params={"available_only": True})
    )
    assert data and all(dataset["available"] for dataset in data)


def test_single_chart_and_404(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/charts/risk_contribution"))
    assert data["id"] == "risk_contribution"

    missing = client.get(f"{V1}/investigations/{run_id}/charts/nope")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "CHART_NOT_FOUND"


# ------------------------------------------------------------------------- evidence

def test_evidence_records_carry_proof(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/evidence"))
    assert data
    record = data[0]
    assert record["claim"] and record["calculation"]
    assert record["direction"] in {"high", "low", "neutral"}
    assert "weighted" in record


def test_evidence_transactions_resolve_to_real_rows(client: TestClient, run_id: str):
    records = _data(client.get(f"{V1}/investigations/{run_id}/evidence"))
    with_tx = next((record for record in records if record["tx_ids"]), None)
    if with_tx is None:
        pytest.skip("no evidence record in this fixture cites transaction ids")

    rows = _data(
        client.get(f"{V1}/investigations/{run_id}/evidence/{with_tx['claim_id']}/transactions")
    )
    assert rows and {row["tx_id"] for row in rows} <= set(with_tx["tx_ids"])


def test_unknown_claim_is_404(client: TestClient, run_id: str):
    response = client.get(f"{V1}/investigations/{run_id}/evidence/NOPE/transactions")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CLAIM_NOT_FOUND"


# ------------------------------------------------------------------- entities + graph

def test_entity_profile(client: TestClient):
    data = _data(client.get(f"{V1}/entities/{C1_ENCODED}"))
    assert data["node"] == C1
    assert data["txn_count"] > 0


def test_unknown_entity_is_404(client: TestClient):
    response = client.get(f"{V1}/entities/9999%7CNOPE")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ACCOUNT_NOT_FOUND"


def test_entity_graph_returns_data_not_layout(client: TestClient):
    data = _data(client.get(f"{V1}/entities/{C1_ENCODED}/graph"))
    assert data["center"] == C1
    assert data["nodes"] and data["edges"]

    node = data["nodes"][0]
    assert {"id", "label", "kind", "role", "facts"} <= set(node)
    # Layout is the client's job: no coordinates may be published.
    assert "x" not in node and "y" not in node

    edge = data["edges"][0]
    assert edge["source"] and edge["target"] and edge["weight"] >= 0
    assert edge["kind"] in {"transfer", "large-transfer"}


def test_run_graph_overlays_run_risk(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/investigations/{run_id}/graph"))
    centre = next(node for node in data["nodes"] if node["id"] == data["center"])
    assert centre["kind"] == "hub"
    assert centre["risk"] is not None


# ---------------------------------------------------------------------- transactions

def test_transaction_listing_is_paginated(client: TestClient):
    body = client.get(f"{V1}/transactions", params={"page_size": 3}).json()
    assert len(body["data"]) <= 3
    assert body["meta"]["source"] == "dataset"
    assert body["meta"]["page"]["total"] >= len(body["data"])


def test_transaction_filters_apply(client: TestClient):
    data = _data(client.get(f"{V1}/transactions", params={"node": C1, "page_size": 50}))
    assert data
    for row in data:
        sender = f"{row['from_bank']}|{row['sender_account']}"
        receiver = f"{row['to_bank']}|{row['receiver_account']}"
        assert C1 in {sender, receiver}


def test_transaction_sorting_applies(client: TestClient):
    data = _data(
        client.get(f"{V1}/transactions", params={"sort": "amount_base:desc", "page_size": 5})
    )
    amounts = [row["amount_base"] for row in data if row["amount_base"] is not None]
    assert amounts == sorted(amounts, reverse=True)


def test_transaction_facets_are_dataset_derived(client: TestClient):
    data = _data(client.get(f"{V1}/transactions/facets"))
    assert data["payment_formats"] and data["currencies"]
    assert data["time_span"][0]["first"]


def test_single_transaction_and_404(client: TestClient):
    rows = _data(client.get(f"{V1}/transactions", params={"page_size": 1}))
    tx_id = rows[0]["tx_id"]
    assert _data(client.get(f"{V1}/transactions/{tx_id}"))["tx_id"] == tx_id

    missing = client.get(f"{V1}/transactions/99999999")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "TRANSACTION_NOT_FOUND"


# ---------------------------------------------------------------------------- audit

def test_audit_receipt_mirrors_the_run(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/audit/{run_id}"))
    assert data["query"] == QUERY["query"]
    assert data["tools_run"]
    assert data["narrative"]
    assert all(item["reason"] for item in data["tools_skipped"])


def test_audit_trail_lists_runs(client: TestClient, run_id: str):
    body = client.get(f"{V1}/audit").json()
    assert any(item["run_id"] == run_id for item in body["data"])


# ------------------------------------------------------------- backward compatibility

def test_legacy_endpoints_are_untouched(client: TestClient):
    assert client.get("/health").json()["status"] == "ready"
    assert client.get("/roster").json()["tools"]

    legacy = client.post("/investigate", json=QUERY)
    assert legacy.status_code == 200
    body = legacy.json()
    # The original eight keys, still top-level and unenveloped.
    assert {"spec", "plan", "case", "narrative", "validated", "unsupported", "sources",
            "audit"} <= set(body)


# ------------------------------------------------- detection catalogue (models)

def test_catalogue_reads_the_hypothesis_library(client: TestClient):
    data = _data(client.get(f"{V1}/models"))

    assert data["typologies"], "the library declares at least one typology"
    assert data["rules"], "every hypothesis should be published as a rule"

    for rule in data["rules"]:
        assert rule["expression"], "a fingerprint must render as a readable predicate"
        assert rule["families"], "a hypothesis without families is not a fingerprint"
        # Precision needs labelled outcomes; it must never be fabricated.
        assert rule["precision"] is None
        assert rule["precision_note"]


def test_catalogue_matches_the_engine_declarations(client: TestClient):
    from nexus.hypotheses import available_typologies, load_hypotheses
    from nexus.risk import RISK_PROFILES
    from nexus.screener import MIN_IN_DEGREE, RANK_WEIGHTS

    data = _data(client.get(f"{V1}/models"))

    expected_rules = sum(len(load_hypotheses(t)) for t in available_typologies())
    assert len(data["rules"]) == expected_rules

    published = {profile["typology"] for profile in data["profiles"]}
    assert set(RISK_PROFILES) <= published

    assert data["screening"]["weights"] == {
        key: round(value, 4) for key, value in RANK_WEIGHTS.items()
    }
    assert data["screening"]["min_in_degree"] == MIN_IN_DEGREE


def test_neutral_families_are_published_with_zero_weight(client: TestClient):
    data = _data(client.get(f"{V1}/models/risk-weights"))
    neutral = next(profile for profile in data if "neutral" in profile["typology"])

    assert neutral["families"]
    assert all(family["weight"] == 0.0 and family["neutral"] for family in neutral["families"])


def test_performance_declines_to_invent_metrics(client: TestClient):
    data = _data(client.get(f"{V1}/models/performance"))

    if data["available"]:
        assert data["metrics"]
    else:
        # Without a report it must say so, and say how to produce one.
        assert data["reason"] and data["command"]
        assert data["metrics"] == []

    assert data["artifacts"], "artifact availability should always be reported"


def test_feature_importance_is_measured_not_shap(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/models/feature-importance"))

    assert data["declared"], "declared weights are always available"

    if data["available"]:
        assert data["runs_measured"] >= 1
        assert all(row["source"] == "measured" for row in data["measured"])
    else:
        assert data["reason"]


def test_funnel_comes_from_run_telemetry(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/models/funnel"))

    assert data["available"] is True
    assert [stage["label"] for stage in data["stages"]] == [
        "screened", "investigated", "flagged", "reviewable", "reportable",
    ]
    assert data["run_id"]


def test_outcomes_report_the_winning_explanation(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/models/outcomes"))

    assert data, "a cached run should have produced a winning explanation"
    assert all(entry["count"] >= 1 for entry in data)


# -------------------------------------------------------- dataset analytics

def test_volume_series_buckets_the_ledger(client: TestClient):
    body = client.get(f"{V1}/analytics/volume", params={"bucket": "day"}).json()
    data = body["data"]

    assert body["meta"]["source"] == "dataset"
    assert data["points"], "the fixture ledger spans at least one day"
    assert data["total_count"] == sum(point["count"] for point in data["points"])


def test_volume_series_rejects_an_unknown_bucket(client: TestClient):
    response = client.get(f"{V1}/analytics/volume", params={"bucket": "fortnight"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_BUCKET"


def test_distributions_call_out_the_threshold_band(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/distributions"))

    assert data["transactions"] > 0
    labels = [band["label"] for band in data["amount_bands"]]
    assert "$9k – $9.99k" in labels, "the near-threshold band must be reported separately"
    assert data["payment_formats"]


def test_corridor_heat_is_currencies_not_jurisdictions(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/corridor-heat"))

    assert data["row_label"] == "currency"
    assert "jurisdiction" in data["note"], "the payload must disclose what it is not"

    for row in data["rows"]:
        assert len(row["values"]) == len(data["columns"])
        assert all(0.0 <= value <= 1.0 for value in row["values"])


def test_segments_come_from_the_peer_model(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/segments"))

    if data["available"]:
        assert data["clusters"]
        assert data["accounts"] == sum(cluster["accounts"] for cluster in data["clusters"])
        assert data["features"], "clustering features should be disclosed"
    else:
        assert data["reason"]


def test_candidate_scatter_projects_the_screener_pool(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/candidates", params={"limit": 25}))

    if data["available"]:
        assert data["points"]
        assert all(point["node"] and point["rank"] >= 0 for point in data["points"])
        assert data["x_label"] and data["y_label"]
    else:
        assert data["reason"]


def test_money_flow_is_staged_around_the_centre(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/entities/{C1_ENCODED}/money-flow"))

    assert data["centre"] == C1
    hub = next(node for node in data["nodes"] if node["role"] == "hub")
    assert hub["id"] == C1 and hub["column"] == 1
    assert data["links"], "the fixture hub has counterparties"

    for link in data["links"]:
        assert C1 in {link["source"], link["target"]}, "links must stage through the centre"


def test_entity_timeline_is_dated_and_directional(client: TestClient):
    data = _data(client.get(f"{V1}/analytics/entities/{C1_ENCODED}/timeline"))

    assert data["node"] == C1
    assert data["events"], "the fixture account transacts"
    assert data["span_days"] >= 1

    days = [event["day"] for event in data["events"]]
    assert days == sorted(days), "events must arrive in chronological order"

    for event in data["events"]:
        assert event["direction"] in {"in", "out"}
        assert event["kind"] in {"deposit", "wire"}
        assert event["day"] >= 1


def test_analytics_reject_a_malformed_node(client: TestClient):
    response = client.get(f"{V1}/analytics/volume", params={"node": "no-pipe"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_NODE"


def test_analytics_404_for_an_unknown_account(client: TestClient):
    response = client.get(f"{V1}/analytics/entities/9999%7CNOPE/timeline")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ACCOUNT_NOT_FOUND"


# ------------------------------------------------------- evidence attribution

def test_attribution_joins_cited_transactions_to_ledger_rows(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/transactions/attribution/{run_id}"))

    assert data["run_id"] == run_id
    assert data["claims"] >= 1

    if data["cited_transactions"] == 0:
        pytest.skip("no evidence record in this fixture publishes transaction ids")

    assert data["rows"], "cited transactions should resolve to ledger rows"

    for row in data["rows"]:
        assert row["citations"], "an attributed row must carry the claim that cited it"
        assert row["transaction"]["tx_id"] >= 0
        assert row["families"], "families should be summarised for the row"

        for citation in row["citations"]:
            assert citation["claim"] and citation["calculation"]
            assert 0.0 <= citation["strength"] <= 1.0
            assert citation["direction"] in {"high", "low", "neutral"}


def test_attribution_matches_the_evidence_it_came_from(client: TestClient, run_id: str):
    evidence = _data(client.get(f"{V1}/investigations/{run_id}/evidence"))
    data = _data(client.get(f"{V1}/transactions/attribution/{run_id}"))

    if not data["rows"]:
        pytest.skip("no cited transactions in this fixture")

    published = {record["claim_id"] for record in evidence}
    strengths = {record["claim_id"]: record["strength"] for record in evidence}
    weighted = {record["claim_id"]: record["weighted"] for record in evidence}

    for row in data["rows"]:
        for citation in row["citations"]:
            # Attribution must not restate the evidence with different numbers.
            if citation["claim_id"] in published:
                assert citation["strength"] == pytest.approx(strengths[citation["claim_id"]])
                assert citation["weighted"] == weighted[citation["claim_id"]]


def test_attribution_reports_account_risk_not_transaction_risk(client: TestClient, run_id: str):
    findings = _data(client.get(f"{V1}/investigations/{run_id}/findings"))
    data = _data(client.get(f"{V1}/transactions/attribution/{run_id}"))

    if not data["rows"]:
        pytest.skip("no cited transactions in this fixture")

    risk_of = {finding["node"]: finding["risk"] for finding in findings}

    for row in data["rows"]:
        assert row["account"] in risk_of, "a citation must belong to a flagged account"
        assert row["account_risk"] == pytest.approx(risk_of[row["account"]])
        # The transaction itself carries no score, by design.
        assert "risk" not in row["transaction"]

    assert "attribution, not per-transaction scoring" in data["note"].lower()


def test_attribution_orders_by_strongest_weighted_claim(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/transactions/attribution/{run_id}"))

    if len(data["rows"]) < 2:
        pytest.skip("need at least two cited transactions to check ordering")

    strengths = [row["peak_strength"] or 0.0 for row in data["rows"]]
    assert strengths == sorted(strengths, reverse=True)


def test_attribution_respects_the_limit(client: TestClient, run_id: str):
    data = _data(client.get(f"{V1}/transactions/attribution/{run_id}", params={"limit": 1}))
    assert len(data["rows"]) <= 1


def test_attribution_404s_for_an_unknown_run(client: TestClient):
    response = client.get(f"{V1}/transactions/attribution/deadbeef")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RUN_NOT_FOUND"


# ---------------------------------------------------------------- reports + artefacts

def test_report_sections_are_sourced_and_never_claim_to_be_filed(
    client: TestClient, run_id: str
):
    """Every substantive section cites something, and the draft never claims filed status."""
    data = _data(client.get(f"{V1}/investigations/{run_id}/report"))
    assert data["available"] is True, data.get("reason")
    assert data["filed"] is False, "the engine drafts reports; it must never claim to file one"

    headings = [section["heading"] for section in data["sections"]]
    assert "Basis for suspicion" in headings
    assert "Methodology and limitations" in headings

    # At least one paragraph must cite an evidence claim with transactions behind it.
    evidence = [
        source
        for section in data["sections"]
        for source in section["sources"]
        if source["kind"] == "evidence"
    ]
    assert evidence, "a report with no evidence citation is not a report"
    assert any(source["tx_ids"] for source in evidence), (
        "cited evidence must point at specific transactions"
    )

    # Steps that need a person are reported as `manual`, not quietly satisfied.
    assert any(item["status"] == "manual" for item in data["readiness"])


def test_report_states_its_own_limitations(client: TestClient, run_id: str):
    """The methodology section discloses what the engine does NOT do.

    A filing that overstates its method is worse than one that admits its scope, so these
    disclosures are asserted rather than left to drift out of the text.
    """
    data = _data(client.get(f"{V1}/investigations/{run_id}/report"))
    method = next(
        section for section in data["sections"]
        if section["heading"] == "Methodology and limitations"
    )
    body = method["body"].lower()
    assert "not individual transactions" in body or "scores accounts" in body
    assert "cycle detection" in body
    assert "supervised" in body


def test_artifacts_advertise_the_bytes_they_will_serve(client: TestClient, run_id: str):
    """The listed sha256 and size must match the downloaded bytes exactly.

    This is the point of rendering server-side: an artefact that can be hashed is one that can
    be attached to an audit trail later.
    """
    import hashlib

    listed = _data(client.get(f"{V1}/investigations/{run_id}/artifacts"))
    assert listed, "a run with findings should produce downloadable artefacts"
    names = {item["name"] for item in listed}
    assert any(name.endswith(".csv") for name in names)
    assert any(name.endswith(".json") for name in names)

    for item in listed:
        response = client.get(f"{V1}/investigations/{run_id}/artifacts/{item['name']}")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith(item["media_type"])
        assert len(response.content) == item["bytes"]
        assert hashlib.sha256(response.content).hexdigest() == item["sha256"]
        assert item["redaction_profile"] == "none", (
            "exports are not redacted; claiming a profile no code implements would mislead"
        )


def test_unknown_artifact_name_is_a_404_that_lists_what_exists(
    client: TestClient, run_id: str
):
    response = client.get(f"{V1}/investigations/{run_id}/artifacts/not-a-file.pdf")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "ARTIFACT_NOT_FOUND"
    assert error["detail"]["available"], "a 404 should say what the client could have asked for"


# ------------------------------------------------------------------- derived datasets

def test_derived_datasets_are_present_or_state_why_not(client: TestClient, run_id: str):
    """Flow, timeline, volume and the screening series each degrade with a stated reason."""
    datasets = {
        item["id"]: item for item in _data(client.get(f"{V1}/investigations/{run_id}/charts"))
    }
    for chart_id in (
        "money_flow", "timeline", "volume_series",
        "screening_rank_distribution", "candidate_scatter",
    ):
        assert chart_id in datasets, f"{chart_id} dataset is missing entirely"
        chart = datasets[chart_id]
        if chart["available"]:
            assert chart["data"] or chart["rows"], f"{chart_id} is available but empty"
        else:
            assert chart["reason"], f"{chart_id} is unavailable without saying why"

    # This query names an account, so nothing was screened and the pool series must say so
    # rather than reporting an empty histogram as if it were a measurement.
    assert datasets["screening_rank_distribution"]["available"] is False
    assert "named an account" in datasets["screening_rank_distribution"]["reason"]


def test_timeline_marks_direction_not_transaction_risk(client: TestClient, run_id: str):
    """The engine scores accounts, so the timeline must not imply a per-transaction score."""
    datasets = {
        item["id"]: item for item in _data(client.get(f"{V1}/investigations/{run_id}/charts"))
    }
    timeline = datasets["timeline"]
    if timeline["available"]:
        assert "direction, not risk" in (timeline["footnote"] or "")
        assert {row["kind"] for row in timeline["rows"]} <= {"inbound", "outbound"}


def test_risk_publishes_thresholds_and_separates_scoring_from_context(
    client: TestClient, run_id: str
):
    """The score breakdown distinguishes families that moved the score from those that did not."""
    data = _data(client.get(f"{V1}/investigations/{run_id}/risk"))
    assert [rung["escalation"] for rung in data["tiers"]] == ["monitor", "review", "report"]

    assert set(data["scoring_families"]).isdisjoint(data["context_families"]), (
        "a family either moved the score or it did not"
    )
    scoring_components = [c for c in data["components"] if c["scoring"]]
    assert scoring_components, "weighted components should be reported"
    for component in data["components"]:
        assert component["family_label"], "components carry a human label, not only a slug"
        if not component["scoring"]:
            assert component["contribution"] == 0.0


def test_features_report_subject_values_when_a_subject_exists(
    client: TestClient, broad_run_id: str
):
    """The manifest says which features exist; the payload says what they evaluated to."""
    data = _data(client.get(f"{V1}/investigations/{broad_run_id}/features"))
    assert data["available"] is True, data.get("reason")
    assert data["subject"], "a run with a finding knows which account the values belong to"
    assert all(item["label"] for item in data["features"])
    assert any(item["value"] is not None for item in data["features"]), (
        "declaring ten features without a single value is a catalogue, not an explanation"
    )
    for item in data["features"]:
        if item["value"] is not None:
            assert item["unit"], "a bare number needs its unit, since the client formats it"


def test_screening_series_are_populated_on_a_broad_sweep(
    client: TestClient, broad_run_id: str
):
    """A population query screens candidates, so the pool series carry real measurements."""
    datasets = {
        item["id"]: item
        for item in _data(client.get(f"{V1}/investigations/{broad_run_id}/charts"))
    }

    distribution = datasets["screening_rank_distribution"]
    assert distribution["available"] is True, distribution["reason"]
    assert sum(row["count"] for row in distribution["rows"]) > 0
    # Named for what it measures. Only investigated accounts have a risk score, so this must
    # not be presented as a risk distribution.
    assert "not by risk" in (distribution["subtitle"] or "")

    scatter = datasets["candidate_scatter"]
    assert scatter["available"] is True, scatter["reason"]
    assert all(-1e9 < row["x"] < 1e9 for row in scatter["rows"])
