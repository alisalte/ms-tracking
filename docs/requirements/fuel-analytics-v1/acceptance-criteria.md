# Acceptance criteria

## AC-01 Persist event

**Given** an authorized write and valid vehicle  
**When** a fuel event is ingested or manually created  
**Then** it appears in that tenant’s event list only

## AC-02 Manual refill

**Given** fuel.write  
**When** user submits refill liters + time  
**Then** kind=manual (or refill+source=manual) is stored and included in summaries

## AC-03 Summary

**Given** refill/drop events in range  
**When** user requests summary  
**Then** liters totals are returned; L/100km only if distance available

## AC-04 Anomaly

**Given** a drop meeting BR-11  
**When** detection runs  
**Then** an anomaly is listed (and optionally linked to alarm)

## AC-05 Empty state

**Given** a vehicle with no fuel events  
**When** user opens Fuel view  
**Then** clear empty state, HTTP 200, no hard error

## AC-06 Tenant isolation

**Given** two tenants  
**When** A lists events  
**Then** B’s events never appear

## AC-07 UI

**Given** fuel.read  
**When** user opens the Fuel analytics surface  
**Then** they can filter by vehicle/date and see events or empty state (not UpcomingFeature-only stub)
