# Risks

| Risk | Mitigation |
|------|------------|
| Device never wrote photo/clip at DMS time | Surface PHOTO_MISSING; alarm still valid; document firmware dependency |
| GPRS offline at trigger | Job PENDING + retry on reconnect; FR-16 partly device-owned |
| AB4 durable record not built | Ship photo-first (Slice 1); gate video Slice 2 |
| Command storm from alarm bursts | FR-13 cooldown + worker batch limit |
| Cabin privacy | Evidence only for DMS/ADAS alerts; 30d retention |
| Large BYTEA in Postgres | Photo OK; video must use object store |
| Dual path (platform vs live fetch) confuses ops | Clear status labels in UI |
