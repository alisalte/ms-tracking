# Acceptance criteria

## AC-01 Event list

- **Given** an online MDVR with Parameter Alarm in scope  
- **When** operator opens Alarm settings and Refresh  
- **Then** they see a table of events with Alarm head and Delay recording columns (values from device when readable)

## AC-02 Link Sett apply

- **Given** Link Sett open for an event (e.g. Overspeed)  
- **When** operator sets Associated phone + SMS, Delay recording, GPRS, and saves  
- **Then** the platform issues the corresponding device command(s) and shows ACK success or failure honestly

## AC-03 No code required

- **Given** a trained operator without Meitrack protocol docs  
- **When** they configure Link Sett  
- **Then** they never must type raw command codes (B99, etc.)

## AC-04 Distinct from server rules

- **Given** platform Alarm Rules page  
- **When** operator changes a server rule  
- **Then** that does not by itself change on-device Parameter Alarm Link Sett (and vice versa unless product later defines sync)

## AC-05 (if full Parameter in scope)

- **Given** other Parameter sections approved in scope  
- **When** operator opens those sections  
- **Then** they can view/edit supported fields with the same ACK honesty

## Changelog

- 2026-09-08: Initial draft (blocked until scope questions answered).
