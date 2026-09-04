# تصویر زنده دوربین‌های MDVR (Meitrack MD300)

مسیر زندهٔ دستگاه واقعی **AB2 + MediaMTX + HLS** است — همان pipeline پروژهٔ `md300`
(`live.js` + `MEITRACK_LIVE_VIDEO_GUIDE.md`). A9A (dialback بومی) روی MD300 قابل اعتماد نیست.

## معماری

```
[دستگاه MDVR] ←TCP 6180/5023 (GPRS)→ [device-gateway] ←Kafka← [fleet-management] ←REST← [داشبورد]
      │  فرمان AB2: rtmp://PUBLIC_IP:1935/live/md300/{channel}
      ↓ RTMP push :1935
[MediaMTX] → HLS :8888  ←nginx /media-hls─  پلیر HLS.js روی <video>
```

- دستگاه یک اتصال GPRS به `device-gateway` نگه می‌دارد (پورت **6180** مثل md300، یا **5023** پیش‌فرض پلتفرم).
- با AUTHENTICATED شدن سوکت GPRS، fleet-management مثل `live.js` همان لحظه AB2 می‌فرستد (`channel=1`, `live/md300/1`). گیت‌وی اگر سوکت هنوز نباشد فرمان را نگه می‌دارد.
- هر دوربین مسیر جدا دارد: `live/md300/1`، `live/md300/2` — دو AB2 روی یک کلید MediaMTX همدیگر را بازنویسی نمی‌کنند.
- دستگاه ویدیو را به **MediaMTX :1935** پوش می‌کند. `MDVR_PUBLIC_HOST` خالی/LAN در بوت با ipify به IP عمومی ارتقا داده می‌شود.
- داشبورد پلی‌لیست `/media-hls/live/md300/{channel}/index.m3u8` را با **hls.js** (`lowLatencyMode`) پخش می‌کند.
- تب Playback ابتدا با **AB8** لیست فیلم‌ها (`avType=3`) و عکس‌ها (`avType=4`) را از کارت SD فیلتر می‌کند (بازهٔ تاریخ). کلیک روی یک ردیف همان `t_start`/`t_end` را به **AB4** می‌دهد. Load کل بازه را پخش می‌کند.
- **AB4** با URL `live/md300/{channel}/pb` می‌رود. دستگاه این را ACK می‌کند ولی RTMP را روی همان کلید زنده `live/md300/{channel}` پابلیش می‌کند؛ پلیر همان HLS زنده را می‌بیند. Seek = **AB5** drag؛ توقف = AB5 end. AB8 باینری است و نباید comma-split شود.

## پورت‌ها

| سرویس | پورت | دسترسی | نقش |
|---|---|---|---|
| device-gateway | 6180/TCP و 5023/TCP | **عمومی** (دستگاه) | GPRS + دستورات |
| MediaMTX | 1935/TCP | **عمومی** (دستگاه) | RTMP ingest بعد از AB2 |
| MediaMTX | 8888 | داخلی (nginx `/media-hls`) | HLS برای مرورگر |

دستگاه را با A21 به **همین** IP عمومی و پورت **6180** بزنید (مثل md300). پورت **1935** هم باید از اینترنت به این میزبان برسد.

## متغیرها

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `GATEWAY_MEITRACK_PORT` | 5023 | پورت GPRS پلتفرم (6180 همیشه علاوه بر آن باز است) |
| `MDVR_RTMP_PORT` | 1935 | پورت RTMP که دستگاه به آن پوش می‌کند |
| `MDVR_RTMP_PATH` | `live/md300` | مسیر RTMP/HLS (مثل md300-main `live.js`) |
| `MDVR_PUBLIC_HOST` | (خالی → ipify) | IP/دامنهٔ قابل‌دسترس از دستگاه؛ LAN نادیده گرفته می‌شود |
