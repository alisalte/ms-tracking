# Implementation plan — recommended re-phasing

User’s 3-phase list does **not** match repo maturity or canonical vision §7. Below is a delivery plan optimized for **value on existing foundations**, then new domains, then ML/assistant/twin.

## Reality check vs user phases

| User phase | Items | Problem |
|------------|-------|---------|
| “ارزش سریع” | Behavior, Health Score, Fuel, Geofence Intel, Report Builder | Fuel + true Health Score + full Report Builder are **not** quick; Geofence dwell already mostly done |
| Phase 2 | Predictive+CMMS, AI Video, Digital Twin | Predictive before CMMS is inverted; Twin is premature |
| Phase 3 | Assistant, ETA, Optimization | ETA/Optimization need trip maturity; Assistant needs trusted metrics first |

## Recommended phases

### Phase Q0 — Foundations (2–4 weeks, unblockers)

| Work | Why |
|------|-----|
| Driver assignment history + alarm attribution | Unblocks F-01 and driver reports truth |
| Approve Driver Behavior SRS + DMS auto-capture SRS | Clears blocked requirements |
| Trip/route minimum viable (assigned destination or planned polyline) | Unblocks F-04 stretch, F-10, F-11 |

### Phase Q1 — Quick value (reuse live signals) ≈ user “ارزش سریع” but realistic

| Priority | ID | Slice | Effort band |
|----------|----|-------|-------------|
| 1 | F-04 | Geofence Intelligence **v1 complete**: polish dwell analytics / filters (baseline already shipped) | S |
| 2 | F-01 | Driver Behavior Sprint 1–2 (events + score + ranking) | M–L |
| 3 | F-07 | AI Video Events **v1**: auto evidence on DMS/ADAS | M |
| 4 | F-05 | Report Builder **v1**: schedule + email existing reports | M |
| 5 | F-02 | Fleet Health Score **v1**: rule-based score from connectivity + open alarms | S–M |

**Defer from Q1:** Fuel Analytics (new domain), full custom report canvas, ML health.

### Phase Q2 — Operations domains

| Priority | ID | Slice | Effort band |
|----------|----|-------|-------------|
| 1 | F-06a | CMMS / Vehicle Maintenance **core** (replace stub; work orders / schedules) | L |
| 2 | F-03 | Fuel Analytics **v1** (events + consumption report + theft heuristics if sensors exist) | L |
| 3 | F-04 | Geofence Intelligence **v2**: route/corridor compliance | M |
| 4 | F-10 | ETA Prediction **v1**: live recompute on active trips | M |
| 5 | F-01 | Driver Behavior Sprint 3 (coaching + video evidence) | M |

### Phase Q3 — Intelligence & optimization

| Priority | ID | Slice | Effort band |
|----------|----|-------|-------------|
| 1 | F-06b | Predictive Maintenance (after work-order + feature history) | L |
| 2 | F-05 | Report Builder **v2**: templates / visual builder | L |
| 3 | F-11 | Optimization Engine **v1**: multi-stop optimize → apply as trip | L |
| 4 | F-07 | AI Video **v2**: optional cloud AI quality layer | L |
| 5 | F-02 | Fleet Health Score **v2**: include maintenance + predictive inputs | M |

### Phase Q4 — Advanced / optional

| Priority | ID | Slice | Notes |
|----------|----|-------|-------|
| 1 | F-09 | AI Fleet Assistant | After Q1–Q2 metrics are trustworthy |
| 2 | F-08 | Digital Twin (ops projection first) | Only if product scopes twin ≠ “another dashboard” |
| 3 | F-11 / F-10 | Closed-loop re-optimize on ETA/traffic | Depends on Q2–Q3 |

## Mapping user ✅ list → recommended phase

| Capability | Recommended phase | Do not start until |
|------------|-------------------|--------------------|
| Geofence Intelligence | Q1 (finish) → Q2 (corridor) | — |
| Driver Behavior | Q1 | Assignment history + SRS approval |
| AI Video Events (evidence) | Q1 | Capture SRS approval |
| Report schedule | Q1 | — |
| Fleet Health Score (rules) | Q1 | Score formula agreed |
| CMMS core | Q2 | Buy vs build decision |
| Fuel Analytics | Q2 | Fuel data source decided |
| Live ETA | Q2 | Trip destination model |
| Predictive Maintenance | Q3 | CMMS history |
| Optimization Engine | Q3 | Stops + constraints model |
| AI Fleet Assistant | Q4 | Trusted APIs + audit |
| Digital Twin | Q4 | Product definition |

## Exit criteria (per phase)

| Phase | Exit when |
|-------|-----------|
| Q0 | Assignment history live; critical SRS approved |
| Q1 | Driver Score in prod for ≥1 tenant; DMS evidence auto-attaches; ≥1 scheduled report; health score on dashboard |
| Q2 | Maintenance page is real; fuel report or ETA live on assigned trips |
| Q3 | Predictive recommendation used in a work order; optimize produces applied route |
| Q4 | Assistant answers ops questions with citations; twin API used by ≥1 workflow |

## Relation to vision §7

- Q0–Q1 ≈ finish Phase 1 gaps + early Phase 2 (driver/behavior)
- Q2 ≈ Phase 2–3 (maintenance, fuel, media hardening)
- Q3–Q4 ≈ Phase 4 Intelligence (+ unscoped Assistant/Twin)
