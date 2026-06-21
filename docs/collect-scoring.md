# Collection layer — scoring, cross-verification, budget

The collection layer is the core differentiator (`apps/daemon/src/collect/*`). Per locked
decision ④, **Playwright/CDP is the primary read path and the model is used only at hotspot
judgment and cross-verification.** This doc specifies the three mechanisms that the PLAN.md
overview only sketches.

Related: [`../PLAN.md`](../PLAN.md) §2.4 (data models) / §4 Phase 7.

---

## 1. Hotspot scoring — two stages

The model is expensive and rate/ToS-sensitive, so scoring is split: a cheap rules prefilter
runs on everything; the model scores only the survivors.

### Stage A — rules prefilter (no model, every item)

Compute `prefilterScore ∈ [0,1]` as a weighted sum of signals available directly from the DOM/RSS:

| Signal | Formula | Notes |
|---|---|---|
| Recency | `exp(-ageHours / τ)`, τ ≈ 12h | freshness decay |
| Engagement velocity (X) | `log1p((likes + 2·reposts + 3·replies) / max(ageHours, 0.5))`, min-max normalized | replies/reposts weighted above likes |
| Novelty | `1 − maxSimilarity(title, seenTitles)` via SimHash/embedding | dedupes near-repeats |
| Source trust | per-source prior in `[0,1]` | configured per source |
| Topic match | `cosine(item, userNicheKeywords)` | aligns with user interests |

```
prefilterScore = Σ wᵢ · signalᵢ        (weights sum to 1; defaults in config)
```

**Gate:** keep items with `prefilterScore ≥ T_pre` (default `0.55`) **and** cap to **top-K**
(default `20`). The top-K cap is what bounds model spend regardless of feed volume.

### Stage B — model scoring (the only model call in collect)

Batch the survivors into one prompt. The model rates each item against a rubric and returns:

```jsonc
{
  "score": 0.0,                 // 0..1 hotspot-worthiness
  "signalKind": "hot-take",     // engagement-spike | new-tech | hot-take | trend
  "oneLineWhy": "…"
}
```

Rubric axes: niche relevance · discussion/controversy potential · durability · factual
checkability.

**Final score** (persisted on `Hotspot.signal.score`):

```
score = α · prefilterScore + β · modelScore     (defaults α = 0.4, β = 0.6)
```

---

## 2. Provenance cross-verification

`ProvenanceNode` is **immutable / append-only**:

```ts
{ id, hotspotId, sourceUrl, quote, screenshotPath?, confidence: 0..1, crossRefs[], capturedAt }
```

Cross-verification is an allowed model use:

1. **Claim extraction** — the model extracts atomic claims from a candidate.
2. **Corroboration search** — for each claim, find supporting/contradicting nodes across
   **other captured sources**, scored by text similarity **and domain independence**
   (a different registrable domain counts as an independent source).
3. **Confidence** — seeded by the source-trust prior, then:

   ```
   confidence = clamp(0.4 + 0.2·log2(1 + independentCorroborations) − 0.3·contradictions, 0, 1)
   ```

4. **crossRefs** store `{ targetNodeId, relation: 'corroborates' | 'contradicts', similarity }`.
   Graph traversal is **depth-capped at 2** to prevent runaway expansion (this is the bound the
   ≥90%-coverage crossRef test exercises).

---

## 3. Budget caps

A persisted **BudgetLedger**, surfaced in the UI, enforces hard limits per patrol and per run.

### Per-patrol (collect)
- `maxModelCalls`, `maxTokens`, `maxWallMs`, `topK` (survivors sent to the model).
- Counters are hard: on exceed, stop and mark the patrol `partial` rather than overrun.

### Per-AgentRun (write/edit)
- `stepBudget`, token cap.
- Lost-detection (over budget · N steps with no artifact write · repeated identical tool call)
  → abort/restart. See
  [`agent-layer.md`](./agent-layer.md#pipe-runner-replaces-node-pty-spawn).

### Prompt size
- `maxPromptArgBytes` → `RuntimePromptBudgetError`. This also ties to the Windows command-line
  limit — see
  [`windows-compat.md`](./windows-compat.md#42-spawn-enametoolong--command-line-length-not-path).

### Illustration (fal.ai)
- Per-day image-count cap + a per-image cost-estimate guard checked before submit.
