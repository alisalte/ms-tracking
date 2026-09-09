# Gap analysis

| Need | Today | Gap |
|------|-------|-----|
| Durable fuel events | Only transient alarms | Table + ingest from Kafka and/or alarm path + manual API |
| Volume (liters) | None from device | Manual entry; optional later decode of tank % |
| Consumption summary | None | API: sum refill liters − drops; join distance |
| L/100km | Distance exists | Formula endpoint once liters known |
| Anomaly UI | `fuel-theft` alarms only | Fuel list + link; optional copy of event into fuel_events |
| Reports section `fuel` | Missing | Section + i18n + hooks |
| Permissions | None dedicated | `fuel.read` / `fuel.write` |
| Full Fuel module | Design doc only | Out of scope (cards/stations) |

```
DEVICE --FUEL_*--> Kafka ALARM --> notification (fuel-theft)     [EXISTS]
                              \-> fuel_events ingest             [MISSING]
MANUAL liters ---------------> fuel_events                       [MISSING]
fuel_events + distance ------> summary / L100                    [MISSING]
summary ----------------------> Reports?section=fuel             [MISSING]
```
