# Current state

## Command pipeline

- Catalog: `apps/fleet-management-service/.../meitrack-command-catalog.ts`
- UI: `/commands` (`CommandCenterPage`), `DeviceConfigWizard` (Video Wall) — **code-centric** forms, not vendor Alarm UX
- Permissions: `telemetry.command.read` / `telemetry.command.send`
- History + ACK polling already exist

## Relevant commands (partial)

| Area | Codes |
|------|--------|
| Phones / SOS | A70/A71/A72 |
| SMS header (Alarm head) | B91 |
| Per-event SMS/CALL/GPRS/CAMERA/OUT auth | B99 |
| Speeding threshold | B07 |
| Geofence | B05/B06/B11 |
| Outputs | C01, D72 |
| Event→channel video | CB8 |
| GPRS event mode | C03 |
| FTP upload | A9F, B64 |
| DMS volume/behaviors | C90 |

## Event codes known to platform

`MEITRACK_EVENTS` in `meitrack.codes.ts` includes overspeed 19, fence 20/21, ext battery 18/22/23, GPS lost 24, SOS 1, DMS 126, …  

Parameter Alarm event table (UI) now also lists MDVR §1.3 digital inputs: codes **2–8** Active, **9–16** Inactive. Protocol has **no Input 1 Active** (code 1 = SOS). Gateway `MEITRACK_EVENTS` still does not map 2–16 to named I/O alarms (generic `EVENT_n` until expanded).

## Not present

- Event settings table UI  
- Link Sett composite editor  
- Guaranteed readback of full Link Sett as one object (many cmds have `supportsReadback: false`)
