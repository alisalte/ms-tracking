# Acceptance criteria

Draft — refine after business rules are locked.

## Sprint 1

### AC-DET-HB

**Given** a vehicle produces a hard-brake signal meeting the approved definition  
**When** the detection pipeline processes it  
**Then** a hard-brake behavior event is stored with vehicle, timestamp, and driver if attributable.

### AC-DET-OS

**Given** a vehicle exceeds the approved overspeed definition  
**When** detection runs  
**Then** an overspeed event is stored with speed context and attribution as above.

### AC-DET-IDLE

**Given** a vehicle meets the approved idle definition for the minimum duration  
**When** detection runs  
**Then** an idle event is stored with duration and attribution as above.

### AC-SCORE

**Given** a driver has attributable behavior events in period P  
**When** score is computed for P  
**Then** an authorized user sees the Driver Score and a breakdown of contributing event types.

## Sprint 2

### AC-RANK

**Given** multiple drivers with valid scores for period P  
**When** a manager opens Ranking for P  
**Then** drivers appear ordered by the approved ranking rule.

### AC-DASH

**Given** a driver with score and events  
**When** a manager opens that Driver Dashboard  
**Then** score, period controls, and recent events are visible.

### AC-NOTIF

**Given** an approved notification rule and a matching event/score change  
**When** the rule fires  
**Then** configured recipients receive a notification with a link/context to the driver or event.

## Sprint 3

### AC-VID

**Given** an event type that supports evidence and media is available  
**When** a user opens the event  
**Then** they can view the attached video/photo per privacy rules.

### AC-COACH

**Given** a coaching trigger (events/score pattern)  
**When** coaching is generated  
**Then** a coaching item exists and follows the approved delivery/approval path.

### AC-ML

**Given** enough history for the approved model  
**When** risk prediction runs  
**Then** authorized users see a risk indicator with model/version context (detail TBD).
