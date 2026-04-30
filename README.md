# X 2026 Recommendation Algorithm — Code & Analysis

Companion code for the paper **"Inside the Machine: A Technical Analysis of X's 2026 Recommendation Algorithm"**.

This repo contains everything needed to reproduce the experiments in the paper.
The paper itself lives in a separate private repo; the data is hosted externally (links below).

---

## What This Repo Contains

| File | What it does |
|---|---|
| `attn-mask.ipynb` | Verifies the attention mask structure in X's PhoenixModel. Runs 3 experiments: mask structure check, softmax confirmation (zero candidate-to-candidate weights), and the end-to-end isolation test (C1 bit-exact across permutations). |
| `rope.ipynb` | Formal verification of RoPE positional decay. Plots the attention logit envelope $U(\tau)$ as a function of sequence distance for X's configuration ($B=10^4$, $d=64$), confirming the decay and recency bias derived analytically in the paper. |
| `bluesky_inc_analysis.ipynb` | Applies X's full recommendation pipeline (Thunder → Phoenix → WeightedScorer) to Bluesky social graph data and measures the INC ratio. Compares to X's observed 27.5% group mean. |

---

## Background

In January 2026, X open-sourced its recommendation system at [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm). For the first time, the code that decides what appears in every user's For You feed is available for independent analysis.

Our paper identifies two structural mechanisms that suppress in-network content (posts from accounts you follow) regardless of model weights:

1. **Thunder/Phoenix retrieval asymmetry** — Thunder retrieves in-network posts but is bounded by follow-list size; Phoenix searches the entire global corpus with no constraint.
2. **Shared user token** — all candidates are scored against the same user context simultaneously, propagating topical engagement bias uniformly.

We verify both mechanically and confirm them in real feed observations (27.5% mean INC ratio across 4 participants).

---

## Running the Notebooks

All three notebooks are designed to run on **Google Colab** (free tier is sufficient for `attn-mask.ipynb` and `rope.ipynb`; Colab Pro recommended for `bluesky_inc_analysis.ipynb` due to the 1.5 GB data download).

### attn-mask.ipynb and rope.ipynb

These have no external data dependencies.

1. Open [colab.research.google.com](https://colab.research.google.com)
2. Upload the notebook (File → Upload notebook)
3. Run all cells (Runtime → Run all)

Dependencies installed automatically in the first cell: `jax`, `jaxlib`, `haiku` (`dm-haiku`).

### bluesky_inc_analysis.ipynb

Requires downloading two files from the Bluesky dataset.

**Dataset:** Failla & Rossetti, *Bluesky Social Dataset v3*
- DOI: [`10.5281/zenodo.14669616`](https://zenodo.org/records/14669616)
- Direct URL: https://zenodo.org/records/14669616

**Files used** (only these two, not the full 19.5 GB corpus):

| File | Size | Purpose |
|---|---|---|
| `followers.csv.gz` | 491 MB | Social graph (follower → followee integer ID pairs, no header) |
| `interactions.csv.gz` | 1.0 GB | Engagement events (actor-ID, _, _, subject-author-ID, _, timestamp — 6 cols, cols 1/2/4 are null) |

The notebook downloads these automatically in Section 2 using `wget`.

**Steps:**
1. Open Colab → Runtime → Change runtime type → **T4 GPU** (for RAM)
2. Upload `bluesky_inc_analysis.ipynb`
3. Run from top to bottom
4. Section 2b prints column names — verify they match the config in Section 1 (they should)
5. Sections 3–9 run the pipeline and produce results
6. Section 10 prints the numbers for the paper

**Expected runtime:** ~30–45 min for the full 500-user pipeline.

---

## What the Experiments Show

### attn-mask.ipynb

- The attention mask has exactly 3 regions: causal (user+history), context (candidates → user), self-only (candidates isolated from each other)
- 6 candidate-to-candidate positions are blocked that a standard causal mask would permit
- After softmax, candidate rows have **exactly zero** weight on all other candidate columns (not approximately zero — machine precision)
- C1's output is **bit-identical** across two permuted candidate sequences, confirming batch-composition-invariance

### rope.ipynb

- RoPE creates a logit envelope $U(\tau) = \sum_{k=0}^{d/2-1} \cos(\tau \theta_k)$ that decays with sequence distance $\tau$
- After softmax amplification, the most recent history token receives exponentially more attention weight than older tokens
- This is a **structural, untrained recency bias** — holds for any set of learned weights

### bluesky_inc_analysis.ipynb

- Applies X's retrieval and ranking pipeline to matched Bluesky users (follow count 67–1500, $N=500$)
- Computes INC ratio: fraction of the simulated For You feed that comes from followed accounts
- Compares to X's observed 27.5% group mean
- Sensitivity sweep over OON penalty $\delta \in \{0.10, 0.25, 0.50, 0.75, 1.00\}$

---

## Reproducing the Paper's Figures

| Figure | Source | How to regenerate |
|---|---|---|
| Figure 1 (RecSys mask) | `attn-mask.ipynb` | Run Section "Mask structure check" |
| Figure 2 (RecSys vs causal) | `attn-mask.ipynb` | Run Section "Mask comparison" |
| Figure 4 (QK → softmax) | `attn-mask.ipynb` | Run Section "Softmax confirmation" |
| Figure 5 (isolation test) | `attn-mask.ipynb` | Run Section "End-to-end isolation" |
| Figure 7 (feature ablation) | `attn-mask.ipynb` | Run Section "Feature ablation" |
| Bluesky INC bar chart | `bluesky_inc_analysis.ipynb` | Run Section 10 |

---

## Citation

```bibtex
@article{anonymous2026xrecsys,
  title   = {Inside the Machine: A Technical Analysis of X's 2026 Recommendation Algorithm},
  author  = {Anonymous},
  year    = {2026}
}
```

**Dataset citation:**
```bibtex
@misc{failla2025dataset,
  author = {Failla, A. and Rossetti, G.},
  title  = {Bluesky Social Dataset (v3)},
  year   = {2025},
  doi    = {10.5281/zenodo.14669616},
  url    = {https://zenodo.org/records/14669616}
}
```

---

## Dependencies

```
python >= 3.10
jax
jaxlib
dm-haiku
pandas
numpy
matplotlib
tqdm
```

All installed via `pip` in the first cell of each notebook.
No GPU required for `attn-mask.ipynb` or `rope.ipynb`.
`bluesky_inc_analysis.ipynb` benefits from Colab's high-RAM runtime.
