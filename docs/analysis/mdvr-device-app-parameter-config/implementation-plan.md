# Implementation plan

## Phase 1A — Foundation

1. Product event catalog (codes + labels FA/EN) aligned to screenshots + `MEITRACK_EVENTS`
2. Protocol research: delay-recording, VOICE, Screenshot/OSD, Input events — add missing catalog encodes or mark unsupported
3. Server `parameter/alarm-link` composer (or documented client composition)

## Phase 1B — UI

1. Command Center tab / route for Device Parameter → Alarm  
2. Event table + Refresh  
3. Link Sett drawer + Setting/Cancel  
4. ACK progress + errors  
5. i18n + permissions + tests

## Phase 1C — Harden

1. Readback merge where possible  
2. Optional snapshot cache  
3. Disable unsupported outputs/checkboxes with tooltip

## Phase 2A — Network

1. Parameter sub-nav Alarm | Network  
2. Composite Network form (A21 / A23 / A11 / A12 / A15)  
3. DB4 Refresh + history merge + local snapshot  

## Phase 2B — Configuration State / Readback foundation

Shared client foundation before Media / AI sections:

1. `device-parameter-state` — snapshot source model, section-keyed localStorage, source resolve + i18n keys  
2. Shared `waitForParameterCommandAck` + `runParameterProbes` (soft-fail non-ACK)  
3. Section registry (`alarm`/`network` shipped; `media`/`ai` planned)  
4. Refactor Alarm + Network panels onto the shared helpers (behavior-preserving)

## Phase 3 — Media

1. Parameter sub-nav + `section=media`
2. Composite Media form: **BB8** speaker volume + **B64** FTP photo upload
3. Empty-param BB8/B64 Refresh via Phase 2B probe runner
4. Note: event-linked CH recording stays under Alarm (CB8); live/playback stay in catalog

## Phase 4 — AI / C90

1. Parameter sub-nav + `section=ai`
2. Composite AI form: **C90** alert volume + absence / distraction / smoking / phone-call toggles
3. Empty-param C90 Refresh via Phase 2B probe runner
4. One-shot **CD1** “Start DMS calibration” action (not part of sett cache)
5. Honest limitation: C90 does not configure photo/clip capture duration

## Phase Alerts+ (post-P4)

1. Parameter sub-nav + `section=alerts`
2. Composite form: **B07** speeding + **B10** towing + **D79** harsh + **C03** GPRS event mode
3. DB4 overspeed + history Refresh (no full live readback for most alert cmds)

## Phase Tracking+ (post-P4)

1. Parameter sub-nav + `section=tracking`
2. Composite form: **A13** cornering + **A14** distance + **A16** parking enable
3. DB4 Refresh via Phase 2B probe runner (A12/A15 stay under Network)

**Do not start coding until analysis is explicitly approved.**
