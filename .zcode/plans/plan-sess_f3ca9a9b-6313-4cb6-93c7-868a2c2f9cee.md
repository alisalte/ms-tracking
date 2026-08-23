# طرح حرفه‌ای‌سازی UI — یکپارچه‌سازی روی سیستم Tailwind/TailAdmin + پولیش

## هدف
تمام صفحات به یک زبان بصری واحد (همون سبک TailAdmin که الان داشبورد/هشدارها/نقشه دارن) منتقل بشن، پریمتیوهای ناقص ساخته بشن، و MUI/recharts بعداً به‌طور کامل حذف بشن (حجم باندل کم می‌شه، ظاهر یکدست می‌شه). RTL و فارسی دست‌نخورده می‌مونه (logical utilities). هیچ تغییری در بک‌اند و API نیست.

## فاز ۰ — تکمیل کتابخانه‌ی کامپوننت (`src/components/tailwind-ui/`)
- **`DataTable`** — با همون API فعلی `Column<Row>` از `components/ui/DataTable.tsx` (برای مهاجرت مکانیکی) روی Table kit موجود: ردیف‌های skeleton، empty state، sticky header، hover/selected، zebra، مرتب‌سازی سمت کلاینت.
- **`Pagination`** — صفحه‌بندی شماره‌ای برای لیست‌های کلاینت‌محور + دکمه‌ی Load more برای لیست‌های cursor-محور (هماهنگ با `lib/use-cursor-pagination.ts` موجود).
- **`Drawer`** — اسلاید‌اوور مشترک (سمت درست در RTL) به جای ۵ پیاده‌سازی جدا.
- **`Tabs`** — جایگزین MUI Tabs (در Asset Management و Reports).
- **`Toast`** — جایگزین `feedback/ToastProvider.tsx` با صف و انباشتگی؛ همون API `useToast()` تا call-siteها تغییر نکنن.
- **`ConfirmDialog`** + پریمتیوهای فرم: **`Checkbox` / `Switch` / `Textarea`** (forwardRef مثل Input/Select فعلی، سازگار با react-hook-form).
- تست‌های واحد به سببک specهای موجود tailwind-ui.

## فاز ۱ — صفحه‌ی Assets (مهم‌ترین صفحه‌ی MUI)
- پورت `pages/AssetManagementPage.tsx` و `components/assets/{VehiclesTab,FleetsTab,DevicesTab}.tsx` به DataTable/Tabs/Dropdown جدید.
- پورت `AssetFormDrawer.tsx` و `AssetDetailDrawers.tsx` به Drawer مشترک + Input/Select/Checkbox (اسکیماهای zod و RHF دست‌نخورده).
- اضافه‌کردن `/assets` به `nav.config.tsx` (الان اصلاً در منو نیست — حفره‌ی IA).
- به‌روزرسانی `src/__tests__/assets.spec.tsx`.

## فاز ۲ — Admin و Command Center
- پورت `pages/AdminPage.tsx` و `components/admin/*` (Users/Roles/Settings/Audit + Drawerها).
- پورت `pages/CommandCenterPage.tsx` و `components/commands/*` (Autocomplete → Select جستجوپذیر).

## فاز ۳ — Auth / Profile / Trips / 404
- پورت Register/Forgot/Reset/MfaVerify به سبک LoginPage (RHF + zod + tailwind-ui).
- پورت ProfilePage و TripsPage/TripDetailPage؛ مهاجرت `SpeedGraph.tsx` از recharts به wrapper موجود `EChart` و حذف recharts.
- بازنویسی NotFoundPage با tailwind.

## فاز ۴ — پولیش داشبورد و نقشه
- رفع رشته‌ی انگلیسی hardcode در hero داشبورد (i18n)، یکسان‌سازی PageHeader بین همه‌ی صفحات.
- استخراج hook مشترک `useMapLibre` از ۶ کامپوننت نقشه‌ی تکراری + بهبود استایل مارکر/popup و پیش‌نمایش نقشه‌ی داشبورد.

## فاز ۵ — پاک‌سازی و تأیید
- حذف `components/ui/*` قدیمی؛ اگر MUI کاملاً بی‌استفاده شد: فعال‌سازی Tailwind preflight، حذف `@mui/*`/`@emotion/*` از package.json (چانک vendor-mui ~383KB حذف می‌شه). ThemeRegistry فقط برای dark/light و dir می‌مونه.
- اجرای تست‌ها (`pnpm --filter @fleetvision/web-dashboard test`)، build، rebuild ایمیج docker و بررسی بصری صفحات کلیدی.

## ترتیب اجرا و تحویل
فازها به ترتیب و هر فاز با commit جدا. بعد از هر فاز، build و تست گرفته می‌شه تا همیشه قابل تحویل باشه. حجم کار زیاده ولی مرحله‌ای و کم‌ریسک (صفحات خوب فعلی دست نمی‌خورن، فقط الگوشون تعمیم داده می‌شه).