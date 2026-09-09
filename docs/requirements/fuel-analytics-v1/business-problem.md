# Business problem

## Why

Operators want **fuel consumption and theft/anomaly visibility** inside FleetVision. Today only alarm **labels** for `fuel-theft` exist; there is no fuel event store, report, or Fuel UI. The full Fuel Management module (cards, stations, WEX) is designed on paper but **not started** in code.

## Problem

1. No trusted place to see liters used, refill vs drop, or efficiency per vehicle.
2. Device fuel alarms (if any) are not turned into durable fuel analytics.
3. Without a chosen **data source**, analytics would be empty.

## Who requested

Phase 2 continuation after CMMS skip (2026-09-09) — next Q2 priority: F-03 Fuel Analytics v1.

## Current limitations

- No `fuel-management-service` / fuel schema in apps.
- No `/fuel` dashboard section beyond alarm type strings.
- Hardware/card integration not decided (portfolio open question C).
