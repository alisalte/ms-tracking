# پیاده‌سازی بخش کانفیگ تنظیمات دستگاه (Device Commands over TCP)

## هدف
پیاده‌سازی کامل مسیر ارسال **تمام دستورات قابل‌ست‌کردن از طریق TCP** طبق پروتکل MDVR Meitrack (PDF V2.0) — از UI تا سوکت دستگاه:

```
UI (CommandCenterPage) → POST /api/v1/devices/:id/commands (fleet-management)
  → INSERT fleet.device_commands (QUEUED) → Kafka command.request
  → gateway consumer → SessionManager lookup → adapter.encode → socket.write
  → device replies ($$..D82,A11,OK) → COMMAND_ACK → Kafka command.ack
  → fleet ack-consumer → ACKED/FAILED + ذخیره پاسخ → UI polling
```

## ۱) fleet-management-service (مالک دامنه + API)

**Migration** `20260817100000_create_device_commands.js` — جدول `fleet.device_commands`: id, tenant_id, device_id (FK), command_code, category, params (jsonb), payload_text, status (QUEUED/SENT/ACKED/FAILED/EXPIRED), response_text, error, issued_by, issued_at/sent_at/acked_at/expires_at, version + RLS fail-closed (طبق پترن موجود).

**کاتالوگ دستورات** `domain/device-command/meitrack-command-catalog.ts` — تمام ۷۳ دستور PDF با دسته‌بندی:
- **Tracking**: A10 (کوئری موقعیت), A11 (heartbeat), A12 (بازه زمانی ×10s), A13 (cornering), A14 (مسافت), A15/A16 (parking schedule), A17 (RFID output)
- **Network/Server**: A21 (GPRS اصلی), A23 (standby), A25 (IP3), ABB (hotspot WiFi), AA3 (وضعیت شبکه)
- **Phone/SMS**: A70/A71 (SOS numbers), A72 (listen-in), C02 (ارسال SMS), B91 (SMS event chars), B99 (event authorization)
- **Alerts**: B07 (سرعت), B08/B10 (towing), C47/C48 (سنسور سوخت), C49 (سرقت سوخت), D79 (شتاب/ترمز شدید), C90 (خستگی راننده)
- **Geo-fence**: B05 (دایره‌ای), B06 (حذف), B11 (چندضلعی)
- **Device**: A73 (sleep mode), B22 (محاسبه مسافت), B26 (فیلتر input), B31 (LED), B34 (log interval), B35/B36 (timezone), D73 (تخصیص حافظه), F08 (mileage/runtime), D65/D66 (نگهداری)
- **Outputs**: C01 (کنترل خروجی), D72 (output triggering)
- **RFID**: D10–D16 | **Temperature**: C40–C46 | **TPMS**: DA0–DA5
- **Media**: A9A/A9B/A9C/A9D/A9E/A9F, AA0, AB2–AB8, AA4, BB8 (بلندگو), CB8 (event playing) — با struct-builder باینری (length-prefixed + WORD big-endian + BCD)
- **System**: E91 (نسخه firmware), F00/F01/F02 (restart), F09 (پاک‌سازی cache), F11 (factory reset), CFF, C03, C61 + **دستور raw سفارشی** (escape hatch)

هر دستور: `code, nameEn, nameFa, category, params[{key,label,labelFa,type,number|string|enum|bool, min,max,default,enum options,required}], buildParams()` → ساخت payload text + ولیدیشن.

**سایر فایل‌ها**: device-command.repository.ts، device-command.service.ts (TX + audit + publish)، command-request-producer.ts + command-ack-consumer.ts (کپی پترن SessionLifecycleConsumer؛ ack-match با deviceId+commandCode جدیدترین SENT)، DeviceCommandsController (`POST/GET /api/v1/devices/:id/commands`, `GET /api/v1/device-commands/catalog`, `GET /api/v1/device-commands/:id`) با پرمیشن‌های `telemetry.command.send/read`، zod schemas، config (FLEET_KAFKA_COMMAND_*, FLEET_COMMAND_TTL_SECONDS)، TTL sweeper.

## ۲) device-gateway-service (مسیر downstream)

- `SessionManager.registerWriter(sessionId, writer)` — آینه‌ی پترن registerTerminator؛ در `gateway.module.ts` onOpen ثبت `(buf) => ctx.socket.write(buf)`، cleanup در close().
- `CommandDispatcher` (application) — lookup session با byDeviceId → چک `canDispatchCommand()` → `adapter.encode({type:'COMMAND', payload:{imei: session.serialOrImei, text/hex}})` → write. بدون session → publish COMMAND_REJECTED(DEVICE_OFFLINE) فقط وقتی Redis snapshot هم نباشد.
- Kafka consumer `command.request` (groupId per-instance → broadcast؛ فقط owner می‌نویسد — "route to owning instance" طبق spec §6.2).
- `kafka-producer.ts`: متد `publishCommandEvent` برای COMMAND_SENT/COMMAND_REJECTED روی topic موجود ack.
- `meitrack.encode.ts`: پشتیبانی payload.hex (فریم باینری — checksum روی بایت‌های خام) برای دستورات media.
- Config: GATEWAY_KAFKA_COMMAND_REQUEST_TOPIC و فعال‌سازی listener `meitrack:tcp:5023` در .env.example.

## ۳) identity-service

Migration backfill پترن موجود: `telemetry.command.send` → fleet-admin، `telemetry.command.read` → fleet-admin + viewer.

## ۴) web-dashboard (React/MUI)

- `command.api.ts` (کپی پترن asset.api: mock-gate + react-query + polling `refetchInterval`) + queryKeys + mock fixtures.
- بازنویسی `CommandCenterPage`: انتخاب دستگاه (Autocomplete با فیلتر meitrack) → تب‌های دسته‌بندی کاتالوگ → فرم پارامتر داینامیک per-command (دیالوگ با react-hook-form + zod از روی param defs با min/max/default/unit، لیبل دوزبانه از خود کاتالوگ) → ارسال → toast.
- جدول History (status badge, response, issuedBy, فیلتر device/status، polling).
- PERMISSIONS + guard مسیر `/commands` + i18n en/fa (commands.* شامل دسته‌ها و وضعیت‌ها).

## ۵) تست‌ها
- Gateway: command-dispatcher.spec (encode→write، offline، binary)، session-manager writer، meitrack binary checksum.
- Fleet: meitrack-catalog.spec (payload text ده‌ها دستور کلیدی + حدود)، device-command.service.spec (TX + publish + expire)، ack-consumer matching.
- typecheck + lint + تست‌های هر سه سرویس.

## نکات
- Ack-matching با (deviceId + commandCode) چون پروتکل Meitrack correlation-id ندارد (فیلد D82 فقط کد دستور را برمی‌گرداند).
- دستورات فقط برای دستگاه‌های `protocol=meitrack`؛ بقیه پروتکل‌ها 422.
- حد مجاز payload ≤1024 بایت طبق spec.