# Proposed design

## Placement

New tab/section on **Command Center** (`/commands?tab=parameter`) or a **Device Parameter** page linked from device drawer:

1. Device picker (reuse `CommandDevicePicker`)
2. Sub-nav: **Alarm** | **Network** | **Media** | **AI / C90** — shared snapshot/probe foundation in Phase 2B (`device-parameter-state`)
3. Alarm → Event table | Link Sett drawer/panel

Keep raw Command Center catalog for power users.

## Event table

Rows from a static **Product Event Catalog** (code + FA/EN label + default alarm head), seeded from screenshots + `MEITRACK_EVENTS`:

| Event (EN) | Code (proposed) |
|------------|-----------------|
| External battery low power | 18 |
| Overspeed | 19 |
| Enter Geo-fence | 20 |
| Exit Geo-fence | 21 |
| Car battery cable connected | 22 |
| Car battery line cut | 23 |
| Lost GPS signal | 24 |
| Input N active/inactive | TBD from protocol (I/O range) |

Columns: Event, Alarm head (from B91 read or last-set cache), Delay (s), Operation → Link Sett.

Refresh: issue readback commands where `supportsReadback`; merge into UI model; mark unread fields.

## Link Sett → command composition

On **Setting**, enqueue ordered commands (same device, existing send API):

1. `B91` — alarm head for event code  
2. `B99` — for each enabled channel (SMS/CALL/GPRS/CAMERA/OUT*) add/set event code + phone  
3. Threshold cmds if applicable (`B07` speed when editing overspeed — optional separate)  
4. `D72` / related — output pulse if output checkboxes set  
5. `CB8` — recording seconds/channel mapping for checked CH Recording  
6. FTP enable — only if FTP checked and FTP server already configured (or prompt)

Store a **client-side draft** until ACK; show multi-step progress.

## Read model cache (optional Phase 1.1)

`device_parameter_cache` JSON per device (last successful Link Sett UI model) — not source of truth; device remains SoT.

## Permissions

`telemetry.command.send` to apply; `telemetry.command.read` to view history/refresh.
