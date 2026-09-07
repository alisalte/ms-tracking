# Glossary

| Term | Definition |
|---|---|
| MD300 | Meitrack MDVR device used in this fleet for cameras + GPS + DMS/ADAS |
| DMS | Driver Monitoring System (cabin camera AI) |
| ADAS | Advanced Driver Assistance (road-facing AI); same MD300 event 126 as DMS |
| CCE | Meitrack binary tracking/alarm packet |
| FE31 / 0xFE31 | CCE parameter carrying DMS/ADAS type + optional snapshot filename |
| photoName | Filename of the event JPEG the device claims to have stored (e.g. `…_CH2_E126S8_0.jpg`) |
| D00 / D01 / D03 | Meitrack photo download / list / capture commands |
| AB2 / AB4 / AB8 | Live RTMP push / SD playback push / SD file list |
| Event clip | Short video stored for an alarm, not continuous recording |
| Cabin camera | Driver-facing channel; expected source of DMS evidence |

## Changelog

- 2026-09-07: Initial glossary.
