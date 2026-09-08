# Functional requirements

Draft from sprint backlog. **No formulas or thresholds invented** — see open questions.

## Sprint 1

### FR-DET-01 Hard brake detection

The system shall detect hard-brake events and associate them with vehicle, time, and (when attributable) driver.

### FR-DET-02 Overspeed detection

The system shall detect overspeed events and associate them with vehicle, time, speed context, and (when attributable) driver.

### FR-DET-03 Idle detection

The system shall detect idle events (definition TBD) and associate them with vehicle, duration, time, and (when attributable) driver.

### FR-SCORE-01 Driver score

The system shall compute a Driver Score per driver for a defined period, based on agreed event types and rules, and make the latest score available to authorized users.

### FR-SCORE-02 Event history for scoring

The system shall retain behavior events used for scoring for an agreed retention window so scores can be explained (event list / breakdown).

## Sprint 2

### FR-RANK-01 Ranking

The system shall present a ranking of drivers by score for a selectable period and scope (e.g. fleet / tenant), with filters TBD.

### FR-DASH-01 Driver dashboard

The system shall provide a per-driver dashboard showing score, period comparison/trend (TBD), and recent behavior events.

### FR-NOTIF-01 Notifications

The system shall notify configured recipients when notification rules fire (e.g. severe event, score drop) through agreed channels.

## Sprint 3

### FR-VID-01 Video evidence

The system shall attach or retrieve video/photo evidence for supported event types and present it in the driver/event context.

### FR-COACH-01 AI coaching

The system shall generate or recommend coaching content tied to a driver’s recent events or score pattern (human approval TBD).

### FR-ML-01 Risk prediction

The system shall expose a predictive risk indicator for drivers (and/or vehicles/trips) based on historical behavior and agreed features.

## Cross-cutting

### FR-ATTR-01 Driver attribution

Behavior events used for score/ranking shall be attributed to a driver using a defined assignment-at-time rule (or explicitly marked unattributed).

### FR-AUDIT-01 Explainability

Authorized users shall be able to see which events contributed to a driver’s score for a period (level of detail TBD).
