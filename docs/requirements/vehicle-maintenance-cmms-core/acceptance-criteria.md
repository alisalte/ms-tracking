# Acceptance criteria

## AC-01 Create WO

**Given** a fleet-admin with maintenance write  
**When** they create a WO with a valid vehicle and title  
**Then** the WO is listed as OPEN for that tenant only

## AC-02 Tenant isolation

**Given** two tenants  
**When** tenant A lists WOs  
**Then** no WO of tenant B appears

## AC-03 Complete immutable

**Given** a COMPLETED WO  
**When** a user attempts to set status to IN_PROGRESS  
**Then** the API rejects the change

## AC-04 Filters

**Given** mixed statuses  
**When** filter status=OPEN  
**Then** only OPEN rows return

## AC-05 PM due → WO

**Given** an enabled time-based PM past next_due  
**When** due job or user generates WO  
**Then** a preventive WO is created and linked to the schedule; a second generate does not duplicate while that WO is open

## AC-06 UI primary board

**Given** maintenance.read  
**When** user opens `/maintenance`  
**Then** they see native WO list/board (not only UpcomingFeature stub)

## AC-07 Partner links

**Given** `/maintenance`  
**When** page loads  
**Then** partner links remain available without blocking the native board
