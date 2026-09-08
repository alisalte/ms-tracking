# Open questions

Only blockers for a complete SRS / safe implementation.

## Critical

1. **Detection source:** Server-side from telemetry, device alarms (Meitrack event codes), or both? Per event type?
2. **Definitions:** Exact rules for hard brake, overspeed (map limit vs fixed), and idle (duration, ignition, exclusions)?
3. **Driver Score formula:** Scale, weights, period, decay, minimum activity before score is shown?
4. **Attribution:** Is durable driver–vehicle assignment history required before Sprint 1 score goes live?
5. **MVP cut:** Ship Sprint 1 only first, or commit to all three sprints as one program?

## Important

6. **Ranking scope:** Whole tenant, per fleet, hide drivers below min activity?
7. **Notifications:** Channels (in-app / email / SMS), recipients (manager only vs driver), severity matrix?
8. **Video Evidence:** Which event types get media? Same policy as DMS capture (photo + 15 s)?
9. **AI Coaching:** Auto-send to driver vs manager-approved tips? Language FA/EN?
10. **ML Risk:** Predict what (crash / score drop / violation) over what horizon? Action on high risk?

## Optional

11. Include harsh acceleration / sharp turn in Sprint 1 score or later?
12. Driver-visible ranking (gamification) or managers only?
13. Manual exclude/override of events from score?

## Changelog

- 2026-09-08: Initial questions from sprint backlog intake.
