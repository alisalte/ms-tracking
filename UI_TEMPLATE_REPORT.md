# گزارش بازطراحی UI و قالب (Design System) — وب‌داشبورد FleetVision

> **تاریخ گزارش:** 2026-08-24 · **شاخه:** `main` · **HEAD:** `250ec68`
> **محدوده:** تمام کارهای UI از کامیت `c06d74d` (شروع فاز ۰) تا `250ec68`
> **آمار کلی:** ۱۴۶ فایل تغییر کرده · **+13,918 / −6,170** خط فقط در `apps/web-dashboard`
> **وضعیت تست:** ✅ ۳۱ فایل تست / **۲۷۶ تست — همه پاس** (اجرای واقعی vitest، 2026-08-24)

---

## ۱. خلاصهٔ مدیریتی (چیکار شد؟)

کل لایهٔ نمایش (UI) وب‌داشبورد از **MUI (Material UI)** به یک **دیزاین‌سیستم اختصاصی روی Tailwind CSS v4**
به سبک **TailAdmin** مهاجرت داده شد. این کار phased انجام شد (فاز ۰ تا ۵ + کارهای تکمیلی)،
در هر فاز صفحه‌ها یک‌به‌یک port شدن، تست‌ها به‌روز شدن و در پایان **recharts کلاً از پروژه حذف شد**
(تنها کتابخانهٔ چارت: **echarts**).

**نتیجهٔ نهایی:**

| مورد | قبل | بعد |
|---|---|---|
| فریمورک UI | MUI 6 + Emotion + stylis (برای همه‌چیز) | **Tailwind CSS v4** (توکن‌محور، اختصاصی) |
| قالب رنگ | پالت MUI | پالت TailAdmin: برند Indigo (`#465ffb`) + خنثی gray/graydark + رنگ‌های معنایی |
| چارت | recharts + echarts (دوتایی) | فقط **echarts** |
| کامپوننت پایه | MUI components | **۲۶ پریمیتیو اختصاصی** در `components/tailwind-ui` (~۲,۳۵۰ خط) |
| RTL | rtl-plugin بروی کل MUI | utilityهای منطقی Tailwind (`ps-/pe-/ms-/me-/start-/end-`) — خودکار با `dir` |
| دارک‌مود | MUI palette.mode | کلاس `.dark` روی `<html>` (توسط `ThemeRegistry` سوییچ می‌شود) |
| i18n | رشته‌های hardcode زیاد | **۱,۱۶۹ کلید** — en/fa کاملاً هم‌ارز (parity تأیید شده) |

---

## ۲. قالب و توکن‌های دیزاین (`src/styles/tailwind.css`)

قلب قالب جدید یک فایل توکن Tailwind v4 است (`@theme`) — بدون CSS переменهای جدا و بدون theme provider سنگین:

- **رنگ برند (Indigo/TailAdmin):** `brand-25` تا `brand-900` — اکشن اصلی `brand-500 = #465ffb`، هاور `brand-600/700`
- **خنثی روشن:** `gray-25…gray-950` (بدنهٔ صفحه‌های light)
- **خنثی تیره:** `graydark-200…900` (سایدبار + سطوح dark — همان حس TailAdmin)
- **رنگ‌های معنایی:** `success / warning / danger` با رَمپ کامل ۵۰ تا ۷۰۰
- **دارک‌مود کلاس‌محور:** `@custom-variant dark (&:where(.dark, .dark *))` — `ThemeRegistry` کلاس را toggle می‌کند
- **RTL بدون پلاگین:** همهٔ کامپوننت‌ها فقط از utilityهای **منطقی** استفاده می‌کنند؛ با `dir="rtl"` چیدمان خودکار برمی‌گردد
- **مالکیت reset:** Preflight تیلویند نقش `CssBaseline` قبلی MUI را گرفته (فاز ۲.۵)
- فایل `global.css` فقط موارد جزئی (مثل انیمیشن `fv-live-dot` برای LiveBadge)

---

## ۳. کیت کامپوننت — `components/tailwind-ui/` (۲۶ پریمیتیو)

| دسته | کامپوننت‌ها |
|---|---|
| **داده‌نمایی** | `DataTable` (ستون‌محور، سورت کلاینت‌ساید، skeleton row، هدر sticky، selection، zebra) · `Table/THead/TBody/TH/TD` · `Pagination` (شماره‌ای + LoadMore) |
| **فرم** | `Input` · `Select` · `ListboxSelect` + `MultiSelect` (لیست‌باکس سفارشی) · `Textarea` · `Checkbox` · `Switch` (همه RHF-ready با forwardRef و wiring دسترس‌پذیری) |
| **چیدمان/سطح** | `Card` + `CardHeader` · `PageHeader` · `Drawer` (اسلاید‌اور اشتراکی، لبهٔ منطقی، RTL-flip) · `Modal` · `Tabs` · `Toolbar` (نوار فیلتر/اکشن) · `Dropdown` |
| **نمایش وضعیت** | `Badge` · `StatusBadge` · `Avatar` · `Tooltip` · `Alert` |
| **فیدبک/خالی** | `Spinner` · `Skeleton` · `EmptyState` · `Button` · `IconButton` |

بازنویسی‌های مهم همان API قبلی را نگه داشتند تا **هیچ call-site‌ای نشکند**:

- `ToastProvider` → صف stack‌شده (قبلاً Snackbar تک‌اسلات MUI بود) — `useToast()` دست‌نخورده
- `ConfirmDialog` → بازسازی روی `Modal + Button` با همان props

---

## ۴. فازبندی اجرا (traceable با کامیت‌ها)

| فاز | کامیت | محتوا |
|---|---|---|
| **۰–۱** | `c06d74d` | پریمیتیوهای پایه + **صفحهٔ Assets** (Fleets/Vehicles/Devices سه تب، Toolbar+Select، DataTable سورت‌پذیر، اکشن‌های inline به‌جای kebab Menu، فرم/جزئیات روی Drawer اشتراکی). سایدبار: لینک `/assets` که قبلاً در IA پنهان بود فعال شد |
| **۲** | `9108e09` | **Admin** (Users/Roles/Permissions/Settings/Audit روی Toolbar+DataTable+Badge+Card، دراورها، AdminNav با aria-current) + **Command Center** (انتخاب دستگاه با Select، کاتالوگ Card-grid + Tabs + جستجو، دیالوگ پارامتر داینامیک، تاریخچه با StatusBadge) |
| **۳** | `b61ad1e` | صفحات **Auth** (Register/Forgot/Reset/MFA با همان idiom لاگین + OTP ورودی‌های native) + **Profile** (Avatar/Badge/Tooltip) + **Trips** (Toolbar + DataTable سورت‌پذیر + replay) + **404**؛ **SpeedGraph از recharts به echarts** با همان API (خط سرعت + markLine حد + playhead + نقطهٔ جاری) |
| **۴–۵** | `89611f8` + `85a0d20` | i18n رشته‌های hardcode (eyebrow داشبورد، نوار نسخهٔ سایدبار — نسخه از package.json خوانده می‌شود) · `LiveBadge` روی Tailwind · **حذف کد مرده**: کل barrel قدیمی `components/ui` (Breadcrumb/DataTable/EmptyState/PageHeader/Panel/SectionLabel/StatusBadge/Toolbar)، `LoadingSpinner`، `dashboard/EmptyState` (−۹۱۲ خط) · **recharts از dependencies و vite manualChunks حذف شد** |
| **تکمیلی** | `d13df1b` | `GeofenceFormDialog` و `MapToolbar` و `RoutePlannerDialog` از MUI خارج شدند (آخرین سطوح باقی‌مانده به‌جز پنل‌های نقشه) · پریمیتیوهای جدید `ListboxSelect`/`MultiSelect` (۳۴۳ خط) و `PageHeader` |
| **تکمیلی** | `fc273b9` | اصلاح چیدمان پایین **ProfilePage** + ریزتنظیمات `Button`/`IconButton` |
| **نقشه/داشبورد** | `2c01e6a` | کاتالوگ **Basemap** (streets/satellite/dark/topo — همه keyless، سوییچ با تعویض tile URL) + `MapSettingsPanel` + بازطراحی `DeviceListPanel` · چارت‌های جدید داشبورد (`AlarmStatusChart`, `TopVehiclesChart`, `TrendChartsRow`, `ReportsKpiRow`) · پل **MuiProvider** |
| **داشبورد** | `e596a07` | اوورهال کامل داشبورد: `KpiTile` بازنویسی، چارت‌های `AlarmSeverityChart`/`FleetComparisonChart`/`HourlyActivityChart`/`SpeedLeadersChart`، `DevicePopup` غنی‌شده، `token-refresh` جدا شده، ابزارهای seed/simulator |
| **لیفت** | `da3f5ad`, `250ec68` | biome formatting + `exhaustive-deps` + پوشش **tsx در pre-commit hook** |

---

## ۵. وضعیت فعلی MUI (شفافیت کامل)

MUI **تقریباً کامل حذف** شده؛ فقط یک جزیرهٔ کوچک باقی مانده که عمداً bridge شده:

- باقی‌مانده: `DeviceListPanel` و `MapSettingsPanel` داخل **MapPage** (پنل‌های کناری نقشه)
- `theme/MuiProvider.tsx` فقط همان صفحه را wrap می‌کند و **توکن‌های برند را به MUI تزریق می‌کند**:
  - `palette.mode` همگام با ThemeRegistry (دارک/لایت با هم حرکت می‌کنند)
  - primary = رمپ برند تیلویند؛ paper = سطوح graydark
  - direction از زبان i18n؛ در فارسی emotion cache با **stylis-plugin-rtl**
  - بدون CssBaseline (reset مالکیتش با تیلویند است)
- 📌 **کار آیندهٔ مستندشده:** port این دو پنل → حذف کامل `@mui/*`, `@emotion/*`, `stylis` از dependencies (الان ۷ پکیج مرتبط در package.json مانده‌اند)

---

## ۶. i18n و دسترس‌پذیری

- **۱,۱۶۹ کلید** در `en/common.json` و **۱,۱۶۹ کلید** در `fa/common.json` — parity کامل
- تمام رشته‌های جدید (basemapها، تنظیمات نقشه، چارت‌های داشبورد، فرم‌ها) از روز اول i18n'd شدن
- کامپوننت‌های فرم با label/id wiring، `aria-current` در ناوبری، focus‌های keyboard در Modal/Drawer/Listbox
- RTL در تمام سطح‌ها تست‌شده (utility منطقی، نه `rtl:` duplication)

---

## ۷. تأیید و صحت‌سنجی (واقعاً اجرا شده)

| بررسی | نتیجه |
|---|---|
| `vitest run` (کل وب‌داشبورد) | ✅ **31 files / 276 tests — همه پاس** (74s, 2026-08-24) |
| تست‌های UI جدید در طول فازها | `tailwind-ui.spec` · `theme-system.spec` · `assets` · `admin` (12) · `dashboard` (بسط‌یافته) · `map` (86+ خط تست اضافه) · `auth-rbac` |
| حذف recharts | ✅ صفر reference در `src/` + حذف از `package.json` و vite chunks (−۲۸۰ خط از lockfile) |
| کد مرده | ✅ barrel قدیمی `components/ui` و دو کامپوننت یتیم حذف شدند (−۹۱۲ خط) |
| Lint | ✅ biome تمیز؛ pre-commit حالا tsx را هم می‌پوشاند (`250ec68`) |

---

## ۸. چیزهایی که **عمداً** انجام نشد / باقی‌مانده

1. **حذف کامل @mui** — دو پنل نقشه + MuiProvider + ۷ پکیج وابسته (scope مشخص، بعد از port پنل‌ها)
2. **Visual regression / snapshot تست** — ندارد (E2E قبلی Playwright همچنان معتبر است ولی برای قالب جدید snapshot گرفته نشده)
3. **Storybook/محیط نمایش پریمیتیوها** — کیت ۲۶تایی فقط از طریق `tailwind-ui.spec` تست واحد می‌شود
4. تم light برای پنل‌های نقشهٔ MUI-bridged — همگام است ولی تا حذف کامل، ریسک drift توکن هست

---

## ۹. راهنمای مرور برای بازبین (Review Checklist)

- [ ] توکن‌ها: `src/styles/tailwind.css` (رمپ برند/gray/graydark/معنایی)
- [ ] کیت: `src/components/tailwind-ui/` (شروع از `index.ts` — barrel رسمی)
- [ ] الگوی صحیح مصرف: صفحات فقط از barrel ایمپورت می‌کنند (نه MUI مستقیم — grep `@mui` فقط باید ۳ فایل بدهد)
- [ ] RTL: هر دو زبان را در صفحات Assets/Admin/Map چک کنید
- [ ] دارک‌مود: toggle از ThemeRegistry روی همهٔ صفحات port شده
- [ ] یکتایی چارت: `grep recharts` باید خالی باشد

---

*این گزارش صرفاً لایهٔ UI/قالب را پوشش می‌دهد. برای وضعیت بک‌اند و کل پلتفرم به `PROJECT_STATUS_REPORT.md` مراجعه کنید.*
