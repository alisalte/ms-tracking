# Requirements (draft)

## FR-D1 — Current assignment

Given a driver, show **current** vehicle and **device(s)** bound to that vehicle (IMEI / model), or explicitly “unassigned”.

## FR-D2 — Assignment history

Given a driver and a time range, list **past** vehicle (and implied device) assignments: from/to, who changed it.

## FR-D3 — Work volume

Given a driver and a time range, show work metrics that are **driver-attributed** (not only “whatever vehicle is assigned today”):

- moving time, idle time, distance, trip count (minimum)
- optional later: on-duty / HOS if required for Iran ops

## FR-D4 — Alarms for driver

Given a driver and a time range, list alarms that occurred while that driver was the active assignee of the vehicle (or while `driverId` was stamped on the alarm), with deep-link to Alarm Center.

## FR-D5 — Entry points

- Driver detail drawer / profile (primary)
- Optional: report section “per driver” that uses the same attribution rules
- Optional: from device/vehicle, “who was driving then?”

## Non-goals (until confirmed)

- Face recognition / identity from cabin camera
- Full FMCSA HOS compliance engine (unless product says yes)
- Separate driver mobile app timeclock (unless product says yes)
