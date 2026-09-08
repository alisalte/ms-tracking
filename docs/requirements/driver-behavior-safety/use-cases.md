# Use cases

Draft.

## UC-01 Detect behavior event

**Actor:** System  
**Flow:** Telemetry/alarm arrives → detection rule matches → event stored → optional notify → included in next score run.

## UC-02 View driver score & events

**Actor:** Manager / operator  
**Flow:** Open Driver Dashboard → see score for period → drill into contributing events → optional open evidence.

## UC-03 Compare drivers (ranking)

**Actor:** Manager  
**Flow:** Open Ranking → choose period/scope → sort/filter → open a driver.

## UC-04 Notification on severe behavior

**Actor:** System → Manager/operator (and maybe Driver)  
**Flow:** Rule fires → notification delivered → recipient opens event/driver context.

## UC-05 Coaching (Sprint 3)

**Actor:** System (+ Manager if approval required)  
**Flow:** Pattern detected or score trigger → coaching item created → delivered/acknowledged.

## UC-06 Risk watchlist (Sprint 3)

**Actor:** Manager  
**Flow:** View predicted high-risk drivers → prioritize coaching or operational action.
