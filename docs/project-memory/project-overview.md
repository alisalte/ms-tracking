# Project Overview

**Product:** FleetVision (repo: MS06-Clone-Platform)
**Role:** Platform of record for commercial fleet intelligence — tracking, alarms, video, compliance, maintenance.
**Canonical vision:** `docs/specs/00_Project_Vision.md`

## What this repo is

A pnpm monorepo implementing FleetVision: NestJS services, React dashboards, device-gateway for GPS/MDVR hardware (Meitrack MD300 and others), and media playback.

## Primary users

- Fleet operators and dispatchers (`apps/web-dashboard`)
- Tenant administrators (`apps/tenant-admin`)
- Devices (Meitrack MDVR/MD300, JT808, GT06, …) connecting to `device-gateway-service`

## Current product slice that matters for DMS

MD300 reports Driver Monitoring System (DMS) / ADAS alarms as Meitrack event **126** (CCE parameter `0xFE31`). The dashboard can show those alarms and, after an operator click, load an event JPEG (`D00`) and play SD-card video around that time (`AB4`).

## Changelog

- 2026-09-07: Initial project-memory created from existing specs and code.
