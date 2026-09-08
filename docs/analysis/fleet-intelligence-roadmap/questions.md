# Questions — decisions needed before implementation

Answer these to freeze phasing and kick off Q0/Q1. Until then: **no implementation** of this portfolio.

## Product scope

1. Confirm the eleven items are a **proposed backlog**, not shipped features — OK to treat current ✅ as incorrect?
2. For **Fleet Health Score**, is v1 = rule-based (connectivity + alarms) acceptable, or do you require DTC/maintenance-backed scoring from day one?
3. For **Fuel Analytics**, what is the primary data source: MDVR fuel events, CAN/sensor, fuel cards, or manual entry?
4. For **Report Builder**, is **scheduled fixed reports** enough for Q1, or is a visual drag-drop builder mandatory?
5. For **CMMS**, prefer **build** `vehicle-maintenance-service`, **deep integrate** Pargar/Alka, or hybrid?
6. Should **Digital Twin** and **AI Fleet Assistant** stay in roadmap, or move to “explore later / out of near-term scope”?
7. For **ETA / Optimization**, do you already have a trip/dispatch workflow customers use, or is this greenfield?

## Sequencing preferences

8. Prefer **safety-first** (Driver Behavior + AI Video evidence) or **ops-first** (Maintenance + Fuel) if capacity allows only one Q1 track?
9. Any hard customer/demo date that forces reordering Q1?

## Vision alignment

10. Should recommended Q0–Q4 be recorded as the **working engineering roadmap** (project-memory), while vision §7 remains the canonical multi-year phases?
