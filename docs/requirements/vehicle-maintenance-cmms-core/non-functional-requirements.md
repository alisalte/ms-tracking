# Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | Tenant isolation on every read/write (same pattern as fleet/notification). |
| NFR-02 | UI EN + FA (i18n keys for board and forms). |
| NFR-03 | List API paginated (cursor or page); default page size bounded. |
| NFR-04 | Permission-gated endpoints; UI gates are UX only. |
| NFR-05 | Audit trail for status-changing actions. |
| NFR-06 | Availability: maintenance APIs must not block tracking/alarms if down (independent service or module). |
| NFR-07 | Localization of status/type labels; store enum codes in English. |
