# استقرار حسن‌گرام روی ابر آروان

این راهنما برای دامنه `hssngram.hssn.my.id` نوشته شده است. دو مسیر دارید:

- **مسیر A (پیشنهادی): سرور ابری + داکر کامپوز** — کنترل کامل، وب‌سوکت و TURN بدون دردسر.
- **مسیر B: ابر کانتینر (PaaS)** — مدیریت کمتر، مناسب وقتی نمی‌خواهید سرور نگه دارید.

---

## مسیر A — سرور ابری آروان (پیشنهادی)

### ۱) رکورد DNS

در پنل آروان → دامنه `hssn.my.id` → **DNS**:

| نوع | نام | مقدار | TTL |
| --- | --- | --- | --- |
| A | `hssngram` | IP سرور ابری | ۱۲۰ |

اگر دامنه پشت CDN آروان است، بعد از ساخت سرور می‌توانید همین رکورد را Proxy روشن کنید؛
برای وب‌سوکت و آپلود حجیم، خاموش بودن Proxy در ابتدا ساده‌تر است.

### ۲) ساخت سرور

پنل آروان → **سرور ابری** → ایجاد سرور:

- سیستم‌عامل: Ubuntu 24.04
- منابع: حداقل ۲ هسته / ۴ گیگ رم / ۴۰ گیگ دیسک (برای خانواده کافی است)
- کلید SSH خود را اضافه کنید

### ۳) اتصال و نصب داکر

```bash
ssh root@<SERVER_IP>

apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git
docker --version && docker compose version
```

### ۴) گرفتن کد پروژه

اگر پروژه را روی GitHub گذاشته‌اید:

```bash
git clone https://github.com/<you>/hssngram.git /opt/hssngram
cd /opt/hssngram
```

در غیر این صورت فایل zip را با `scp` بفرستید:

```bash
scp hssngram.zip root@<SERVER_IP>:/opt/ && ssh root@<SERVER_IP> 'cd /opt && apt install -y unzip && unzip -q hssngram.zip -d hssngram'
```

### ۵) تنظیم `.env`

```bash
cd /opt/hssngram
cp apps/server/.env.example apps/server/.env
nano apps/server/.env
```

حداقل این‌ها را پر کنید:

```env
PUBLIC_URL=https://hssngram.hssn.my.id
JWT_SECRET=<openssl rand -base64 48>
POSTGRES_PASSWORD=<یک گذرواژه قوی>   # در .env کامپوز هم استفاده می‌شود
TURN_SECRET=<openssl rand -base64 32>
DOMAIN=hssngram.hssn.my.id            # در .env ریشه یا محیط شل
```

> `docker-compose.yml` آدرس دیتابیس را خودش به کانتینر `db` وصل می‌کند؛
> `DATABASE_URL` داخل `.env` فقط برای اجرای دستی/مایگریشن بیرون داکر است.
> `STORAGE_DRIVER=local` برای شروع ساده‌تر است؛ برای حجم بالا `s3` را با کلیدهای آبجکت‌استوریج آروان تنظیم کنید.

### ۶) بالا آوردن سرویس

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app      # باید «listening on http://0.0.0.0:8080» را ببینید
```

Caddy به‌طور خودکار برای `hssngram.hssn.my.id` گواهی Let's Encrypt می‌گیرد (پورت‌های ۸۰ و ۴۴۳ باید باز باشند).

### ۷) ساخت ادمین

```bash
docker compose exec app node apps/server/dist/cli/seed.js
```

خروجی:

```
[seed] admin 10000000 created
[seed] login id: 10000000
[seed] password: 427726
```

برای گذرواژه دیگر، قبل از اجرا مقدار `ADMIN_PASSWORD` را در `.env` بگذارید.

### ۸) ورود

<https://hssngram.hssn.my.id> → شناسه `10000000` و گذرواژه `427726`.

بعد از ورود:

1. **تنظیمات → تغییر گذرواژه** (گذرواژه ۴۲۷۷۲۶ را عوض کنید).
2. **تنظیمات → پنل مدیریت** → کاربران تازه را تأیید کنید.

### ۹) فایروال

در پنل آروان (Firewall سرور) یا با `ufw`:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw enable
```

پورت‌های `3478` و بازه `49160-49200` مال TURN هستند؛ بدون آن‌ها تماس بین شبکه‌های سخت‌گیر (مثلاً داده موبایل) برقرار نمی‌شود.

### ۱۰) همیشه روشن بماند

- همه سرویس‌ها `restart: always` دارند؛ بعد از ری‌استارت سرور خودشان بالا می‌آیند.
- سلامت سرویس: `curl -f https://hssngram.hssn.my.id/api/health`
- برای مانیتورینگ ساده می‌توانید در آروان → **مانیتورینگ** یک چک HTTP روی همان آدرس بسازید.

### ۱۱) بکاپ روزانه دیتابیس

```bash
mkdir -p /opt/backups
cat > /etc/cron.daily/hssngram-backup <<'EOF'
#!/bin/sh
set -e
cd /opt/hssngram
docker compose exec -T db pg_dump -U hssngram hssngram | gzip > /opt/backups/hssngram-$(date +%F).sql.gz
find /opt/backups -name 'hssngram-*.sql.gz' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/hssngram-backup
```

بازگردانی:

```bash
gunzip -c /opt/backups/hssngram-2026-11-08.sql.gz | docker compose exec -T db psql -U hssngram -d hssngram
```

### ۱۲) به‌روزرسانی

```bash
cd /opt/hssngram
git pull
docker compose up -d --build
```

مایگریشن‌ها خودکار روی استارت اجرا می‌شوند (`MIGRATE_ON_START=true`).

اگر توکن GitHub را در Secrets مخزن بگذارید، فایل `.github/workflows/deploy.yml` همین کار را با هر push روی `main` انجام می‌دهد:

| Secret | مقدار |
| --- | --- |
| `ARVAN_HOST` | IP سرور |
| `ARVAN_USER` | `root` |
| `ARVAN_SSH_KEY` | کلید خصوصی SSH |
| `ARVAN_APP_DIR` | `/opt/hssngram` |

---

## مسیر B — ابر کانتینر (PaaS)

1. ایمیج را بسازید و به رجیستری بفرستید (آروان رجیستری یا هر رجیستری دیگر):

```bash
docker build -t <REGISTRY_HOST>/hssngram:1.0.0 .
docker login <REGISTRY_HOST>
docker push <REGISTRY_HOST>/hssngram:1.0.0
```

2. در پنل → **ابر کانتینر** → ایجاد سرویس/اپ → منبع: ایمیج داکر → همان تصویر.
3. پورت سرویس: `8080`.
4. متغیرهای محیطی `.env.example` را اضافه کنید (`PUBLIC_URL`, `JWT_SECRET`, `DATABASE_URL`, …).
5. یک **دیتابیس مدیریت‌شده PostgreSQL** بسازید و رشته اتصال را در `DATABASE_URL` بگذارید.
6. دامنه: در تنظیمات دامنه همان اپ، `hssngram.hssn.my.id` را ثبت کنید و رکورد CNAME/A را طبق راهنمای پنل تنظیم کنید.
7. مایگریشن و ادمین را یک‌بار با یک Job/Exec اجرا کنید:
   `node apps/server/dist/cli/migrate.js` سپس `node apps/server/dist/cli/seed.js`.

نکته‌ها:

- برای تماس تصویری، TURN لازم است؛ یا یک سرور کوچک با `coturn` بگیرید و `TURN_URLS`/`TURN_SECRET` را ست کنید، یا تماس‌ها را در شبکه‌های باز امتحان کنید.
- اگر آپلود فایل سنگین دارید، `STORAGE_DRIVER=s3` با آبجکت‌استوریج آروان را انتخاب کنید تا از پهنای باند کانتینر کم شود.
- محدودیت‌های وب‌سوکت/بدنه درخواست در PaaS را قبل از اتکا به این مسیر بررسی کنید.

---

## عیب‌یابی

| نشانه | علت رایج | راه‌حل |
| --- | --- | --- |
| صفحه بالا نمی‌آید | Caddy نتوانسته گواهی بگیرد | پورت ۸۰/۴۴۳ و DNS را چک کنید: `docker compose logs caddy` |
| `502 Bad Gateway` | اپ کرش کرده | `docker compose logs app` |
| خطای دیتابیس | رمز یا نام دیتابیس | `docker compose logs db` و مقدار `POSTGRES_PASSWORD` |
| تماس وصل نمی‌شود | TURN یا پورت‌ها | `TURN_URLS` را ست و پورت‌های 3478/49160-49200 را باز کنید |
| فایل آپلود نمی‌شود | سقف حجم | `MAX_UPLOAD_MB` و `max_size` در `deploy/Caddyfile` |
| اعلان Push نمی‌آید | VAPID تنظیم نشده | `npx web-push generate-vapid-keys` و ست کردن کلیدها |
