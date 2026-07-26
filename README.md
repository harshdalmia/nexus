# NEXUS-AML — AI-Powered Suspicious Activity Detection

An agentic AI system that **investigates** money laundering instead of merely scoring it.

For every suspicious signal, NEXUS forms competing **suspicious and benign hypotheses**, gathers only the **minimal evidence** needed to separate them, compresses noisy alerts into a few **network-level cases**, and returns a **proof-carrying, challengeable** recommendation: *monitor / review / report*.

The LLM never decides risk. It parses the request on the way in and narrates the evidence ledger on the way out. Every score is deterministic, additive, and reproducible.

---

## Table of contents

1. [Problem statement](#1-problem-statement)
2. [Dataset information](#2-dataset-information)
3. [Solution approach](#3-solution-approach)
4. [Tech stack](#4-tech-stack)
5. [Setup](#5-setup)
6. [Usage](#6-usage)
7. [API surface](#7-api-surface)
8. [Repository structure](#8-repository-structure)
9. [Data sources](#9-data-sources)
10. [Evaluation and honest limits](#10-evaluation-and-honest-limits)
11. [Engineering conventions](#11-engineering-conventions)
12. [Glossary](#12-glossary)

---

## 1. Problem statement

### Business summary

Financial institutions are mandated by regulators (FinCEN, FATF, local authorities) to run robust Anti-Money Laundering (AML) programs. Traditional rule-based systems produce two chronic failures:

- **False-positive flood.** Simple thresholds (`IF amount > $10,000 THEN flag`) bury compliance teams in alerts that are overwhelmingly innocent, driving up operational cost.
- **Trivial evasion.** If the rule is $10,000, criminals deposit $9,500. Static rules are blind to adaptive behaviour such as **structuring**, **smurfing**, and **layering**.

The challenge: build an intelligent, autonomous agent that learns from transaction patterns, identifies suspicious behaviour, and provides **explainable** risk assessments with actionable escalation recommendations — so analysts spend their time on genuine threats rather than manual rule tuning.

### Objective

Design and implement an AI-powered agent that:

1. Performs automated exploratory data analysis (EDA) on transaction and customer data to establish baseline behaviour.
2. Detects anomalous transaction patterns indicative of money laundering (e.g. structuring / smurfing).
3. Applies anomaly detection — ML, rule-based, or hybrid.
4. Generates a risk score or flag per transaction/customer.
5. Explains *why* a transaction is flagged as suspicious.
6. Recommends a basic escalation action: monitor / flag for review / report.

### Agentic requirement (the hard part)

The agent must **not** run a fixed sequential pipeline. It must parse the user's natural-language query, extract intent, filters, entities, and pattern types, then **dynamically construct an execution plan**, invoking only the tools needed for that specific query.

| User query | Expected agent behaviour |
|---|---|
| "Find structuring patterns in the last 30 days" | Apply the time filter first; invoke only structuring-focused feature engineering and detection; skip full EDA |
| "Which customers made 10+ transactions under $10,000?" | Run aggregation and a threshold rule directly; ML anomaly detection is not required |
| "Is customer ID 4521 suspicious?" | Single-entity lookup; explain existing flags or compute risk on demand for that entity only |

Required capabilities, invoked **selectively** by intent:

1. Extract intent, filters (date range, segment, country, transaction type), and target AML pattern.
2. Build a dynamic execution plan — which tools, in what order, on which subset.
3. Load the dataset and apply only the preprocessing the query needs.
4. Run EDA only when broad exploration is warranted.
5. Create AML features on demand (frequency, rolling sums, amount deviation, velocity, rapid cash-out).
6. Run anomaly / suspicious-pattern detection using ML, statistical, or rule-based methods on the filtered data.
7. Classify results as low / medium / high risk with context-appropriate thresholds.
8. Generate a human-readable explanation per flag, tied to the query.
9. Recommend the next action: monitor, review, or report.
10. Return a structured, inspectable result that states what the agent decided **and why**.

Required agent architecture: **EDA tool**, **feature engineering tool**, **anomaly detection tool**, **risk classification tool**, and an **explanation / rule layer**.

Recommended output: a query-aware execution summary, top suspicious transactions/customers, a risk level per item, an explanation per flag, a suggested escalation action, and supporting charts/tables/metrics.

### How this repository answers it

| Requirement | Implementation | Where |
|---|---|---|
| NL query → intent, filters, entities, typology | `intent.py` → validated `InvestigationSpec` (Pydantic); Gemini-backed with deterministic keyword fallback | `backend/nexus/intent.py`, `schemas.py` |
| Dynamic execution plan, not a fixed pipeline | `planner.py` routes per typology + intent + whether an entity was named; records **tools run and tools skipped, with reasons** | `backend/nexus/planner.py`, `trace.py` |
| EDA tool | `tools/eda_profile.py` — agent-callable plan node, emits a *neutral* family so it cannot move a score | `backend/nexus/tools/eda_profile.py` |
| Feature engineering tool | `tools/feature_builder.py`, `profiles.py`, `derived.py` | `backend/nexus/` |
| Anomaly detection (hybrid) | Peer deviation (MiniBatchKMeans + robust z), rapid pass-through, graph motif / path trace, near-threshold rule, benign signals, IsolationForest | `backend/nexus/tools/` |
| Risk classification | Additive risk engine, 0–100, tiers 0–39 low / 40–69 medium / 70–100 high | `backend/nexus/risk.py` |
| Explanation layer | Template narrator + optional LLM narration, both gated by a deterministic claim validator | `narrator.py`, `validator.py` |
| Escalation | monitor / review / report derived from tier + confidence | `risk.py`, `casebuilder.py` |
| Structured, inspectable output | Execution summary, plan trace, findings list, evidence ledger, charts, audit receipt | `orchestrator.py`, `findings.py`, `charts.py`, `artifacts.py` |

---

## 2. Dataset information

### Primary dataset — IBM AMLworld

The engine runs on **IBM's AMLworld** synthetic AML transaction data. It contains no real individuals, is generated by a multi-agent virtual world, and — crucially — is **labelled**, which is what makes honest precision/recall numbers possible.

Two variants are used:

| Variant | Role |
|---|---|
| **HI-Small** | Development and demo (higher illicit ratio) |
| **LI-Small** | False-positive evaluation (lower illicit ratio) |

Medium and Large variants are not used.

Each variant ships three files:

| File | Contents | Use |
|---|---|---|
| `{VARIANT}_Trans.csv` | The transactions — the core input | Loaded into DuckDB, normalised |
| `{VARIANT}_Patterns.txt` | The answer key: `BEGIN/END LAUNDERING ATTEMPT - <TYPOLOGY>` blocks | **Held out.** Evaluation only, never visible to the agent or detectors |
| `{VARIANT}_accounts.csv` | account → entity phonebook | Optional, customer-level views only |

### Transaction schema and normalisation

Raw AMLworld headers are mapped on load (note that two source columns are both named `Account`; the second arrives as `Account.1`):

| Raw column | Normalised | How it is used |
|---|---|---|
| `Timestamp` | `timestamp` | Temporal features, coordination windows, pass-through timing |
| `From Bank`, `Account` | `from_bank`, `sender_account` | Graph source node |
| `To Bank`, `Account.1` | `to_bank`, `receiver_account` | Graph sink node |
| `Amount Received`, `Receiving Currency` | `amount_received`, `receiving_currency` | Amount features, FX normalisation |
| `Amount Paid`, `Payment Currency` | `amount_paid`, `payment_currency` | Near-threshold detection |
| `Payment Format` | `payment_format` | Cash / Wire / ACH / Cheque / Credit Card / Bitcoin / Reinvestment filters |
| `Is Laundering` | `is_laundering` | Ground-truth label, **evaluation only** (auto-detected; may be absent) |

Bank codes and account numbers load as **strings** — leading zeros are significant. An entity is identified as `bank|account`, e.g. `0048309|811C599A0`.

### What profiling HI-Small actually established

Measured, not assumed (`python -m nexus.ingest --variant HI-Small`):

- **5,078,345 transactions**, **515,088 distinct accounts** (node = bank+account), 518,581 rows in `accounts.csv`, **166,207 entities**.
- **Payment formats:** Cheque 1,864,331 · Credit Card 1,323,324 · ACH 600,797 · Cash 490,891 · Reinvestment 481,056 · Wire 171,855 · Bitcoin 146,091.
- **FX normalisation is required.** Only ~37% of rows are USD across 15 currencies; all have rates in the stub FX table.
- **Cross-currency is a real signal**, firing on 72,170 rows (1.42%) — not negligible.
- **Timestamps parse 100%.** Ground truth holds **370 pattern instances / 3,209 pattern rows**, and the pattern → transaction join matches **100%**.
- **Labels:** `Is Laundering` present with **5,177 positives (0.102%)**. The label set is *larger* than the named pattern rows (3,209), so ~2k illicit transactions belong to no titled scheme. Binary truth uses `Is Laundering`; `Patterns.txt` is used for typology validation.
- **Typology counts:** CYCLE 54, GATHER-SCATTER 51, BIPARTITE 49, FAN-OUT 48, SCATTER-GATHER 44, STACK 43, RANDOM 41, FAN-IN 40 — ample FAN-IN / GATHER-SCATTER material for the smurfing demo.

### Two honest data constraints

1. **No customer demographics, segments, balances, or KYC fields.** The data is account IDs and transactions.
   → Peer groups are **derived behaviourally** by clustering accounts (MiniBatchKMeans over engineered profiles), not read from a `segment` column. Behaviour beats declared attributes, and it is the honest option here.
2. **No baked-in statutory reporting threshold.** AMLworld amounts are not designed around a fixed $10k line.
   → Near-threshold detection uses a **configurable** threshold (`NEAR_THRESHOLD = 10,000`, band 10%) plus seeded structuring cases.

Consequence for queries: a filter like *"retail accounts"* has no backing column, so demo queries use filters the data supports (`payment_format = Cash`, date range, amount band).

Because AMLworld has no customer↔account mapping in the transaction file, the **investigated entity is an account**, stated plainly rather than dressed up as a customer graph.

### Derived and seeded data

| Artefact | Built by | Purpose |
|---|---|---|
| Account profiles | `profiles.py` (sorted by node id for determinism) | Feature table for peer clustering, screening, IsolationForest |
| Behavioural peer clusters | `peers.py` (MiniBatchKMeans, `MIN_CLUSTER_SIZE=30`, median/MAD z, global fallback) | "Unusual for similar accounts?" |
| Transaction subgraphs | `graph.py` (NetworkX, **never** a global graph) | Fan-in / convergence motifs, bounded path tracing |
| Demo constructs | `seeds.py` | A structuring case, a smurfing ring (`0500\|C1`), and a **benign lookalike** merchant (`0900\|M1`) — the false-positive-reduction proof |
| Held-out ground truth | `ground_truth.py` | Parsed `Patterns.txt`, evaluation only |
| Real test cases | `scripts/gen_test_cases.py` → `tests/cases/real_cases.json` | 41 real HI-Small cases for integration metrics |

Raw data files are **git-ignored** (too large for the repo) and must be downloaded — see [Data sources](#9-data-sources).

---

## 3. Solution approach

### The reframe

> An alert is not a number to compute; it is a question to be settled by evidence.

NEXUS is built like a courtroom rather than a calculator:

| Courtroom role | NEXUS component |
|---|---|
| Prosecution vs. defence | Competing hypotheses (suspicious + benign) |
| Investigators who fetch facts | The tools |
| The case file | The evidence ledger |
| The sentencing formula | The additive risk engine |
| The clerk who writes the report | The LLM narrator (may describe the file, never invent facts) |

A detector says *"IsolationForest score 0.87 — high risk."* An investigator says *"This looks like structuring. I tested whether it's a legitimate cash business and ruled it out because 91% of the money left within 6 hours. Here is the evidence. Recommend: report."*

### Design non-negotiables

1. **The LLM never decides risk.** It parses intent in and narrates out. Scoring is deterministic.
2. **Every claim is proof-carrying.** No number appears unless it traces to real transaction IDs. Target: **0% unsupported claims**.
3. **Selective, not exhaustive.** Run the smallest sufficient set of tools; touch the fewest fields.
4. **Additive scoring by design**, so counterfactual ablation is trivial and honest.
5. **Curated hypotheses**, from a YAML library of investigator playbooks — not free-form LLM invention.
6. **Ground truth is held out.** Labels and `Patterns.txt` never reach the agent at inference time.
7. **Anchors are pinned.** Any change to how a tool computes strength/direction, or to risk weights, must be reported with before/after on every affected anchor number.

### Layered architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — INTERFACE (React)                                              │
│  Watchtower · Ask · Cases · Entity graph · Ledger · Models · Reports ·    │
│  Audit trail                                                              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  query down, case up (FastAPI / JSON)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  LAYER 4 — REASONING / ORCHESTRATION                                      │
│  intent → hypotheses → [ planner ⇄ tools ⇄ ledger ⇄ duel ] → risk →      │
│  counterfactual → network expansion / case compression → narrator →       │
│  claim validator → escalation                                             │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────┐
│  LAYER 3 — ANALYTICS TOOLKIT                                              │
│  eda_profile · feature_builder · candidate_screener · peer_comparison ·   │
│  rapid_pass_through · graph_motif/path_trace · benign_signals ·           │
│  near_threshold · isolation_forest                                        │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────┐
│  LAYER 2 — DATA & FEATURES                                                │
│  DuckDB transaction store · account profiles · peer clusters ·            │
│  on-demand NetworkX subgraphs                                             │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────┐
│  LAYER 1 — GOVERNANCE (always on)                                         │
│  Evidence ledger · per-tool telemetry · audit receipt · disposition store │
└──────────────────────────────────────────────────────────────────────────┘
```

Each layer is independently validatable — what regulators ask for. The LLM lives only at the **edges of Layer 4**; it never reaches Layers 1–3 where facts and scores live.

### End-to-end flow

```text
 "Find structuring in June cash deposits, trace the funds"      ← natural language
        │  INTENT PARSER (LLM or deterministic)
        ▼
 InvestigationSpec { typology, filters, intent, entities, trace_depth }
        │  HYPOTHESIS GENERATOR (library.yaml)
        ▼
 HypothesisSet [ H1 suspicious, H2/H3 benign ]   (all scores 0)
        │  INVESTIGATION LOOP  ◄──────────────┐
        ▼                                     │  until theories separate,
 EvidenceLedger [ CL-01, CL-02, ... ]  ───────┘  budget spent, or no useful tool
        │  RISK ENGINE + CONFIDENCE + COUNTERFACTUAL + NETWORK EXPANSION
        ▼
 Case { members, paths, risk, tier, confidence, counterfactuals, evidence[] }
        │  NARRATOR → CLAIM VALIDATOR
        ▼
 Validated narrative + escalation (monitor / review / report)
        │  AUDIT RECEIPT + DISPOSITION
        ▼
 Immutable case file + feedback signal
```

Language → structure → questions → evidence → verdict → *fact-checked* language.

### Hypotheses as fingerprints

A hypothesis declares, per evidence family, an **expected direction** (high/low) and an **importance weight**. Families it does not list are neutral. The library (`hypotheses/library.yaml`) is keyed by typology.

**Smurfing route**

| id | label | kind | fingerprint (family → expects, importance) |
|---|---|---|---|
| H1 | Structuring + rapid consolidation | suspicious | peer_deviation → high 0.7 · flow_through → high 1.0 · network_convergence → high 1.0 · temporal_coordination → high 0.8 · recurrence → **low** 0.9 · stability → **low** 0.7 |
| H2 | Legitimate cash-intensive business | benign | retention → high 1.0 · stability → high 0.6 |
| H3 | Recurring legitimate collections | benign | recurrence → high 0.8 · temporal_coordination → **low** 0.5 |
| H4 | Pass-through pooler (processor / marketplace) | benign | recurrence → high 1.0 · stability → high 0.9 |

**Structuring route**

| id | label | kind | fingerprint |
|---|---|---|---|
| H1 | Near-threshold structuring | suspicious | typology_rule → high 1.0 · peer_deviation → high 0.4 |
| H2 | Legitimate deposits (not threshold-shaped) | benign | typology_rule → **low** 1.0 |
| H3 | Recurring legitimate collections | benign | recurrence → high 0.9 · stability → high 0.6 · retention → high 0.5 |

Notice the deliberate oppositions: smurfing H1 expects `recurrence` and `stability` **low** while H2/H3/H4 expect them **high**, and H1 expects `temporal_coordination` high while H3 expects it low. That opposition is the engine of the duel, and the reason benign lookalikes get actively ruled *out* rather than merely not selected.

Equally deliberate is what is *absent*: structuring H1 is **not** extended with `recurrence: low` / `stability: low`, because that would let the suspicious theory gain from the mere absence of benign traits — which is how a quiet account gets talked into a verdict.

### The duel — one scoring rule

- family in fingerprint & **direction matches** → `score += importance × strength`
- family in fingerprint & **direction clashes** → `score −= importance × strength`
- family absent → no change

Subtracting on mismatch is the false-positive killer: evidence does not merely fail to support the benign theory, it demolishes it.

### Risk engine

Risk measures **severity of the winning suspicious story** — computed only when a suspicious hypothesis wins. It is a weighted sum of independent family strengths, scaled to 0–100.

Consolidation / smurfing profile (`RISK_WEIGHTS`, sums to 1.0):

| family | weight |
|---|---|
| peer_deviation | 0.20 |
| flow_through | 0.25 |
| network_convergence | 0.25 |
| temporal_coordination | 0.20 |
| typology_rule | 0.10 |

Structuring uses a separate profile weighting `typology_rule` at 1.0 — deliberately *not* peer deviation, so a high-fan-in merchant cannot be labelled a structurer purely on volume.

| Risk | Tier | Escalation |
|---|---|---|
| 0–39 | low | monitor |
| 40–69 | medium | review |
| 70–100 | high | report |

Because risk is additive, the **counterfactual** panel is exact: zero out a family, recompute, show the delta (e.g. 87 → 64 → 41). That is how the system answers "aren't you just a threshold?".

A family can be load-bearing in the duel and still carry **zero** risk weight, because the duel decides *which* story and the risk engine decides *how severe*. `families.py` is the single place that split is resolved, so the narrative, API, and report all attribute points identically:

| Family | What it measures | Role |
|---|---|---|
| `peer_deviation` | distance from behaviourally similar accounts | weighted (smurfing) / duel-only (structuring) |
| `flow_through` | how fast arriving money was sent on | weighted |
| `network_convergence` | counterparties paying in vs. paid out | weighted |
| `temporal_coordination` | whether inbound payments cluster in time | weighted |
| `typology_rule` | inbound deposits just below the threshold | weighted |
| `retention` · `recurrence` · `stability` | funds retained · repeating counterparties · steady behaviour | benign discriminators, duel only |
| `anomaly` | IsolationForest novelty score | **neutral** — informational, deliberately outside the risk weights |
| `data_profile` · `feature_coverage` | EDA and feature-availability context | **neutral** — cannot move a score |

### Evidence records

Every tool emits typed records:

| Field | Meaning |
|---|---|
| `claim_id` | e.g. `CL-02` |
| `family` | signal category, e.g. `flow_through` |
| `claim` | the finding in words |
| `calculation` | how it was computed |
| `value`, `direction`, `strength` | raw number, high/low, squashed 0–1 |
| `supports` / `contradicts` | which hypotheses it helps or hurts |
| `transactions` | the **exact transaction IDs** — the proof |
| `feature_version`, `data_snapshot` | reproducibility stamps |

A signal without its source is an opinion. A signal with its source is evidence — and it is what lets the validator guarantee zero unsupported claims.

### Network expansion and case compression

1. **Seed:** one account trips first, usually a collector hub (high fan-in + rapid pass-through).
2. **Expand:** bounded graph walk within `trace_depth`, backward to feeders, forward to the beneficiary.
3. **Earn-your-flag:** a pulled-in account joins only with its **own** supporting evidence. Connection alone is not enough.
4. **Benign gate:** a legitimate hub passes its benign hypothesis, so its counterparties are not scooped up (a salary payer is excluded).
5. **Compress:** the connected subgraph becomes **one case** — originators, hubs, beneficiary, suspicious paths, shared window, evidence for and against.

This is what turns an alert queue into a short case list, and the earn-your-flag rule is what stops expansion from becoming guilt by association.

### Explanation layer

- **Narrator** reads *only the evidence ledger* and writes analyst-style prose tied to the query intent and detected typology. Gemini when a key is present, deterministic template otherwise.
- **Claim validator** checks every sentence against the ledger: does each number exist in a record, is each cited transaction real. Anything untraceable is rejected and replaced by the template. The LLM structurally cannot inject a number.

### Proof it is not a fixed pipeline

Actual output of `scripts/demo.py` on the seeded constructs — same engine, three different plans:

| Query | Tools run | Tools skipped | Outcome |
|---|---|---|---|
| "Find and trace the smurfing ring at `0500\|C1`" | peer_comparison → rapid_pass_through → graph_motif → benign_signals | feature_builder, eda_profile, candidate_screener, near_threshold, isolation_forest | **REVIEW** |
| "Look for structuring at `0500\|C1`" | peer_comparison → **near_threshold** → benign_signals | feature_builder, eda_profile, candidate_screener, rapid_pass_through, graph_motif, isolation_forest | **REPORT** |
| "Explain why `0900\|M1` looks suspicious" | peer_comparison → rapid_pass_through → graph_motif → benign_signals | feature_builder, eda_profile, candidate_screener, near_threshold, isolation_forest | **MONITOR** — the benign-lookalike merchant is downgraded, which is the false-positive-reduction demo |
| Broad exploration (no entity named) | eda_profile → feature_builder → candidate_screener → per-candidate investigation | — | ranked findings list |

All three narratives validated with `unsupported=[]`. Changing the typology changes the toolset; naming an entity skips EDA and screening entirely; the same suspicious-looking account can come out as MONITOR because the benign hypothesis won.

Every roster tool reports telemetry whether it ran or not — status, reason, measured duration, rows in/out — so the skip decisions are inspectable rather than asserted. Broad queries are cost-capped: 500 candidates screened, 25 investigated, ≤16 DuckDB round-trips per candidate, 30 s budget (all overridable by env var).

---

## 4. Tech stack

### Backend (`ai-agent/backend`)

| Concern | Choice | Reason |
|---|---|---|
| Language | Python 3.11 | One language across the engine |
| Analytical store | **DuckDB 1.1.3** (canonical) + **pandas 2.2.3** for small slices | SQL over CSVs, reads only the needed columns |
| Graph | **NetworkX 3.4.2** | Auditable motifs and bounded traversal, no training |
| ML / stats | **scikit-learn 1.5.2**, **numpy 2.1.3** | MiniBatchKMeans peer clusters, IsolationForest, robust z-scores |
| Schemas | **Pydantic 2.9.2** | Typed `InvestigationSpec`, `Hypothesis`, `EvidenceRecord`, `Case` |
| Risk engine | Custom additive model, pure Python | Decomposable → exact counterfactuals |
| API | **FastAPI 0.115.5** + **uvicorn 0.32.1** | Async, envelope-wrapped, versioned under `/api/v1` |
| LLM (bounded) | **google-generativeai 0.8.3** (Gemini, free tier) | Only two jobs: parse intent, narrate ledger. Optional |
| Hypothesis library | **PyYAML 6.0.2** | `hypotheses/library.yaml` |
| Reports | **reportlab 4.2.5** | PDF export of a case |
| Config | **python-dotenv 1.0.1** | `.env` for keys and caps |
| Tests | **pytest 8.3.4**, **hypothesis 6.161.4**, **httpx 0.28.1** | Hermetic suite + property tests + TestClient |

### Frontend (`frontend`)

| Concern | Choice |
|---|---|
| Framework | **React 19.2** + **TypeScript 5.9** |
| Build | **Vite 6.4** |
| Styling | **Tailwind CSS 4.3** (`@tailwindcss/vite`) |
| Graph / flow | **@xyflow/react 12.11** + **@dagrejs/dagre 3.0** |
| Icons | **lucide-react** |
| State | Local React stores (`store/*.tsx`), typed hooks, no global framework |

Eight workspaces: Watchtower (what needs attention), Ask (NL query → plan → evidence), Cases (graph + evidence spine + timeline), Entity graph, Ledger, Models & rules, Reports (SAR composer), Audit trail. Charts are hand-rolled SVG (bar, line, radial, Sankey, heatmap, scatter/treemap).

The frontend never imports backend code — they talk only over the HTTP boundary. With no backend reachable it replays bundled demo scenarios and labels them as demo data in the UI.

---

## 5. Setup

### Prerequisites

- Python 3.11
- Node.js 20+ (frontend only)
- ~2 GB free disk for the HI-Small CSVs
- Optional: a free Google AI Studio API key for the LLM edges

### 5.1 Get the data

Download AMLworld and place the files in `ai-agent/data/raw/` (see [Data sources](#9-data-sources)):

```text
ai-agent/data/raw/
├── HI-Small_Trans.csv        # development / demo
├── HI-Small_Patterns.txt     # held-out ground truth
├── HI-Small_accounts.csv
├── LI-Small_Trans.csv        # false-positive evaluation (optional)
├── LI-Small_Patterns.txt
└── LI-Small_accounts.csv
```

These are git-ignored. Note the AMLworld naming quirk: `Trans.csv` and `Patterns.txt` are capitalised, `accounts.csv` is lowercase.

### 5.2 Backend

PowerShell (Windows):

```powershell
cd ai-agent\backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

bash (macOS/Linux):

```bash
cd ai-agent/backend
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
cp .env.example .env
```

Use `requirements.txt` for a runtime-only install; `requirements-dev.txt` adds pytest and httpx.

`.env` keys — all optional:

```ini
GEMINI_API_KEY=your-key-here     # free tier: https://aistudio.google.com/app/apikey
GEMINI_MODEL=gemini-2.0-flash
NEXUS_USE_LLM=1                  # 0 forces the deterministic path even with a key
```

Without a key NEXUS falls back to the deterministic intent parser and the template narrator. Everything still runs and every test still passes.

Optional cost caps, also env-overridable: `NEXUS_MAX_CANDIDATES`, `NEXUS_MAX_INVESTIGATIONS`, `NEXUS_MAX_ROUNDTRIPS`, `NEXUS_BUDGET_S`, `NEXUS_MAX_NARRATED_CONTEXTS`, `NEXUS_CORS_ORIGINS`.

### 5.3 Train the anomaly model (optional, once)

```powershell
.venv\Scripts\python.exe scripts\train_model.py
```

Unsupervised IsolationForest over account profiles — labels are never used. Writes to `models/` (git-ignored). The engine runs without it; `/health` reports `anomaly_model: false`.

### 5.4 Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local   # VITE_API_BASE_URL, defaults to http://127.0.0.1:8000
```

---

## 6. Usage

All backend commands run from `ai-agent/backend` with the venv Python. Swap `.venv\Scripts\python.exe` for `.venv/bin/python` on macOS/Linux.

### Profile the dataset (verifies the data loaded)

```powershell
.venv\Scripts\python.exe -m nexus.ingest --variant HI-Small
```

Prints the transaction profile, currency mix, label counts, and per-typology pattern counts.

### Run the agentic demo

```powershell
.venv\Scripts\python.exe scripts\demo.py
```

Seeds the demo constructs, then runs three queries end to end, printing for each: parsed intent and typology, the plan (**tools run** and **tools skipped**), the validated narrative, the intent/narrator source, the unsupported-claim count, and the escalation. The three queries produce three different plans — the visible proof that this is not a fixed pipeline.

### Serve the API

```powershell
.venv\Scripts\python.exe -m uvicorn nexus.api.app:app --reload
```

The dataset warms up in the background, so `/health` answers immediately and reports `status: warming | ready | error`. Interactive docs at `http://127.0.0.1:8000/docs`.

```powershell
$body = @{ query = "Find and trace the smurfing ring at 0500|C1" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/investigate -ContentType application/json -Body $body
```

```bash
curl -X POST http://127.0.0.1:8000/investigate \
  -H "Content-Type: application/json" \
  -d '{"query":"Find and trace the smurfing ring at 0500|C1"}'
```

### Run the UI

```powershell
cd frontend
npm run dev        # Vite dev server
npm run build      # tsc --noEmit && vite build
npm run typecheck
```

Start the backend first for live data; without it the UI falls back to bundled demo scenarios.

### Other scripts

| Script | What it does |
|---|---|
| `scripts/ring_demo.py` | Runs the scoring tools on a **real** HI-Small ring and prints the score breakdown |
| `scripts/eval_report.py` | Honest scorecard: explanation integrity, consolidation vs. rule on held-out data, seeded demonstrations |
| `scripts/bench.py` | Capability-matched benchmark: recall on FAN-IN / GATHER-SCATTER hubs vs. a naive fan-in rule |
| `scripts/bench_split.py` | Held-out train/test benchmark — tuning on train only, verdict on test |
| `scripts/diag.py` | Per-typology diagnosis of misses (benign-gated? flow_through low?) |
| `scripts/fp_peek.py` | One-number rules-baseline false-positive count |
| `scripts/answers.py` | Confusion matrix vs. rules, plus anchor drift check |
| `scripts/gen_test_cases.py` | Regenerates `tests/cases/real_cases.json` from held-out ground truth |
| `scripts/train_model.py` | Trains and persists the IsolationForest |

### Tests

```powershell
# Hermetic: fast, no network, nothing read from data/raw. LLM forced off.
.venv\Scripts\python.exe -m pytest -q

# Real-data integration (gated): full engine over 41 ground-truth cases.
$env:NEXUS_RUN_INTEGRATION=1; .venv\Scripts\python.exe -m pytest -q
```

The hermetic suite is the floor: no existing test may be deleted, renamed, skipped, xfailed, or have an assertion weakened. The integration pass asserts invariants (0% unsupported claims, valid escalation, proof-carrying evidence, typology routing, determinism) and re-measures the pinned anchors in `tests/cases/anchors.json` at ±0.01.

---

## 7. API surface

Responses are enveloped: success is `{ "data": ..., "meta": {...} }`, failure is `{ "error": { "code", "message", "detail?" } }`. Versioned routes live under `/api/v1`; `/health`, `/roster`, and `/investigate` are also served unversioned for backward compatibility.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Readiness, variant, row/account counts, LLM + model presence |
| GET | `/roster` | The real tool roster the planner selects from |
| POST | `/investigate` | NL query → spec, plan, case, findings, narrative, audit |
| POST | `/api/v1/investigations` | Run the pipeline once; **201** with the complete run document (execution summary, planning, tool trace, features, detection, risk, explanation, recommendation, findings, evidence, charts) |
| GET | `/api/v1/investigations` | List cached runs, newest first |
| GET | `/api/v1/investigations/{run_id}` | Full run payload. `latest` works as an alias, so any facet reads without re-running |
| GET | `/api/v1/investigations/{run_id}/plan` · `/planning` · `/execution` | Plan, planning rationale, per-tool telemetry |
| GET | `/api/v1/investigations/{run_id}/features` · `/detection` · `/risk` | Feature manifest, detector output, risk breakdown |
| GET | `/api/v1/investigations/{run_id}/explanation` · `/recommendation` | Validated narrative, escalation |
| GET | `/api/v1/investigations/{run_id}/findings` · `/sections` · `/graph` | Ranked findings, report sections, case graph |
| GET/POST | `/api/v1/investigations/{run_id}/report` | Compose / retrieve the report |
| GET | `/api/v1/investigations/{run_id}/artifacts[/{name}]` | Exported artefacts (incl. PDF) |
| GET | `/api/v1/investigations/{run_id}/charts[/{chart_id}]` | Chart payloads |
| GET | `/api/v1/investigations/{run_id}/evidence[/{claim_id}/transactions]` | Evidence ledger and the transactions proving a claim |
| GET | `/api/v1/entities/{node}[/graph]` | Entity profile, ego graph |
| GET | `/api/v1/transactions` · `/{tx_id}` · `/facets` · `/attribution/{run_id}` | Ledger browsing and attribution |
| GET | `/api/v1/analytics/volume` · `/distributions` · `/corridor-heat` · `/segments` · `/candidates` | Aggregate analytics |
| GET | `/api/v1/analytics/entities/{node}/money-flow` · `/timeline` | Per-entity flow and timeline |
| GET | `/api/v1/models` · `/rules` · `/risk-weights` · `/screening` · `/performance` · `/feature-importance` · `/funnel` · `/outcomes` | Model and rule transparency |
| GET | `/api/v1/audit` · `/{run_id}` | Audit trail |

Hardening: CORS for browser clients, background warmup with readiness reporting, **404 on unknown accounts** (no fabricated cases), structured error envelope, and a lock around the shared DuckDB connection.

> Security note: the API ships with **no authentication** and permissive CORS (`NEXUS_CORS_ORIGINS=*` by default). That is fine for a local demo, but it must not be exposed on a network without adding auth and tightening origins.

---

## 8. Repository structure

```text
hack/
├── README.md                    # this file — the only README
├── ai-agent/
│   ├── backend/
│   │   ├── nexus/                       # importable package
│   │   │   ├── config.py                # paths, variant, FX, thresholds, cost caps
│   │   │   ├── schemas.py               # InvestigationSpec, Hypothesis, EvidenceRecord, Case
│   │   │   ├── ingest.py                # CSV → DuckDB (normalised, tx_id, FX)
│   │   │   ├── profile.py               # dataset profile printer
│   │   │   ├── ground_truth.py          # parsed Patterns — HELD OUT from the agent
│   │   │   ├── intent.py                # NL → validated spec (LLM or deterministic)
│   │   │   ├── hypotheses/library.yaml  # investigator playbooks / fingerprints
│   │   │   ├── planner.py               # per-query tool routing + skip reasons
│   │   │   ├── orchestrator.py          # the investigation loop
│   │   │   ├── scope.py                 # filters that actually scope the analysis
│   │   │   ├── screener.py              # candidate prefilter for broad queries
│   │   │   ├── tools/                   # eda_profile, feature_builder, peer_comparison,
│   │   │   │                            # rapid_pass_through, graph_motif, benign_signals,
│   │   │   │                            # near_threshold, isolation_forest
│   │   │   ├── profiles.py  peers.py  derived.py  graph.py   # features, clusters, subgraphs
│   │   │   ├── ledger.py  duel.py  risk.py  families.py      # evidence + scoring core
│   │   │   ├── casebuilder.py  findings.py  subject.py       # cases and ranked findings
│   │   │   ├── narrator.py  validator.py  llm.py             # explanation + fact-checking
│   │   │   ├── charts.py  reports.py  artifacts.py  trace.py # outputs and telemetry
│   │   │   ├── anomaly.py                                    # IsolationForest wrapper
│   │   │   ├── eval/                    # metrics + baselines
│   │   │   └── api/                     # FastAPI: app, routers, schemas, services, core
│   │   ├── scripts/                     # demo, ring_demo, eval_report, bench, train_model, …
│   │   ├── tests/                       # hermetic suite + gated integration + anchors
│   │   ├── requirements.txt  requirements-dev.txt  .env.example
│   └── data/raw/                        # AMLworld CSVs + Patterns (git-ignored)
└── frontend/
    └── src/
        ├── workspaces/                  # ask, watchtower, cases, graph, ledger, models,
        │                                # reports, audit
        ├── components/                  # chrome, primitives, viz (+ viz/graph)
        ├── lib/api/                     # client, endpoints, mappers, types
        ├── hooks/  store/  data/  types/
        └── App.tsx  main.tsx  index.css
```

API reference is generated from the code and served at `/docs` when the backend is running, so there is no separate API document to drift out of date.

Structural rules worth knowing before contributing:

- The Python package lives under `backend/nexus/`, never at repo root.
- `data/` stays at `ai-agent/` level, shared, git-ignored for raw files.
- **DuckDB is the canonical store.** pandas is only for small slices pulled out for compute.
- **Never build a global graph.** HI-Small is ~5M rows; build NetworkX subgraphs on filtered slices on demand.
- Deterministic row order into ML: `profiles.build_profiles` sorts by node id, because MiniBatchKMeans is row-order sensitive even with a fixed `random_state` and DuckDB joins are not order-stable.
- The frontend talks to the backend only over HTTP.

---

## 9. Data sources

### Transaction data (used)

| Source | What it provides | Link |
|---|---|---|
| **IBM AMLworld / AML-Data** (Altman et al., IBM Research) — synthetic, labelled AML transactions. `HI-Small` and `LI-Small` variants: `Trans.csv`, `Patterns.txt`, `accounts.csv` | The entire transaction population, the held-out typology answer key, and the account→entity map | [github.com/IBM/AML-Data](https://github.com/IBM/AML-Data) |
| **IBM Transactions for Anti Money Laundering (AML)** — the same data mirrored on Kaggle, which is the easier download | Same as above | [kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml) |

### Reference / evaluated but not shipped

| Source | Why it is listed | Link |
|---|---|---|
| **SAML-D** (Bournemouth University) — synthetic AML dataset, 12 features, 28 typologies | Evaluated as the backup for richer *structuring* variety, since AMLworld has no native structuring label. Not required in the end: structuring is covered by the configurable near-threshold band plus seeded cases | [eprints.bournemouth.ac.uk/40982](https://eprints.bournemouth.ac.uk/40982/) |

### Generated in-repo (no external source)

| Data | Produced by |
|---|---|
| Seeded structuring case, smurfing ring (`0500\|C1`), benign-lookalike merchant (`0900\|M1`) | `nexus/seeds.py` |
| Account profiles, behavioural peer clusters, transaction subgraphs | `nexus/profiles.py`, `peers.py`, `graph.py` |
| 41 real integration cases (`tests/cases/real_cases.json`) | `scripts/gen_test_cases.py`, from held-out `Patterns.txt` |
| Pinned anchor values (`tests/cases/anchors.json`) | Recorded measurements from the phase log |
| Stub FX table (units per USD, 15 currencies) | `nexus/config.py` — approximate and explicitly a placeholder |
| Frontend demo scenarios (used only when the engine is unreachable, labelled as demo in the UI) | `frontend/src/data/*.ts` |

### Domain / regulatory background (context, not data)

FinCEN (US financial-crime regulator) and FATF (global AML standards body) define the reporting obligations and typology vocabulary — structuring, smurfing, layering, SAR filing — that the escalation ladder models. No data is drawn from them.

No real customer data, PII, or production financial records are used anywhere in this project.

---

## 10. Evaluation and honest limits

Measured against `Is Laundering` labels and the held-out `Patterns.txt`, on **41 real HI-Small cases**. Detection numbers are from the last recorded gated integration pass; re-run it with `NEXUS_RUN_INTEGRATION=1` to reproduce them locally.

| Metric | Value |
|---|---|
| Unsupported-claim rate | **0%** (validator-enforced) |
| Confusion (n=41) | tp 7 / fp 5 / fn 14 / tn 15 |
| Precision | 0.583 |
| Recall | 0.333 |
| F1 | 0.424 |
| Hermetic suite | 389 passed / 8 skipped (the 8 skips are the gated integration tests) |
| Full suite with integration | 397 collected — the 8 gated tests run once `NEXUS_RUN_INTEGRATION=1` is set |

Pinned anchors, reproducible to ±0.01: Phase 2 fixture evidence set → **86.65**; ring fixture hub `0500|C1` → **56.00**; case fixture hub → **45.54**; real HI-Small node `0048309|811C599A0` → **53.18** (stable per rebuild only since the profile row order was pinned — before that it drew from [52.08, 52.86, 53.18]).

What this project **does not** claim:

- **No precision superiority over a tuned threshold on AMLworld.** Root cause, established by experiment: AMLworld labels rings by *graph topology* (fan-in shape), so an `in_degree` threshold is near-optimal by construction, and behavioural/temporal/amount features cannot beat it because the ground truth does not encode them. That is a benchmark property, not an architecture flaw. The attempts and their held-out precision: benign-discriminating features (retention / recurrence / stability + a pooler hypothesis) cut false positives on the test negatives ~5× and moved precision 0.23 → **0.34**; adding temporal features gave 0.28; adding subset/burst detection gave 0.20. None beat a tuned fan-in threshold at 0.42, so no superiority claim is made.
- The real differentiators are **explainability** (proof-carrying evidence, 0% unsupported claims), the **benign duel** (benign-lookalike downgrade and salary-payer exclusion, both demonstrated), **case compression**, and **challengeability**.
- **Recall is traded for precision** by the benign gate: a real ring with recurring, stable full-history activity can be downgraded. This is a known, documented false negative.
- **Online learning is roadmap.** Analyst dispositions are captured and there is a weight-nudging hook, but the feedback loop does not retrain today.
- Known rough edge: `intent._filters` matches month names by substring, so a query containing "maybe" sets `month: "May"`. No anchor or test is affected; the fix is a word-boundary regex.
- Success bars are fixed before results and not moved afterwards. Sensor recalibration must be reported with before/after on every affected anchor.

---

## 12. Glossary

| Term | Plain meaning |
|---|---|
| **AML** | Anti-Money Laundering — the bank's program to detect and report laundering |
| **Money laundering** | Making illegally obtained money look legitimate |
| **Placement / Layering / Integration** | The three stages: get cash in → hide the trail → bring it back clean |
| **Structuring** | Splitting a large sum into smaller deposits just under a reporting threshold |
| **Smurfing** | Structuring using many people making many small deposits |
| **Layering** | Moving money through many accounts or loops to obscure its origin |
| **Typology** | A known method or pattern of laundering |
| **Fan-in / fan-out** | Many senders → one account / one account → many receivers |
| **False positive** | An innocent transaction wrongly flagged as suspicious |
| **SAR** | Suspicious Activity Report — the official regulator filing ("report") |
| **KYC** | Know Your Customer — background information a bank holds on a customer |
| **FinCEN / FATF** | US financial-crime regulator / global AML standards body |
| **Escalation** | The action on a flag: monitor / review / report |
| **Evidence record** | A single verifiable finding, pointing at exact transaction IDs |
| **Hypothesis (fingerprint)** | A theory expressed as expected evidence directions plus importances |
| **Evidence family** | A category of signal, e.g. `flow_through`, `peer_deviation` |
| **Counterfactual** | Recomputing the risk score with one evidence family removed |
| **Peer group** | A behaviourally similar cluster of accounts, used as the "normal" baseline |
| **Anchor** | A pinned numeric result that must not move without a reported before/after |

---

> NEXUS does not automate suspicion. It automates the collection and verification of evidence — so investigators make faster, more defensible decisions.
