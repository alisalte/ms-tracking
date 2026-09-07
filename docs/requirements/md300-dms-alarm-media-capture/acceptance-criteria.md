# Acceptance Criteria

## AC-01 Photo at alarm time

- **Given** an MD300 with a working cabin camera and an in-scope DMS or ADAS type
- **When** that alarm is created
- **Then** a still photo of the driver exists for that alarm on the platform (after ingest or reconnect)
- **And** that photo is not a snapshot taken only because an operator later pressed “capture photo”

## AC-02 Short video at alarm time

- **Given** the same device and alarm
- **When** the alarm is created
- **Then** a video of the driver exists for that alarm
- **And** the clip is **15 seconds**: 5 s before the alarm moment and 10 s after
- **And** the clip has **audio**

## AC-03 Attribution

- **Given** two in-scope alarms on the same vehicle close in time (outside cooldown, different types or after 1 minute)
- **When** the operator opens alarm A
- **Then** photo and video shown are for A, not B

## AC-04 Operator review

- **Given** capture and ingest succeeded
- **When** an authorized operator opens the alarm and clicks to load evidence
- **Then** they can view the photo and play the short video without leaving the alarm context

## AC-05 Capture failure does not drop the alarm

- **Given** cabin camera missing or storage full
- **When** an in-scope alarm is created
- **Then** the alarm is still raised
- **And** the operator can tell evidence is missing

## AC-06 Out-of-scope alarms

- **Given** an alarm that is neither DMS nor ADAS
- **When** it is created
- **Then** this feature does not require a new driver photo+clip

## AC-07 Cooldown

- **Given** an alarm type already captured photo+clip for this vehicle within the last 60 seconds
- **When** the same type raises again
- **Then** a new alarm is still created
- **And** a second photo+clip is not required for the repeat inside that minute

## AC-08 Platform ingest

- **Given** capture succeeded and the device is (or becomes) online
- **When** the alarm exists on the platform
- **Then** photo and video are on the platform without the operator having been in the alarm drawer at trigger time

## AC-09 Offline then sync

- **Given** GPRS is down at alarm time and cabin capture succeeds locally
- **When** the device reconnects
- **Then** photo and video for that alarm become available on the platform

## AC-10 Retention

- **Given** photo and video ingested for an alarm
- **When** 30 days have passed since the alarm
- **Then** the platform is not required to keep that media
- **And** within 30 days the operator can still load it

## AC-11 ADAS uses driver camera

- **Given** an ADAS alarm (e.g. FCW) on MD300 with a cabin camera
- **When** the alarm is created
- **Then** the required photo and 15 s clip are of the **driver**, not the road camera

## Changelog

- 2026-09-07: Initial; duration and type list still TBD.
- 2026-09-07: Type list, audio, offline, retention, ADAS cabin camera added.
