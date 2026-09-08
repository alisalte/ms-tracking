# Risks

| Risk | Mitigation |
|------|------------|
| Protocol field ≠ checkbox (VOICE/OSD/delay) | Spike before UI freeze; hide unsupported |
| Multi-command partial ACK | Ordered composer + per-step status; no single “Saved” until policy defined |
| Operator confuses with Alarm Rules | Clear copy: “تنظیمات روی دستگاه” |
| Firmware variance MD300 vs others | Feature-detect / model matrix |
| B99 complexity | Golden tests from protocol examples |

## Changelog

- 2026-09-08: Initial.
