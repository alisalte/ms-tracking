# UI impact

## New

- `DeviceParameterAlarmPage` or Command Center tab `parameter`
- `AlarmEventSettingsTable`
- `AlarmLinkSettDrawer` (fields matching screenshots; FA copy)
- Multi-command progress strip

## Reuse

- Device picker, toast, permissions gate, command history

## i18n

- `deviceParameter.alarm.*` keys FA/EN for events and Link Sett labels

## Tests

- Unit: map Link Sett DTO → command list  
- Component: table + drawer  
- Spec: send gated by permission; failure path
