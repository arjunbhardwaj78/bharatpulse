# BharatPulse

**Turn 40 scattered water complaints into one clear incident: "Ward 12 has no water, 9 households, getting worse."**

Water departments receive complaints one at a time, by phone, app or WhatsApp. Nobody sees the pattern until it is
already a crisis. BharatPulse groups complaints that point at the same problem, scores how serious it is, explains
the score, and suggests a first response.

> **Status: Stage 1 of 6.** The detection engine is built and tested. The API, dashboards and deployment come next
> (see the roadmap). All demo data is simulated; there are no real users or deployments yet.

## What the engine does

`complaints in -> incidents out`, as one pure function:

```ts
import { detectIncidents } from '@bharatpulse/engine';

const { incidents, isolated, rejected, duplicatesRemoved } = detectIncidents(complaints, Date.now());
```

Pipeline: **validate -> de-duplicate -> cluster -> score -> recommend**.

| Step | What happens | Why |
|---|---|---|
| Validate | Bad coordinates, unknown issue types, duplicate ids and future timestamps are rejected *with a reason* | Nothing is silently lost |
| De-duplicate | Repeat reports from one person (same issue family, within 30 min) count once | One person cannot fake an outage |
| Cluster | Spatio-temporal DBSCAN, run per issue family | Finds incidents without knowing how many exist; follows an outage along a street |
| Score | 0-100 from five visible factors | Officers can see *why* an incident ranks high |
| Recommend | Rule-based first action by issue family and level | Auditable, no black box |

### How clustering works (plain words)
Two complaints are **neighbours** if they are within 500 m *and* within 3 hours of each other. A complaint with at
least 3 neighbours (itself included) is a **core point** and starts a cluster. Anything reachable from a core point
joins that cluster, so the cluster can stretch along a pipe line. Complaints that never reach a cluster are
**isolated**, shown but not raised as incidents.

"No water" and "low pressure" count as one **supply** family. "Dirty water" (health risk) and "leak"
(infrastructure) are separate, so a health problem is never buried inside a supply outage.

### How the score works
| Factor | Max | Meaning |
|---|---|---|
| Volume | 35 | Households reporting (log scale: the 3rd complaint matters more than the 30th) |
| Velocity | 20 | New reports in the last 30 min: is it still growing? |
| Spread | 15 | How wide the affected area is |
| Duration | 15 | How long it has been going on |
| Issue type | 15 | Health risk 15, supply 10, leak 6 |

Levels: LOW below 35, MEDIUM 35+, HIGH 55+, CRITICAL 75+. Every number is configurable in `config.ts`.

## Run it

```bash
npm install
npm test          # 30 tests
npm run typecheck
npm run build
node packages/engine/examples/demo.mjs   # prints a worked example
```

## Design decisions
- **Pure and deterministic.** Same input gives the same output (tested), so it is safe to re-run on every new complaint.
- **Explainable over clever.** Rules and a transparent score, not a model. AI is reserved for messy text input in a later stage.
- **Honest limits.** Clustering is O(n^2) per family, fine for a ward-sized live window (thousands of complaints). A grid index is the upgrade path. Location accuracy depends on citizen GPS.

## Roadmap
- [x] 1. Detection engine and tests
- [ ] 2. API and database (complaints in, incidents out, officer actions)
- [ ] 3. Citizen intake (Hindi and English)
- [ ] 4. Officer dashboard with live map
- [ ] 5. Demo simulator
- [ ] 6. Deployment, CI, demo video, case study
