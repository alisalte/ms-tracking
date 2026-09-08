# Non-functional requirements

| ID | Area | Requirement |
|----|------|-------------|
| NFR-01 | Usability | Operator can complete Link Sett without knowing Meitrack command codes |
| NFR-02 | Reliability | UI never claims success without ACK (or documented best-effort if device has no ACK) |
| NFR-03 | Latency | Command round-trip feedback within existing command-center norms (order of seconds when online) |
| NFR-04 | Localization | FA + EN for UI chrome and event labels |
| NFR-05 | Audit | Who changed which device parameter (reuse command history if sufficient) |
| NFR-06 | Safety | Destructive/factory actions remain out of casual Alarm Link Sett (unless later scoped) |
| NFR-07 | Compatibility | Target protocol: Meitrack MDVR family already in catalog (confirm models) |

## Changelog

- 2026-09-08: Initial.
