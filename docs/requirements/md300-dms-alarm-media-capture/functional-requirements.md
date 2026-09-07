# Functional Requirements

Describe **what** must happen. Implementation (which Meitrack command, upload path, UI widget) is out of this document until requirements are approved and analysis starts.

All rows below are confirmed by the stakeholder (2026-09-07).

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | When an in-scope DMS or ADAS alarm is created on an MD300, a still photo of the **driver** (cabin camera) SHALL be captured. | Must |
| FR-02 | When an in-scope DMS or ADAS alarm is created on an MD300, a **short video of the driver** SHALL be captured (cabin camera, not the road camera). | Must |
| FR-03 | Photo and video SHALL be attributable to **that same alarm occurrence** (same vehicle, same time window, same alarm type). | Must |
| FR-04 | Capture SHALL occur because the alarm was created, without requiring an operator to open the alarm at that moment. | Must |
| FR-05 | An operator who is allowed to view the alarm SHALL be able to load the photo and play/download the short video as evidence of that alarm (one click to load is acceptable). | Must |
| FR-06 | If photo capture fails (no cabin camera, camera covered, storage full), the alarm SHALL still exist and the failure SHALL be visible to the operator. | Must |
| FR-07 | If video capture fails under the same conditions, the alarm SHALL still exist and the failure SHALL be visible. | Must |
| FR-08 | In-scope DMS types: **all** MD300 DMS types (eyes closed, yawn, head down/up, looking aside/left/right, absence, phone, smoking, occlusion, drowsiness, drinking, and any other DMS type the device reports). | Must |
| FR-09 | The short video SHALL cover **5 seconds before** and **10 seconds after** the alarm moment (15 s total). | Must |
| FR-10 | **ADAS alarms** on the same MD300 SHALL also capture driver photo + 15 s driver video (cabin camera). Road-facing ADAS video is not required by this feature. | Must |
| FR-11 | Photo and video SHALL be available **on the platform automatically** after the alarm (or after reconnect — FR-16), without requiring the operator to open the alarm at trigger time. | Must |
| FR-12 | The short video SHALL include **audio**. | Must |
| FR-13 | Capture SHALL be limited to **at most one photo+clip per alarm type per 1 minute** on the same device/vehicle. Further alarms of that type inside the window still raise, but do not each get new media. | Must |
| FR-14 | Capture is limited to vehicles whose MD300 has a usable **cabin / driver** camera. | Must |
| FR-15 | Alarms that are neither DMS nor ADAS are unchanged by this feature. | Must |
| FR-16 | If GPRS is down at alarm time, the device SHALL still capture photo+video locally and SHALL deliver them to the platform when the network returns. | Must |
| FR-17 | Platform SHALL retain photo and video for **30 days**. | Must |

## Changelog

- 2026-09-07: Initial draft.
- 2026-09-07: All UNCONFIRMED rows resolved with stakeholder answers.
