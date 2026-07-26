# Training the anomaly model

NEXUS-AML ships one persisted model: an **IsolationForest** over behavioural account
profiles. It is unsupervised — labels are never read during training, so there is no leakage
from `Is Laundering` or the held-out `*_Patterns.txt`.

Everything else in the engine is either rule-based, statistical, or fitted live at request
time (the MiniBatchKMeans peer clustering), so this is the only step that produces a file on
disk.

---

## What the model is for

The anomaly score is used in exactly two places, and neither of them decides a verdict:

| Use | Where | Effect on the outcome |
|---|---|---|
| **Neutral evidence family** `anomaly` | `nexus/tools/isolation_forest.py` | None. `anomaly` appears in no hypothesis fingerprint and carries no weight in `RISK_WEIGHTS`, so it cannot move a risk score or flip a duel. It is recorded so the case file can say "the black-box model rated this 0.82, and here is why NEXUS still concluded benign." |
| **Generic-AI evaluation baseline** | `nexus/eval/baseline.py` | It is the thing NEXUS is measured against, not part of NEXUS's own score. |

That is why the engine runs perfectly well without it. `/health` reports
`anomaly_model: false`, the planner declines the tool and says why in the plan trace —

```
no trained model artifact in models/ (run scripts/train_model.py)
```

— and all 389 hermetic tests still pass.

---

## Prerequisites

1. The backend virtual environment, installed from `backend/requirements.txt`
   (scikit-learn brings `joblib`, which is what persists the artefact).
2. **HI-Small in place** at `ai-agent/data/raw/`:
   - `HI-Small_Trans.csv`
   - `HI-Small_accounts.csv`

   `HI-Small_Patterns.txt` is *not* needed for training — it is held-out ground truth and the
   training path never touches it.

Confirm the data loads before training:

```powershell
cd ai-agent\backend
.venv\Scripts\python.exe -m nexus.ingest --variant HI-Small
```

You should see 5,078,345 transactions and 515,088 accounts profiled.

---

## Train it

One command, run once:

```powershell
cd ai-agent\backend
.venv\Scripts\python.exe scripts\train_model.py
```

bash equivalent:

```bash
cd ai-agent/backend
.venv/bin/python scripts/train_model.py
```

Expect a few minutes: the script ingests HI-Small into DuckDB, builds the account profile
table, fits the forest, and prints the score distribution before exiting.

```
training IsolationForest on 515,088 account profiles (unsupervised) ...
saved -> ...\ai-agent\models\isoforest.joblib
anomaly score distribution: min=0.000 median=0.### p99=0.### max=1.000
```

### Where the artefact goes

`ai-agent/models/isoforest.joblib` — note **`models/`**, plural, at the `ai-agent/` level, not
this folder. The path is defined once, in `nexus/anomaly.py`:

```python
MODEL_PATH = REPO_ROOT / "models" / "isoforest.joblib"
```

The directory is git-ignored: the model is reproducible from the data and the seed, so the
binary is never committed.

---

## What the script actually does

`scripts/train_model.py` is deliberately thin — four steps, no hidden state:

1. `load_dataset(Settings(variant="HI-Small"))` — CSV into DuckDB, normalised, FX-converted.
2. `build_profiles(con)` — one row per `bank|account`, **sorted by node id**. The sort matters:
   row order reaches the clustering downstream, and an unstable order moves risk scores
   between rebuilds.
3. `anomaly.train(profiles)` — fit.
4. `anomaly.save(model)` — pickle to `models/isoforest.joblib`.

Inside `anomaly.train`:

| Step | Detail |
|---|---|
| Features | The nine columns in `profiles.CLUSTER_FEATURES`: `out_count`, `out_sum`, `out_degree`, `in_count`, `in_sum`, `in_degree`, `txn_count`, `velocity`, `span_days` |
| Transform | `log1p` on every feature (counts and sums are heavy-tailed), then `StandardScaler` |
| Estimator | `IsolationForest(n_estimators=100, contamination=0.01, random_state=0, n_jobs=-1)` |
| Score | `-decision_function`, so higher means more anomalous |
| Normalisation | Min-max against the 1st and 99th percentiles of the training scores, clipped to `[0, 1]` |

The persisted object carries the forest, the scaler and those two percentiles together, so a
score computed at request time is on the same scale as at training time.

### Tuning

`train()` takes two arguments if you want to experiment from a REPL or your own script:

```python
from nexus import anomaly
from nexus.config import Settings
from nexus.ingest import load_dataset
from nexus.profiles import build_profiles

ds = load_dataset(Settings(variant="HI-Small"))
profiles = build_profiles(ds.con)

model = anomaly.train(profiles, seed=0, contamination=0.01)
anomaly.save(model)
```

- `contamination` — the assumed share of anomalies. Raising it makes the forest flag more
  accounts; it changes the score distribution, not the ranking, in most cases.
- `seed` — `random_state`. Keep it at 0 unless you are deliberately testing stability; a
  different seed produces a different artefact and different `anomaly` values in case files.

Retraining on `LI-Small` (the low-illicit variant used for false-positive evaluation) is a
one-word change: `Settings(variant="LI-Small")`. Be aware that this overwrites the same
artefact path, so the live engine will start scoring against an LI-fitted model.

---

## Verify it landed

Ask the engine:

```powershell
.venv\Scripts\python.exe -m uvicorn nexus.api.app:app --reload
# then
curl http://127.0.0.1:8000/health
```

`anomaly_model` flips from `false` to `true`.

Or read the artefact's provenance without loading it, which is what the UI's Models workspace
shows:

```powershell
.venv\Scripts\python.exe -c "from nexus import anomaly; print(anomaly.identity())"
```

```
ArtifactIdentity(present=True, path='...isoforest.joblib', name='isolation_forest',
                 kind='unsupervised', version='<12-char sha>', trained_at='<UTC>',
                 sha256='...', bytes=..., features=('out_count', ...))
```

Every field there is read off the file itself — modification time, a digest of the bytes, and
the exact feature list the module scores with. The short digest doubles as the version,
because nothing stamps a semantic version into the artefact. There is deliberately **no**
drift or PSI figure: nothing in the pipeline computes one, and inventing a number for a
provenance strip would defeat the purpose of a provenance strip.

To see it in a case, run an investigation and look for the `anomaly` claim in the evidence
ledger — with a note that it carries no risk weight.

---

## Retraining and removal

- **Retrain:** run the same command again. It overwrites the artefact in place; the digest and
  `trained_at` change, so any case file recorded earlier can be told apart from later ones.
- **Remove:** delete `ai-agent/models/isoforest.joblib`. `/health` returns to
  `anomaly_model: false` and the planner declines the tool with the reason above. Nothing else
  degrades — no risk score, tier, escalation or narrative depends on it.

## Things worth knowing before you retrain

- **No labels, ever.** If you add a supervised model later, keep it out of the detector path
  or the held-out evaluation stops meaning anything.
- **Deterministic input order is a requirement, not a nicety.** `build_profiles` sorts by node
  id because DuckDB's joins are not order-stable and the clustering downstream is row-order
  sensitive even with a fixed `random_state`. Any new frame that feeds a model must impose its
  own total order.
- **Recalibration must be reported.** Changing features, transforms, `contamination` or the
  seed changes what the `anomaly` family reports. It cannot move the pinned risk anchors —
  `anomaly` is outside `RISK_WEIGHTS` by design — but before/after values should still be
  stated rather than quietly replaced.
- Training reads the whole 5M-row table into a profile frame; on a laptop expect a few minutes
  and a couple of GB of memory.
