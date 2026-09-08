# Actors

| Actor | Responsibility |
|-------|----------------|
| Fleet operator / dispatcher | View and change device Parameter settings for assigned vehicles |
| Fleet admin | Broader device config; may unlock advanced categories |
| Device (MDVR Meitrack) | Stores parameters; executes TCP/SMS commands; ACKs |
| Device gateway / fleet-management | Delivers commands, returns ACK/readback |
| Platform notification / alarm engine | **Not** the same as device Parameter Alarm (server-side rules remain separate) |

## Changelog

- 2026-09-08: Initial.
