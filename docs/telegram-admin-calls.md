# مدل گروه، کانال، نقش و تماس گروهی تلگرام → طرح داده و API

**دامنه:** استخراج مدل دقیق تلگرام و ترجمهٔ آن به طرح داده و API برای HssNGram.
**وضعیت:** سند طراحی. هیچ کدی در این تغییر دست نخورده است؛ این فایل تنها خروجی است.
**تاریخ:** ۱۴۰۵/۰۸/۱۷ (2026-11-08) — مطابق لایهٔ ۲۲۳–۲۲۵ اسکیمای تلگرام.

---

## ۰) خلاصهٔ اجرایی

1. تلگرام فقط دو خانوادهٔ چت دارد: `user` (چت خصوصی) و `channel`؛ «گروه پایه» یک `chat` است و «ابرگروه»/«کانال» هر دو `channel` با فلگ‌های `megagroup`/`broadcast`. تفاوت رفتارها از همین فلگ‌ها می‌آید، نه از جدول جدا.[[S1]](#s1)
2. مجوز مدیر یک **بیت‌ماسک** است (`chatAdminRights`)، مجوز عضو یک **بیت‌ماسک ممنوعیت** با معنای معکوس (`chatBannedRights`) و حقوق پیش‌فرض یک بیت‌ماسک سوم برای همهٔ اعضا. مدل «نقش ثابت» کافی نیست.[[S2]](#s2)[[S10]](#s10)
3. «محدودشده» عضوی است که مانده ولی بعضی کارها را نمی‌تواند؛ «مسدود» کسی است که `view_messages` دارد و عملاً از گروه بیرون است. این دو نباید در یک ستون `role` ادغام شوند.[[S10]](#s10)
4. لینک دعوت یک رکورد قابل‌ابطال با `expires_at`/`usage_limit`/`request_needed` است، نه یک توکن ثابت روی خود چت.[[S3]](#s3)
5. «تیک خوانده‌شدن» در گروه یک واقعیت سراسری نیست: تلگرام برای گروه‌های کمتر از ۱۰۰ عضو و فقط تا ۷ روز، «چه کسی خواند» را نگه می‌دارد.[[S7]](#s7)[[S6]](#s6)
6. تماس گروهی یک آبجکت مستقل با `version` است؛ میوت اجباری، درخواست صحبت، اشتراک صفحه به‌عنوان اتصال جداگانه و «حالت استریم» برای مخاطب بزرگ از همان صفحه می‌آید.[[S4]](#s4)
7. برای سقف ۴ نفر در وب، mesh کافی است **به شرط** سقف سخت سمت سرور، اولویت صدا، و محدودسازی نرخ/رزولوشن؛ از ۵ نفر یا ویدیو+اشتراک هم‌زمان باید SFU جدا راه‌اندازی شود.

---

## ۱) لایه‌بندی شواهد

| لایه | معنا در این سند | نمونه |
| --- | --- | --- |
| **تأییدشده (V)** | مستقیماً در صفحهٔ رسمی تلگرام آمده و در همین اجرا خوانده شده | سقف ۲۰۰٬۰۰۰ عضو ابرگروه؛ `until_date` کمتر از ۳۰ ثانیه = همیشگی |
| **استنتاج (I)** | از چند گزارهٔ تأییدشده یا از رفتار شناخته‌شدهٔ کلاینت‌ها نتیجه گرفته شده، ولی جملهٔ صریحی برایش پیدا نشد | «مسدود = عضوی با `view_messages`»؛ نگاشت kick به ban کوتاه‌مدت |
| **تصمیم طراحی (D)** | انتخاب ما برای HssNGram، نه ادعای تلگرام | سقف سخت ۴ نفر در تماس؛ پیش‌فرض خاموش‌بودن دوربین در تماس گروهی ۳ نفره و بیشتر |
| **نامعلوم (U)** | در منابع رسمی پیدا نشد و باید اندازه‌گیری یا پرسیده شود | مقدار عددی `revoke_time_limit` در سرور؛ سقف دقیق هم‌زمانی ویدیو در دسکتاپ |

منابع کامل در [پایان سند](#منابع). شماره‌ها در جدول‌ها به همان فهرست اشاره می‌کند.

---

## ۲) مدل چت: چهار نوع و رفتار متفاوت

### ۲.۱ نگاشت ساختاری

| مفهوم محصولی | سازندهٔ API | فلگ تعیین‌کننده | ساخت با |
| --- | --- | --- | --- |
| چت خصوصی | `user` | — | خودکار با اولین پیام |
| گروه پایه (basic group) | `chat` | — | `messages.createChat` [[S1]](#s1) |
| ابرگروه (supergroup) | `channel` | `megagroup` | `channels.createChannel` [[S1]](#s1) |
| کانال (channel) | `channel` | `broadcast` | `channels.createChannel` [[S1]](#s1) |
| گروه بزرگ (gigagroup) | `channel` | `megagroup` + `gigagroup` | `channels.convertToGigagroup` (یک‌طرفه) [[S1]](#s1) |
| فروم | `channel` | `megagroup` + `forum` | `channels.toggleForum` [[S1]](#s1) |

نکتهٔ کلیدی برای طرح داده: **ابرگروه و کانال یک جدول‌اند**، چون یک `channel` هستند؛ تفاوت در ستون‌های رفتاری (`is_broadcast`, `is_megagroup`) است، نه در نوع موجودیت.

### ۲.۲ جدول تفاوت رفتار

| ویژگی | چت خصوصی | گروه پایه | ابرگروه | کانال | گروه بزرگ |
| --- | --- | --- | --- | --- | --- |
| سقف عضو | ۲ | ۲۰۰ [[S1]](#s1) | ۲۰۰٬۰۰۰ [[S1]](#s1)[[S14]](#s14) | نامحدود (مشترک) [[S14]](#s14) | > ۲۰۰٬۰۰۰، بدون سقف مشخص [[S1]](#s1) |
| شناسهٔ پیام | مشترک با همهٔ چت‌های خصوصی و گروه‌های پایه (`pts` واحد) [[S1]](#s1) | همان | مستقل per-channel | مستقل | مستقل |
| یوزرنیم عمومی | برای کاربر، نه برای چت | ❌ (باید به ابرگروه مهاجرت کند) [[S3]](#s3) | ✅ [[S3]](#s3) | ✅ [[S3]](#s3) | ✅ |
| لینک دعوت | — | ✅ | ✅ | ✅ | ❌ (نمی‌توان کسی را دعوت کرد) [[S1]](#s1) |
| join request | — | ❌ | ✅ [[S3]](#s3) | ✅ [[S3]](#s3) | ❌ |
| مجوز دانه‌ای مدیر | — | ❌ فقط `is_admin` بولین [[S2]](#s2) | ✅ `chatAdminRights` | ✅ | ✅ |
| محدودیت دانه‌ای تک‌کاربر | — | ❌ فقط اخراج [[S2]](#s2) | ✅ `chatBannedRights` | ✅ | ✅ |
| حقوق پیش‌فرض برای همه | — | ✅ | ✅ | ✅ | ✅ (پیش‌فرض: فقط مدیران می‌نویسند) [[S1]](#s1) |
| حالت آهسته | — | ❌ | ✅ `channels.toggleSlowMode` [[S12]](#s12) | ❌ (کسی نمی‌نویسد) | ❌ |
| لاگ مدیریت | — | ❌ | ✅ admin log [[S1]](#s1) | ✅ | ✅ |
| تاریخچه برای عضو جدید | کل تاریخچه | کل تاریخچه | قابل خاموش‌کردن | همهٔ پست‌ها | همه |
| فهرست اعضا | — | همیشه و کامل در `chatFull` [[S1]](#s1) | بر اساس تقاضا؛ قابل پنهان‌سازی از ۱۰۰ عضو [[S6]](#s6) | قابل پنهان‌سازی | قابل پنهان‌سازی |
| تیک خوانده‌شدن | دوطرفه | بدون تیک per-message | بدون تیک؛ «چه کسی خواند» فقط <۱۰۰ عضو و ۷ روز [[S7]](#s7) | شمارندهٔ بازدید per-post [[S1]](#s1) | بدون تیک |
| تماس گروهی | ۱:۱ | ✅ video chat | ✅ video chat | ✅ livestream | ✅ (اعضا پیش‌فرض میوت) [[S1]](#s1) |
| حذف پیام برای همه | ✅ | ✅ | ✅ | ✅ | ✅ |
| ارسال با نام گروه | — | ❌ | فقط مدیر ناشناس [[S2]](#s2) | پیش‌فرض ناشناس + سلف‌امضا [[S1]](#s1) | فقط مدیران |

**مهاجرت گروه پایه → ابرگروه:** `messages.migrateChat`. خروجی دو آبجکت است: `chat` قدیمی با `migrated_to` و `channel` جدید؛ در `channelFull` فیلدهای `migrated_from_chat_id` و `migrated_from_max_id` برمی‌گردد و همهٔ اعضا `messageActionChatMigrateTo` می‌گیرند. تاریخچه باید سمت کلاینت از دو peer ادغام شود. توصیه: مهاجرت را **خودکار** انجام بده وقتی کاربر کاری می‌خواهد که فقط ابرگروه پشتیبانی می‌کند (یوزرنیم، لینک دعوت پیشرفته، مجوز دانه‌ای).[[S1]](#s1)

---

## ۳) نقش‌ها و وضعیت‌های عضویت

| نقش/وضعیت | تعریف در تلگرام | پیاده‌سازی پیشنهادی |
| --- | --- | --- |
| **سازنده** (`creator`) | دقیقاً یکی؛ فقط با `messages.editChatCreator` + رمز دومرحله‌ای منتقل می‌شود. ترک گروه باعث می‌شود تلگرام با `messages.getFutureChatCreatorAfterLeave` جانشین را اعلام کند و در ابرگروه/کانال **۷ روز** مهلت بازگشت بدهد.[[S1]](#s1) | `role='owner'` + `chats.owner_id` (موجود) |
| **مدیر** (`admin`) | بیت‌ماسک `chatAdminRights`؛ در گروه پایه فقط بولین.[[S2]](#s2) | `role='admin'` + `rights jsonb` |
| **مدیر ناشناس** | حق `anonymous`: از فهرست اعضا پنهان می‌شود و فقط با نام گروه می‌نویسد؛ `send_as` پیش‌فرض روی خود گروه تنظیم می‌شود.[[S2]](#s2) | `is_anonymous boolean` |
| **عضو** | تابع `default_rights` چت | `role='member'` |
| **محدودشده** (`restricted`) | عضو مانده، ولی زیرمجموعه‌ای از `chatBannedRights` روی او ست است (مثلاً `send_media`). می‌تواند تاریخچه را بخواند مگر `view_messages` هم ست شود.[[S10]](#s10) | `restricted_until` + `restricted_rights jsonb` روی همان ردیف عضویت |
| **مسدود** (`banned`) | `view_messages` ست است؛ عملاً دسترسی ندارد و از طریق لینک دعوت هم برنمی‌گردد. | ردیف عضویت حذف + رکورد در `chat_bans` |
| **خارج‌شده** (`left`) | عضو نیست؛ در ابرگروه تاریخچه را از دست می‌دهد | حذف ردیف عضویت + لاگ |
| **در انتظار تأیید** | درخواست عضویت ثبت شده ولی عضو نیست | ردیف در `chat_join_requests` با `status='pending'` |

**قاعدهٔ «مدیر نمی‌تواند بیشتر از خودش بدهد»:** حق `add_admins` اجازهٔ افزودن مدیر «با همان یا مجوز کمتر» را می‌دهد؛ سرور باید زیرمجموعه‌بودن را اعتبارسنجی کند، نه فقط وجود حق را.[[S11]](#s11)[[S2]](#s2)

**مدت محدودیت:** `until_date` کمتر از ۳۰ ثانیه یا بیشتر از ۳۶۶ روز **همیشگی** تلقی می‌شود؛ پس «برای همیشه» را با `null` ذخیره کن، نه با یک تاریخ دور.[[S10]](#s10)

---

## ۴) ماتریس نقش × مجوز

### ۴.۱ حقوق مدیر: هر فلگ چه چیزی را باز می‌کند

| فلگ `chatAdminRights` | اثر | دامنه | پیاده‌سازی محلی |
| --- | --- | --- | --- |
| `change_info` | تغییر عنوان/توضیح/عکس | گروه + کانال | `right:change_info` |
| `delete_messages` | حذف پیام دیگران (و در کانال، پست دیگران) | گروه + کانال | `right:delete_messages` |
| `ban_users` | مسدود/محدودکردن عضو | گروه + کانال | `right:ban_users` |
| `invite_users` | دعوت مستقیم و **ساخت لینک دعوت** | گروه + کانال | `right:invite_users` |
| `pin_messages` | پین/آنپین | گروه + کانال | `right:pin_messages` |
| `add_admins` | افزودن/حذف مدیر با مجوز ≤ خودش | گروه + کانال | `right:add_admins` |
| `anonymous` | پنهان از فهرست اعضا، ارسال با نام گروه | فقط ابرگروه [[S2]](#s2) | `is_anonymous` |
| `manage_call` | ساخت و ادارهٔ ویدیوچت/لایو | گروه + کانال | `right:manage_call` |
| `manage_topics` | ساخت/حذف/ویرایش تاپیک فروم | فروم | `right:manage_topics` |
| `other` | بدون مجوز مشخص ولی «مدیر»؛ همین فلگ هم لاگ مدیریت، آمار و نادیده‌گرفتن حالت آهسته را می‌دهد | گروه + کانال | `is_admin=true, rights={}` |
| `post_messages` | ارسال پست در کانال | **فقط کانال** [[S11]](#s11) | `right:post_messages` |
| `edit_messages` | ویرایش پیام سایر مدیران | **فقط کانال** [[S11]](#s11) | `right:edit_messages` |
| `post_stories` / `edit_stories` / `delete_stories` | استوری با نام کانال | کانال | خارج از دامنه |
| `manage_direct_messages` | مدیریت monoforum کانال | کانال | خارج از دامنه |
| `manage_ranks` | تغییر تگ/نشان اعضا | گروه + کانال | خارج از دامنه (نسخهٔ بعد) |

> نکتهٔ مهم برای API ما: `post_messages` و `edit_messages` در ابرگروه معنا ندارند؛ اگر در کد به‌صورت عمومی چک شوند، مدیر ابرگروه به‌اشتباه اجازهٔ ارسال پیدا یا از دست می‌دهد. اعتبارسنجی باید به `type` چت مقید باشد.

### ۴.۲ ماتریس اصلی (نقش × قابلیت)

راهنما: ✅ مجاز · ⚙️ وابسته به حق/تنظیم چت · ❌ ممنوع · — بی‌معنا.

| قابلیت | سازنده | مدیر | عضو عادی | محدودشده | مسدود | مدیر کانال | مشترک کانال |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ارسال پیام | ✅ | ✅ (ناشناس: با نام گروه) | ⚙️ `send_messages` | ❌ اگر `send_messages` ست باشد | ❌ | ⚙️ `post_messages` | ❌ |
| ارسال مدیا | ✅ | ✅ | ⚙️ `send_media` و فلگ‌های نوع‌محور | ❌ اگر `send_media` ست باشد | ❌ | ⚙️ `post_messages` | ❌ |
| افزودن کاربر (مستقیم) | ✅ | ⚙️ `invite_users` | ⚙️ `default_rights.invite_users` + `privacyKeyChatInvite` طرف مقابل | ❌ اگر `invite_users` ست باشد | ❌ | ⚙️ `invite_users` | ❌ |
| ساخت لینک دعوت | ✅ | ⚙️ `invite_users` | ❌ (ولی می‌تواند لینک موجود را بازنشر کند) | ❌ | ❌ | ⚙️ `invite_users` | ❌ |
| پین کردن | ✅ | ⚙️ `pin_messages` | ⚙️ `default_rights.pin_messages` | ❌ | ❌ | ⚙️ `pin_messages` | ❌ |
| حذف پیام دیگران | ✅ | ⚙️ `delete_messages` | ❌ (فقط پیام خودش) | ❌ | ❌ | ⚙️ `delete_messages` | ❌ |
| حذف پیام خودش برای همه | ✅ | ✅ | ✅ (در پنجرهٔ مجاز سرور) | ✅ | ❌ | ✅ | ❌ |
| مسدود/اخراج | ✅ | ⚙️ `ban_users` | ❌ | ❌ | ❌ | ⚙️ `ban_users` | ❌ |
| محدودکردن (میوت اجباری) | ✅ | ⚙️ `ban_users` | ❌ | ❌ | ❌ | ⚙️ `ban_users` | ❌ |
| ارسال ناشناس | — | ⚙️ `anonymous` | ❌ | ❌ | ❌ | پیش‌فرض: بله | — |
| مدیریت تماس صوتی/تصویری | ✅ | ⚙️ `manage_call` | ❌ | ❌ | ❌ | ⚙️ `manage_call` | ❌ |
| شرکت در تماس | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ (در لایو: فقط تماشا) |
| تغییر اطلاعات چت | ✅ | ⚙️ `change_info` | ⚙️ `default_rights.change_info` | ❌ | ❌ | ⚙️ `change_info` | ❌ |
| ویرایش پیام دیگران | ❌ | ❌ (در گروه) | ❌ | ❌ | ❌ | ⚙️ `edit_messages` | ❌ |
| عبور از حالت آهسته | ✅ | ✅ (هر حقی که داشته باشد) [[S11]](#s11) | ❌ | ❌ | — | — | — |
| دیدن لاگ مدیریت | — | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| دیدن «چه کسی خواند» | — | ⚙️ فقط گروه <۱۰۰ عضو و ۷ روز [[S7]](#s7) | ⚙️ همان شرط | — | — | — | — |
| مدیریت تاپیک فروم | ✅ | ⚙️ `manage_topics` | ❌ | ❌ | ❌ | — | — |
| افزودن مدیر | ✅ | ⚙️ `add_admins` | ❌ | ❌ | ❌ | ⚙️ `add_admins` | ❌ |

### ۴.۳ حقوق ممنوعیت عضو: فلگ‌ها و معنای معکوس

در `chatBannedRights` هر فلگ **ست‌شده یعنی «اجازه ندارد»**؛ این نقطهٔ اصلی اشتباه در پیاده‌سازی است.[[S10]](#s10)

| گروه | فلگ‌ها |
| --- | --- |
| دیدن | `view_messages` (تنها فلگی که «مسدود» می‌سازد؛ در حقوق پیش‌فرض مجاز نیست) [[S2]](#s2) |
| متن | `send_messages`, `send_plain` |
| مدیا | `send_media`, `send_photos`, `send_videos`, `send_roundvideos`, `send_audios`, `send_voices`, `send_docs`, `send_stickers`, `send_gifs` |
| تعامل | `send_polls`, `send_games`, `send_inline`, `embed_links`, `send_reactions` |
| مدیریتی | `change_info`, `invite_users`, `pin_messages`, `manage_topics`, `edit_rank` |
| زمان | `until_date`؛ <۳۰ ثانیه یا >۳۶۶ روز = همیشگی [[S10]](#s10) |

**تفکیک سطوح:** حقوق پیش‌فرض با `messages.editChatDefaultBannedRights` روی **همهٔ اعضا** اعمال می‌شود و همهٔ فلگ‌ها به‌جز `view_messages` مجازند؛ حقوق تک‌کاربر با `channels.editBanned` و فقط در ابرگروه/کانال.[[S2]](#s2)

---

## ۵) لینک دعوت، یوزرنیم و درخواست عضویت

### ۵.۱ اعتبارسنجی یوزرنیم

| قاعده | مقدار | منبع |
| --- | --- | --- |
| طول | ۵ تا ۳۲ نویسه | [[S8]](#s8) |
| نویسه‌های مجاز | `A-z` (بی‌توجه به بزرگی/کوچکی)، `0-9`، `_` | [[S8]](#s8) |
| حساسیت به حروف | ندارد؛ تلگرام فقط شکل نوشتاری را نگه می‌دارد | [[S14]](#s14) |
| شروع/پایان با `_` | در منابع رسمی که خوانده شد صریح نیست؛ **در محصول رد شود** (D) | [[S8]](#s8) با احتیاط |
| فقط رقم | مجاز شمرده نشده؛ **رد شود** (D) | — |
| یکتا بودن در سطح سامانه | بله؛ ایندکس یکتا روی `lower(username)` | [[S8]](#s8) |
| بررسی پیش از تخصیص | `account.checkUsername` (کاربر) / `channels.checkUsername` (گروه/کانال) با خطاهای `USERNAME_INVALID`, `USERNAME_OCCUPIED`, `CHANNELS_ADMIN_PUBLIC_TOO_MUCH` | [[S8]](#s8)[[S9]](#s9) |

> در تلگرام **گروه پایه نمی‌تواند یوزرنیم بگیرد** و باید اول به ابرگروه مهاجرت کند.[[S3]](#s3)

### ۵.۲ لینک دعوت: مدل داده و قواعد

تلگرام سه شکل لینک را می‌شناسد: `t.me/+<hash>`، `joinchat/<hash>` و `tg://join?invite=<hash>`؛ الگوی رسمی استخراج هش:

```
@(?:t|telegram)\.(me|dog)/(joinchat/|\+)?([\w-]+)@i
```

و همان گروه سوم به `messages.checkChatInvite` / `messages.importChatInvite` داده می‌شود.[[S3]](#s3)[[S16]](#s16)

| ویژگی لینک | معنا | اثر |
| --- | --- | --- |
| `permanent` | لینک اصلی چت | با ساخت گروه/کانال خودکار ساخته می‌شود |
| `expire_date` | انقضا | بعد از تاریخ، `checkChatInvite` باید خطای منقضی بدهد |
| `usage_limit` / `usage` | سقف و شمارندهٔ استفاده | پر شدن = عدم پذیرش |
| `request_needed` | نیاز به تأیید مدیر | `importChatInvite` با `INVITE_REQUEST_SENT` برمی‌گردد [[S3]](#s3) |
| `revoked` | ابطال | لینک باطل می‌شود ولی سابقه باقی می‌ماند |
| `title` | برچسب لینک | برای تفکیک کمپین‌ها |
| `admin_id` | سازندهٔ لینک | آمار per-admin با `messages.getAdminsWithInvites` |

**جریان join request (تأییدشده):** ساخت/ویرایش لینک با `request_needed` یا `channels.toggleJoinRequest` → کاربر با `importChatInvite` خطای `INVITE_REQUEST_SENT` می‌گیرد → مدیران `updatePendingJoinRequests` می‌گیرند → فهرست با `messages.getChatInviteImporters(requested=true)` → تأیید/رد با `messages.hideChatJoinRequest` (یا `hideAllChatJoinRequests` برای گروهی) → ورود با `messageActionChatJoinedByRequest` در تاریخچه ثبت می‌شود. فلگ `channel.join_request` روی چت ست می‌شود.[[S3]](#s3)

**دعوت مستقیم:** `channels.inviteToChannel` / `messages.addChatUser` نتیجه را در `messages.invitedUsers` برمی‌گرداند؛ اگر کاربر به‌خاطر تنظیمات حریم خصوصی اضافه نشد، `missingInvitee` می‌آید و راه‌حل رسمی «ساخت لینک و ارسال در پیام خصوصی» است.[[S3]](#s3)

**حریم خصوصی مرتبط:** کلید `privacyKeyChatInvite` تعیین می‌کند چه کسی می‌تواند شما را به گروه اضافه کند؛ این تنظیم سمت **کاربر دعوت‌شده** است، نه مدیر گروه.[[S5]](#s5)

### ۵.۳ قواعد اعتبارسنجی پیشنهادی برای HssNGram

| ورودی | قاعده | خطای خروجی |
| --- | --- | --- |
| توکن دعوت | ۱۶–۶۴ نویسه `[A-Za-z0-9_-]`، بدون فاصله | `400 INVITE_MALFORMED` |
| لینک کامل | همان regex بالا؛ فقط هش نگه داشته شود | `400 INVITE_MALFORMED` |
| لینک باطل | `revoked_at is not null` | `410 INVITE_REVOKED` |
| منقضی | `expires_at < now()` | `410 INVITE_EXPIRED` |
| پر شده | `usage_limit is not null and uses >= usage_limit` | `410 INVITE_FULL` |
| کاربر مسدود | رکورد در `chat_bans` | `403 BANNED` |
| نیاز به تأیید | `request_needed` یا `join_request_enabled` | `202 REQUEST_SENT` |
| عضو بالفعل | عضویت موجود | `200 ALREADY_MEMBER` با خود چت |
| یوزرنیم | ۵–۳۲، `^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$` | `422 USERNAME_INVALID` / `409 USERNAME_TAKEN` |

---

## ۶) تیک خوانده‌شدن و حذف پیام

### ۶.۱ واقعیت تلگرام

| سناریو | آنچه تلگرام نشان می‌دهد | شاهد |
| --- | --- | --- |
| چت خصوصی | یک تیک = تحویل به ابر، دو تیک = خوانده‌شدن | [[S14]](#s14) |
| گروه | تیک per-message وجود ندارد؛ وضعیت خواندن هر عضو یک عدد (`last_read_seq`) است | [[S14]](#s14)[[S1]](#s1) |
| گروه <۱۰۰ عضو | «چه کسی خواند» برای یک پیام، تا ۷ روز (`chat_read_mark_expire_period=604800`)؛ بعد از آن `MSG_TOO_OLD`، و برای گروه بزرگ‌تر `CHAT_TOO_BIG` | [[S7]](#s7)[[S6]](#s6) |
| کانال | شمارندهٔ بازدید per-post، بدون «چه کسی» | [[S1]](#s1) |
| حریم خصوصی | `globalPrivacySettings.hide_read_marks` می‌تواند تیک خواندن را برای دیگران پنهان کند | [[S5]](#s5) |

### ۶.۲ حذف پیام

| عمل | روش تلگرام | پیاده‌سازی ما |
| --- | --- | --- |
| حذف برای خودم | محلی | ردیف در `message_hidden` (موجود) |
| حذف برای همه (نویسنده) | `messages.deleteMessages` با `revoke=true`؛ بدون جانشین و بدون «پیام حذف شد» [[S13]](#s13) | `messages.deleted_at` ست + پاک‌کردن `attachments` از استوریج |
| حذف پیام دیگران | فقط با حق `delete_messages` (کانال: `edit_messages` هم برای ویرایش) | همان گارد |
| پیام سرویس | خطای `MESSAGE_DELETE_FORBIDDEN`؛ پیام‌های سیستمی قابل حذف نیستند | `kind='system'` غیرقابل حذف |
| پنجرهٔ زمانی | سقف سمت سرور (`revoke_time_limit` در `config`) — **مقدار عددی نامعلوم (U)** | مقدار را در `env` بگذار، سخت‌کد نکن |

پیام حذف‌شده نباید در فهرست گفتگو، جستجو، اعلان push و شمارندهٔ خوانده‌نشده باقی بماند؛ در تلگرام جای خالی هم نمی‌ماند و همین یکی از تفاوت‌های محسوس با پیام‌رسان‌های دیگر است.

---

## ۷) تماس گروهی

### ۷.۱ انواع

| نوع | وابسته به | سازنده | نکته |
| --- | --- | --- | --- |
| ویدیوچت گروه | گروه پایه یا ابرگروه | `phone.createGroupCall` | هر چت فقط **یک** تماس فعال؛ شروع تماس جدید قبلی را پایان می‌دهد [[S4]](#s4) |
| لایو‌استریم کانال | کانال | `phone.createGroupCall` | یک ناشر، بقیه تماشاگر |
| لایو استوری | استوری کاربر/کانال | `stories.startLive` | فقط با `inputPeerSelf` |
| کنفرانس | هیچ چتی | `phone.createConferenceCall` | سرتاسر رمزنگاری‌شده؛ فقط سازنده می‌تواند پایان دهد [[S4]](#s4) |

ساخت تماس نیازمند حق `manage_call` است.[[S4]](#s4)

### ۷.۲ قواعد صحبت و مدیریت

| قاعده | جزئیات | شاهد |
| --- | --- | --- |
| ورود بی‌صدا | `join_muted` روی تماس؛ در `joinGroupCall` با `muted=true` | [[S4]](#s4) |
| میوت اجباری | مدیر با `manage_call` می‌تواند غیرمدیر را میوت کند؛ میوت‌شده `can_self_unmute` ندارد | [[S4]](#s4) |
| برداشتن میوت اجباری | مدیر نمی‌تواند مستقیم آن‌میوت کند؛ با `muted=false` فقط `can_self_unmute` را برمی‌گرداند | [[S4]](#s4) |
| مدیران | قابل میوت اجباری نیستند؛ همیشه `can_self_unmute` دارند | [[S4]](#s4) |
| درخواست صحبت | `raise_hand` (فقط ویدیوچت/لایو، نه کنفرانس) | [[S4]](#s4) |
| بلندگو | `volume` بین ۱ تا ۲۰۰۰۰، مقدار ۱۰۰۰۰ = ۱۰۰٪ | [[S4]](#s4) |
| اشتراک صفحه | اتصال WebRTC **جداگانه** با `phone.joinGroupCallPresentation`؛ پاسخ در `updateGroupCallConnection` با فلگ `presentation` | [[S4]](#s4) |
| پایان تماس | `phone.discardGroupCall` برای همه؛ `phone.leaveGroupCall` فقط برای خودم | [[S4]](#s4) |
| همگام‌سازی | هر تغییر `version` دارد؛ اگر gap شد، تا ۱ ثانیه صبر و بعد `phone.getGroupCall` برای refetch | [[S4]](#s4) |
| بازیابی اتصال | `phone.checkGroupCall` هر ۴ ثانیه تا برقراری مجدد | [[S4]](#s4) |
| مخاطب بزرگ | سرور می‌تواند مخاطب را از WebRTC به «حالت استریم» (دانلود تکه‌ای) ببرد؛ RTMP فقط یک ناشر | [[S4]](#s4) |

### ۷.۳ محدودیت‌های عددی — با تفکیک منبع

| عدد | مقدار | وضعیت |
| --- | --- | --- |
| `groupcall_video_participants_max` | ۱۰۰۰ | V، پیش‌فرض کلاینت در لایهٔ فعلی [[S6]](#s6) |
| `conference_call_size_limit` | ۲۰۰ | V [[S6]](#s6) |
| «تماس گروهی تا ۲۰۰ نفر» | ۲۰۰ | V، FAQ رسمی [[S14]](#s14) |
| صدا نامحدود، ویدیو ۳۰ نفر | ۳۰ | V، اما **بیانیهٔ ۲۰۲۱**؛ بعداً افزایش یافت [[S15]](#s15) |
| سقف هم‌زمانی اشتراک صفحه | نامشخص | U |

> برای طراحی محصول به «۳۰» یا «۲۰۰» تکیه نکن؛ این اعداد در طول زمان تغییر کرده‌اند. عدد را از تنظیمات بخوان، نه از کد.

---

## ۸) طرح داده پیشنهادی

اصول: سازگاری با اسکیمای موجود (`uuid`, `timestamptz`, `jsonb`, `text + check`)، عدم شکستن مسیرهای فعلی، و جدا نگه‌داشتن «ممنوعیت» از «عضویت».

### ۸.۱ تغییر جدول `chats`

| ستون | نوع | Null/Default | قید | چرا |
| --- | --- | --- | --- | --- |
| `type` | `text` | not null | check: `direct, group, supergroup, channel` | افزودن دو نوع تلگرامی؛ `group` = گروه پایه |
| `username` | `text` | null | ایندکس یکتای جزئی روی `lower(username)` | یوزرنیم عمومی |
| `is_public` | `boolean` | `false` | — | یوزرنیم دارد یا نه |
| `join_request_enabled` | `boolean` | `false` | — | معادل `channels.toggleJoinRequest` |
| `slowmode_seconds` | `integer` | `0` | `>= 0` | معادل `channels.toggleSlowMode` |
| `default_rights` | `jsonb` | `'{}'` | کلیدها = فلگ‌های ممنوعیت | حقوق همهٔ اعضا |
| `history_for_new_members` | `boolean` | `true` | — | تاریخچهٔ ماندگار |
| `sign_messages` | `boolean` | `false` | — | امضای پست کانال |
| `linked_chat_id` | `uuid` | null | fk → `chats(id)` | گروه بحث کانال |
| `migrated_from_id` | `uuid` | null | fk → `chats(id)` | گروه پایهٔ مبدأ |
| `migrated_to_id` | `uuid` | null | fk → `chats(id)` | مقصد مهاجرت |
| `members_hidden` | `boolean` | `false` | فقط `supergroup/channel` | پنهان‌سازی فهرست اعضا |

### ۸.۲ تغییر جدول `chat_members`

| ستون | نوع | Null/Default | قید | چرا |
| --- | --- | --- | --- | --- |
| `role` | `text` | `'member'` | check موجود: `owner, admin, member` | بدون تغییر |
| `rights` | `jsonb` | `'{}'` | فقط برای `admin` | `chatAdminRights` |
| `is_anonymous` | `boolean` | `false` | فقط `admin` | مدیر ناشناس |
| `rank` | `text` | null | طول ≤ ۱۶ | تگ/نشان مدیر |
| `restricted_rights` | `jsonb` | `'{}'` | — | `chatBannedRights` بدون `view_messages` |
| `restricted_until` | `timestamptz` | null | null = همیشگی | مدت محدودیت |
| `invited_by` | `uuid` | null | fk → `users(id)` | ردگیری دعوت |
| `invite_id` | `uuid` | null | fk → `chat_invites(id)` | کدام لینک |
| `last_read_seq` | `bigint` | `0` | موجود | وضعیت خواندن |

ایندکس‌های لازم: `(chat_id, role)`, `(user_id, role)`.

### ۸.۳ جدول جدید `chat_bans`

| ستون | نوع | Null/Default | قید |
| --- | --- | --- | --- |
| `chat_id` | `uuid` | not null | fk → `chats(id)` on delete cascade |
| `user_id` | `uuid` | not null | fk → `users(id)` on delete cascade |
| `banned_by` | `uuid` | null | fk → `users(id)` |
| `reason` | `text` | `''` | — |
| `until` | `timestamptz` | null | null = همیشگی |
| `created_at` | `timestamptz` | `now()` | — |

کلید اصلی: `(chat_id, user_id)`. ایندکس: `(chat_id, created_at desc)`.

### ۸.۴ جدول جدید `chat_invites`

| ستون | نوع | Null/Default | قید |
| --- | --- | --- | --- |
| `id` | `uuid` | `gen_random_uuid()` | pk |
| `chat_id` | `uuid` | not null | fk → `chats(id)` cascade |
| `token` | `text` | not null | unique؛ ۲۲ نویسه base64url |
| `created_by` | `uuid` | null | fk → `users(id)` |
| `title` | `text` | `''` | برچسب |
| `request_needed` | `boolean` | `false` | — |
| `expires_at` | `timestamptz` | null | null = بی‌انقضا |
| `usage_limit` | `integer` | null | `> 0` |
| `uses` | `integer` | `0` | `>= 0` |
| `approved` | `integer` | `0` | تعداد تأییدها |
| `revoked_at` | `timestamptz` | null | — |
| `created_at` | `timestamptz` | `now()` | — |

### ۸.۵ جدول جدید `chat_join_requests`

| ستون | نوع | Null/Default | قید |
| --- | --- | --- | --- |
| `id` | `uuid` | `gen_random_uuid()` | pk |
| `chat_id` | `uuid` | not null | fk cascade |
| `user_id` | `uuid` | not null | fk cascade |
| `invite_id` | `uuid` | null | fk → `chat_invites(id)` |
| `about` | `text` | `''` | پیام درخواست |
| `status` | `text` | `'pending'` | check: `pending, approved, dismissed` |
| `decided_by` | `uuid` | null | fk → `users(id)` |
| `decided_at` | `timestamptz` | null | — |
| `created_at` | `timestamptz` | `now()` | — |

ایندکس یکتای جزئی: `(chat_id, user_id) where status='pending'`.

### ۸.۶ جدول جدید `chat_admin_log`

| ستون | نوع | Null/Default | قید |
| --- | --- | --- | --- |
| `id` | `bigserial` | — | pk |
| `chat_id` | `uuid` | not null | fk cascade |
| `actor_id` | `uuid` | null | fk → `users(id)` |
| `action` | `text` | not null | مثل `member.ban`, `admin.grant`, `invite.revoke`, `call.end` |
| `target_user_id` | `uuid` | null | fk → `users(id)` |
| `payload` | `jsonb` | `'{}'` | قبل/بعد حقوق |
| `created_at` | `timestamptz` | `now()` | — |

ایندکس: `(chat_id, id desc)`.

### ۸.۷ تغییر جدول‌های تماس

`calls`:

| ستون | نوع | Default | توضیح |
| --- | --- | --- | --- |
| `kind` | `text` | — | گسترش check به `audio, video, group_audio, group_video` |
| `join_muted` | `boolean` | `true` | ورود بی‌صدا |
| `title` | `text` | `''` | عنوان تماس |
| `version` | `integer` | `1` | نسخهٔ وضعیت برای همگام‌سازی |
| `created_by` | `uuid` | null | سازنده |
| `scheduled_at` | `timestamptz` | null | تماس زمان‌دار |

`call_participants`:

| ستون | نوع | Default | توضیح |
| --- | --- | --- | --- |
| `muted` | `boolean` | `true` | وضعیت میکروفون |
| `can_self_unmute` | `boolean` | `true` | false = میوت اجباری |
| `video` | `boolean` | `false` | دوربین |
| `screen` | `boolean` | `false` | اشتراک صفحه |
| `hand_raised_at` | `timestamptz` | null | درخواست صحبت |
| `volume` | `integer` | `10000` | ۱..۲۰۰۰۰ |
| `source_id` | `bigint` | null | SSRC اتصال WebRTC |

### ۸.۸ جدول اختیاری `message_read_marks`

| ستون | نوع | قید |
| --- | --- | --- |
| `message_id` | `uuid` | fk → `messages(id)` cascade |
| `user_id` | `uuid` | fk → `users(id)` cascade |
| `read_at` | `timestamptz` | `now()` |

کلید `(message_id, user_id)`؛ ایندکس `(read_at)` برای پاک‌سازی دوره‌ای. **فقط** برای چت‌های با عضو کمتر از ۱۰۰ و با TTL هفت‌روزه نوشته شود؛ این دقیقاً رفتار تلگرام است.[[S7]](#s7)[[S6]](#s6)

### ۸.۹ نقشهٔ نگاشت مفاهیم

| تلگرام | HssNGram |
| --- | --- |
| `chat` / `channel(megagroup)` / `channel(broadcast)` | `chats.type = group / supergroup / channel` |
| `chatAdminRights` | `chat_members.rights` (jsonb) |
| `chatBannedRights` (پیش‌فرض) | `chats.default_rights` |
| `chatBannedRights` (تک‌کاربر) | `chat_members.restricted_rights` + `chat_bans` |
| `chatInviteExported` | `chat_invites` |
| `chatInviteImporter` | `chat_join_requests` |
| `channelAdminLogEvent` | `chat_admin_log` |
| `groupCall` + `groupCallParticipant` | `calls` + `call_participants` |
| `messageActionChatJoinedByRequest` | `messages.kind='system'`, `meta.action` |

---

## ۹) API

### ۹.۱ قواعد عمومی

- همهٔ مسیرها زیر `/api` و با `requireAuth` (موجود).
- گارد مجوز در یک تابع مرکزی: `requireRight(chatId, userId, flag, {type})` که سه سطح را چک می‌کند: عضویت → نقش/حق → محدودیت (`restricted_rights` با `restricted_until` منقضی‌شده نادیده گرفته شود).
- هر عمل مدیریتی یک رکورد در `chat_admin_log` و یک رویداد سوکت تولید می‌کند.
- پاسخ خطا: `{ error: { code, message, retryAfter? } }` با کدهای بند ۹.۴.

### ۹.۲ endpointهای مدیریت گروه

| متد | مسیر | بدنه | گارد | خروجی / رویداد |
| --- | --- | --- | --- | --- |
| `PATCH` | `/api/chats/:id/settings` | `{joinRequestEnabled?, slowmodeSeconds?, defaultRights?, historyForNewMembers?, signMessages?, membersHidden?}` | `right:change_info` (یا owner) | `chat:update` |
| `PUT` | `/api/chats/:id/username` | `{username}` | owner | `200 {username}` / `409 USERNAME_TAKEN` |
| `DELETE` | `/api/chats/:id/username` | — | owner | `204` |
| `POST` | `/api/chats/:id/convert` | `{target:'supergroup'\|'channel'}` | owner | `chat:update` + پیام سیستمی مهاجرت |
| `GET` | `/api/chats/:id/members` | query: `role, q, cursor, limit≤200` | عضو | فهرست + `restricted` |
| `PATCH` | `/api/chats/:id/members/:userId` | `{role?, rights?, rank?, anonymous?}` | owner یا `right:add_admins` با زیرمجموعه‌بودن | `member:updated` + لاگ |
| `POST` | `/api/chats/:id/restrictions` | `{userId, rights:{...}, until?}` | `right:ban_users` | `member:updated` |
| `DELETE` | `/api/chats/:id/members/:userId` | `{ban?:boolean, until?}` | `right:ban_users` (یا خودش = خروج) | `member:removed` + لاگ |
| `GET` | `/api/chats/:id/bans` | `cursor, limit` | `right:ban_users` | فهرست |
| `DELETE` | `/api/chats/:id/bans/:userId` | — | `right:ban_users` | `ban:removed` |
| `GET` | `/api/chats/:id/admin-log` | `before, limit≤100` | هر حق مدیر | `{entries[]}` |

### ۹.۳ endpointهای دعوت و join request

| متد | مسیر | بدنه | گارد | خروجی |
| --- | --- | --- | --- | --- |
| `POST` | `/api/chats/:id/invites` | `{requestNeeded?, expiresAt?, usageLimit?, title?}` | `right:invite_users` | `{token, url}` |
| `GET` | `/api/chats/:id/invites` | `?revoked=` | `right:invite_users` | فهرست + شمارنده |
| `PATCH` | `/api/chats/:id/invites/:inviteId` | `{revoked?, expiresAt?, usageLimit?, requestNeeded?, title?}` | `right:invite_users` | `invite:updated` |
| `DELETE` | `/api/chats/:id/invites/:inviteId` | — | owner | `204` |
| `GET` | `/api/chats/:id/invites/:inviteId/importers` | `?requested=` | `right:invite_users` | `{users[], count}` |
| `POST` | `/api/invites/:token/preview` | — | احراز هویت‌شده | `{chat, requestNeeded, alreadyMember, expiresAt}` |
| `POST` | `/api/invites/:token/join` | — | احراز هویت‌شده | `200 {chat}` / `202 {requestId}` |
| `GET` | `/api/chats/:id/join-requests` | `?status=pending` | `right:invite_users` یا `right:ban_users` | فهرست |
| `POST` | `/api/chats/:id/join-requests/:userId/approve` | — | `right:invite_users` | `200` + `member:joined` |
| `POST` | `/api/chats/:id/join-requests/:userId/dismiss` | — | `right:invite_users` | `204` |
| `POST` | `/api/chats/:id/join-requests/approve-all` | `{inviteId?}` | `right:invite_users` | `{approved:n}` |

### ۹.۴ endpointهای پیام، خواندن و تماس

| متد | مسیر | بدنه | گارد | نکته |
| --- | --- | --- | --- | --- |
| `POST` | `/api/chats/:id/messages` | (موجود) | `send_messages` + `send_plain`/`send_media` + slowmode | خطای `429 SLOWMODE_WAIT` با `retryAfter` |
| `PATCH` | `/api/messages/:id` | `{body}` | نویسنده + پنجرهٔ ویرایش | — |
| `DELETE` | `/api/messages/:id` | `{scope:'me'\|'all'}` | نویسنده یا `right:delete_messages` | `message:deleted` |
| `POST` | `/api/chats/:id/pin` | (موجود) | `right:pin_messages` | پین چندگانه |
| `GET` | `/api/messages/:id/readers` | — | نویسنده/مدیر + شرط ۱۰۰ عضو و ۷ روز | `MSG_TOO_OLD` / `CHAT_TOO_BIG` |
| `POST` | `/api/chats/:id/read` | (موجود) | عضو | `read` |
| `POST` | `/api/chats/:id/calls` | `{kind:'group_audio'\|'group_video', title?, joinMuted?, scheduledAt?}` | `right:manage_call` | `409 CALL_ACTIVE` اگر تماس فعال باشد |
| `GET` | `/api/calls/:id` | — | عضو | `{call, participants[], version}` |
| `POST` | `/api/calls/:id/join` | `{muted:true}` | عضو + سقف | `409 CALL_FULL` |
| `PATCH` | `/api/calls/:id/participants/:userId` | `{muted?, volume?, video?, screen?, handRaised?}` | خودش، یا `right:manage_call` برای دیگران | قاعدهٔ میوت اجباری |
| `POST` | `/api/calls/:id/presentation/start` | `{sdp}` | عضو | `call:presentation` |
| `POST` | `/api/calls/:id/presentation/stop` | — | همان عضو | — |
| `POST` | `/api/calls/:id/leave` | — | عضو | تماس برای بقیه ادامه دارد |
| `POST` | `/api/calls/:id/end` | — | `right:manage_call` یا سازنده | `call:ended` |

**کدهای خطا:**

| کد | معنا | مصرف‌کننده |
| --- | --- | --- |
| `403 RIGHT_REQUIRED` | حق لازم را ندارد | UI دکمه را مخفی کند، نه اینکه خطا نشان دهد |
| `403 TARGET_IS_ADMIN` | تلاش برای میوت/اخراج مدیر | تلگرام هم اجازه نمی‌دهد (میوت اجباری مدیر) |
| `403 BANNED` | مسدود | صفحهٔ «دسترسی ندارید» |
| `409 CALL_ACTIVE` | تماس فعال دیگر | پیشنهاد پیوستن به همان |
| `409 CALL_FULL` | سقف ۴ نفر | پیام صریح + لیست انتظار |
| `410 INVITE_*` | لینک باطل/منقضی/پر | پیام «لینک معتبر نیست» |
| `422 USERNAME_INVALID` | فرمت نامعتبر | راهنمای زندهٔ فیلد |
| `429 SLOWMODE_WAIT` | حالت آهسته | شمارش معکوس روی دکمهٔ ارسال |

### ۹.۵ رویدادهای سوکت

اتاق‌ها: `user:{userId}` (موجود)، `chat:{chatId}` (موجود)، `call:{callId}` (جدید).

**کلاینت → سرور**

| رویداد | payload | اعتبارسنجی |
| --- | --- | --- |
| `call:join` | `{callId, muted}` | عضویت + سقف + لاگ |
| `call:leave` | `{callId}` | — |
| `call:self` | `{callId, muted?, video?, handRaised?}` | فقط وضعیت خودش |
| `call:signal` | `{callId, to, data}` (موجود) | فقط اعضای همان تماس |
| `call:presentation:signal` | `{callId, to, data}` | فقط برای جریان اشتراک صفحه |
| `call:sync` | `{callId, version}` | اگر gap بود، وضعیت کامل |
| `call:end` | `{callId}` | `manage_call` |

**سرور → کلاینت**

| رویداد | payload | چه زمانی |
| --- | --- | --- |
| `call:state` | `{call, participants[], version}` | ورود، sync، پایان بازگشایی |
| `call:participant` | `{callId, userId, muted, canSelfUnmute, video, screen, handRaised, version}` | هر تغییر؛ کلاینت فقط `version = cached+1` را اعمال کند |
| `call:moderated` | `{callId, userId, by, muted, canSelfUnmute}` | میوت اجباری |
| `call:presentation` | `{callId, userId, active, source}` | شروع/پایان اشتراک |
| `call:ended` | `{callId, reason}` | پایان برای همه |
| `member:updated` | `{chatId, userId, role, rights, restrictedUntil}` | تغییر نقش/محدودیت |
| `member:removed` | `{chatId, userId, ban}` | اخراج/مسدود |
| `ban:removed` | `{chatId, userId}` | رفع مسدودی |
| `join-request:new` | `{chatId, userId, about}` | درخواست جدید |
| `invite:updated` | `{chatId, inviteId, revoked, uses}` | ابطال/مصرف |
| `message:deleted` | `{chatId, messageId, scope}` | حذف برای همه |
| `read:readers` | `{chatId, messageId, userIds[]}` | فقط با سیاست ۱۰۰/۷ روز |
| `admin-log:entry` | `{chatId, entry}` | هر اقدام مدیریتی |
| `chat:update` | (موجود) | تغییر تنظیمات چت/تماس فعال |

**قاعدهٔ نسخه‌بندی:** `calls.version` با هر تغییر افزایش می‌یابد. کلاینت اگر `version > cached+1` دید، تا ۱ ثانیه صبر می‌کند و بعد `call:sync` می‌زند — همان الگوریتم تلگرام.[[S4]](#s4)

---

## ۱۰) mesh یا SFU: مقایسه و توصیهٔ عملی برای سقف ۴ نفر

### ۱۰.۱ مقایسه

| معیار | mesh (P2P کامل) | SFU |
| --- | --- | --- |
| بارگذاری خروجی هر کلاینت | N−1 جریان | ۱ جریان |
| بار CPU رمزگذاری | N−1 انکود | ۱ انکود |
| تأخیر | کمترین (بدون واسط) | یک هاپ اضافه |
| هزینهٔ سرور | تقریباً صفر (فقط سیگنالینگ و TURN) | پهنای باند و CPU مدیا |
| مقیاس | ~۴–۶ نفر با صدا، ۳ نفر با ویدیو | صدها نفر |
| اشتراک صفحه | برای هر نفر یک انکود اضافه | یک جریان، multicast به بقیه |
| کیفیت تطبیقی | سخت (باید per-peer تنظیم شود) | سمت SFU با simulcast |
| ضبط | نیازمند کلاینت ضبط‌کننده | سمت سرور |
| زیرساخت | همان کانتینر فعلی + coturn | سرویس جدا + بازهٔ UDP + مانیتورینگ |
| شکست | یک peer ضعیف کل تماس را خراب می‌کند | peer ضعیف فقط خودش را |

### ۱۰.۲ حساب پهنای باند برای ۴ نفر (تخمین مهندسی، I)

| سناریو | بالا رو | پایین رو | جمع تقریبی |
| --- | --- | --- | --- |
| صدا فقط، Opus 48 kbps | ۳ × ۴۸ = ۱۴۴ kbps | ۱۴۴ kbps | ~۰٫۳ Mbps |
| صدا + دوربین ۳۶۰p@15، ۴۰۰ kbps | ۱٬۲۰۰ kbps | ۱٬۲۰۰ kbps | ~۲٫۴ Mbps |
| صدا + دوربین ۷۲۰p@30، ۱٬۵۰۰ kbps | ۴٬۵۰۰ kbps | ۴٬۵۰۰ kbps | ~۹ Mbps |
| صدا + اشتراک صفحه ۷۲۰p@8، ۸۰۰ kbps (همه دوربین خاموش) | ۸۰۰ kbps | ۲٬۴۰۰ kbps | ~۳٫۲ Mbps |

نتیجهٔ عملی: با آپلود متغیر ایران (اغلب ۱–۲ Mbps)، **۷۲۰p در mesh برای ۴ نفر جواب نمی‌دهد**؛ ۳۶۰p و اشتراک صفحهٔ کم‌نرخ جواب می‌دهد.

### ۱۰.۳ توصیه

| تعداد | ویدیو | اشتراک صفحه | تصمیم |
| --- | --- | --- | --- |
| ۲ | هر کیفیت | ✅ | mesh (وضع فعلی درست است) |
| ۳–۴ | خاموش/۳۶۰p | فقط یکی | mesh با قواعد بند ۱۰٫۴ |
| ۳–۴ | ۷۲۰p هم‌زمان | هم‌زمان | SFU، یا صرف‌نظر از ویدیو |
| ≥۵ | — | — | SFU الزامی؛ mesh جواب نمی‌دهد |

> **توصیهٔ نهایی برای این نسخه:** mesh بمان، ولی سقف ۴ نفر را **سمت سرور** اعمال کن، دوربین را در تماس ۳ نفره و بیشتر پیش‌فرض خاموش کن، اشتراک صفحه را تک‌نفره و با سقف نرخ ۶۰۰–۸۰۰ kbps بگذار، و مسیر مهاجرت به SFU را با همان مدل `calls.version` باز نگه دار. تلگرام خودش برای مخاطب بزرگ از WebRTC به «حالت استریم» سوییچ می‌کند — یعنی همان الگوی «SFU + fallback»، نه mesh.[[S4]](#s4)

### ۱۰.۴ قواعد اجرایی mesh برای ۴ نفر (D)

1. `join` پنجم با `409 CALL_FULL` رد شود؛ سقف در `env` با نام `MAX_GROUP_CALL_PARTICIPANTS=4`.
2. ورود با `muted=true` (مثل `join_muted` تلگرام).
3. Opus mono، ۴۸ kbps، `DTX` روشن، `echoCancellation` و `noiseSuppression` روشن.
4. دوربین: ۳۶۰p@15، سقف ۴۰۰ kbps، `degradationPreference='balanced'`.
5. اشتراک صفحه: فقط یک نفر، ۷۲۰p@8–12، `contentHint='detail'`، `degradationPreference='maintain-resolution'`، سقف ۸۰۰ kbps.
6. هنگام ضعف شبکه، ترتیب کاهش: اشتراک صفحه → دوربین → فقط صدا (هرگز صدا را قطع نکن).
7. TURN روی ۴۴۳/TLS برای عبور از فیلترینگ؛ بدون آن mesh در شبکهٔ سخت شکست می‌خورد.
8. `RTCPeerConnection` به‌ازای هر همتا با «perfect negotiation» و ICE restart؛ سیگنالینگ از همان `call:signal` موجود.

---

## ۱۱) ده قاعدهٔ رفتاری که نبودشان کاربر تلگرام را پس می‌زند

| # | قاعده | رفتار تلگرام | اگر نباشد کاربر چه می‌بیند | حداقل پیاده‌سازی |
| --- | --- | --- | --- | --- |
| ۱ | **حذف برای همه، واقعاً حذف باشد** | `revoke` پیام را برای همهٔ اعضا حذف می‌کند؛ کلاینت جای خالی/«حذف شد» نشان نمی‌دهد [[S13]](#s13) | «چرا هنوز در جستجو/نوتیف پیداست؟» | soft-delete + حذف از ایندکس جستجو و نوتیفیکیشن + پاک‌کردن فایل |
| ۲ | **تیک خواندن دروغ نگوید** | در گروه تیک per-message نیست؛ «چه کسی خواند» محدود به <۱۰۰ عضو و ۷ روز [[S7]](#s7) | «همه تیک خوردند ولی کسی جواب نداد» | فقط `last_read_seq`؛ فهرست خوانندگان با همان سیاست و TTL |
| ۳ | **مدیر بدون مجوز، مدیر نباشد** | حقوق بیت‌ماسکی؛ `delete_messages` ≠ `ban_users` [[S2]](#s2) | «این یکی می‌تواند پاک کند، آن یکی نه — چرا؟» | `rights jsonb` + گارد مرکزی، و مخفی‌کردن دکمه‌ها بر اساس همان گارد |
| ۴ | **لینک دعوت قابل کنترل باشد** | انقضا، سقف استفاده، تأیید مدیر، ابطال فوری [[S3]](#s3) | «لینک لو رفته و نمی‌توانم ببندمش» | `chat_invites` با `revoked_at` + بررسی در هر join |
| ۵ | **«محدود» و «مسدود» فرق کنند** | محدود می‌ماند و می‌خواند؛ مسدود دسترسی ندارد [[S10]](#s10) | «چرا نمی‌توانم بخوانم ولی هنوز در لیستم؟» | دو ستون جدا + متن توضیح متفاوت در UI |
| ۶ | **هر رویداد یک پیام سیستمی داشته باشد** | ورود، خروج، تغییر نقش، پین، شروع تماس همه در تاریخچه ثبت می‌شوند [[S1]](#s1)[[S3]](#s3) | «چه کسی این را حذف کرد؟» | `messages.kind='system'` با `meta.action` |
| ۷ | **پین برای همه، همان لحظه** | پین چندگانه و مشترک برای همهٔ اعضا [[S1]](#s1) | «پین کردم ولی فقط من می‌بینم» | `chats.pinned_message_id` + رویداد `chat:update` |
| ۸ | **حالت آهسته با شمارش معکوس** | یک پیام در هر N ثانیه؛ مدیر از آن معاف است [[S12]](#s12) | «دکمه کار نمی‌کند و نمی‌گوید چرا» | `slowmode_seconds` + `429` با `retryAfter` و تایمر روی کامپوزر |
| ۹ | **تماس گروهی: ورود بی‌صدا و نوبت صحبت** | `join_muted`، `raise_hand`، میوت اجباری با `can_self_unmute` [[S4]](#s4) | «همه با هم حرف می‌زنند / صداها باز است» | سه حالت میکروفون + صف درخواست صحبت + بنر «مدیر شما را میوت کرد» |
| ۱۰ | **شفافیت مدیریتی** | admin log برای ابرگروه و کانال [[S1]](#s1) | «کی من را بیرون کرد؟» | `chat_admin_log` + صفحهٔ «رویدادهای مدیریت» برای مدیران |

---

## ۱۲) حداقلِ همین نسخه (پیشنهاد قطع‌گذاری)

**بله، در این نسخه:** جداسازی `restricted` از `banned`؛ `rights` برای مدیر و گارد مرکزی؛ `chat_invites` با انقضا/سقف/ابطال؛ `request_needed` + صف تأیید؛ `chat_admin_log`؛ پیام سیستمی برای رویدادها؛ سقف سخت ۴ نفر در تماس + ورود بی‌صدا + میوت اجباری؛ اشتراک صفحهٔ تک‌نفره.

**بعداً:** یوزرنیم عمومی و صفحهٔ `t.me`-مانند؛ مهاجرت گروه پایه به ابرگروه؛ تاپیک فروم؛ مدیر ناشناس؛ حالت استریم/RTMP؛ آمار و استوری.

**هرگز در این محصول:** گروه بزرگ (gigagroup)، لینک دعوت پرداختی، یوزرنیم کلکسیونی، کنفرانس سرتاسر رمزنگاری‌شده.

---

## ۱۳) پرسش‌های باز

1. **SFU:** با سقف ۴ نفر، هزینهٔ راه‌اندازی mediasoup/LiveKit روی آروان (بازهٔ UDP، سرویس جدا) توجیه دارد یا نه؟ (D، نیاز به تصمیم مالک محصول)
2. **تاریخچه:** آیا عضو جدید باید تاریخچهٔ قبل از ورود را ببیند؟ تلگرام قابل تنظیم است؛ برای «پیام‌رسان خانواده» پیش‌فرض «بله» منطقی‌تر است.
3. **یوزرنیم:** دامنهٔ `hssngram.hssn.my.id` اجازهٔ `t.me/<username>`-مانند می‌دهد؟ اگر نه، فقط لینک دعوت کافی است.
4. **خوانندگان پیام:** پیش‌فرض روشن باشد یا خاموش؟ تلگرام پیش‌فرض روشن است ولی `hide_read_marks` دارد.[[S5]](#s5)
5. **پنجرهٔ حذف برای همه:** مقدار عددی `revoke_time_limit` در دسترس نیست (U)؛ پیشنهاد: ۴۸ ساعت برای عضو، بی‌نهایت برای مدیر با `delete_messages`.

---

## منابع

<a id="s1"></a>**S1.** Channels, supergroups, gigagroups and basic groups — <https://core.telegram.org/api/channel>
<a id="s2"></a>**S2.** Admin rights, banned rights, default rights — <https://core.telegram.org/api/rights>
<a id="s3"></a>**S3.** Invite links, join requests, direct invites — <https://core.telegram.org/api/invites>
<a id="s4"></a>**S4.** Group calls — <https://core.telegram.org/api/group-calls>
<a id="s5"></a>**S5.** Privacy settings and keys — <https://core.telegram.org/api/privacy>
<a id="s6"></a>**S6.** Client configuration defaults — <https://core.telegram.org/api/config>
<a id="s7"></a>**S7.** messages.getMessageReadParticipants — <https://core.telegram.org/method/messages.getMessageReadParticipants>
<a id="s8"></a>**S8.** account.checkUsername — <https://core.telegram.org/method/account.checkUsername>
<a id="s9"></a>**S9.** channels.checkUsername — <https://core.telegram.org/method/channels.checkUsername>
<a id="s10"></a>**S10.** chatBannedRights — <https://core.telegram.org/constructor/chatBannedRights>
<a id="s11"></a>**S11.** chatAdminRights — <https://core.telegram.org/constructor/chatAdminRights>
<a id="s12"></a>**S12.** channels.toggleSlowMode — <https://core.telegram.org/method/channels.toggleSlowMode>
<a id="s13"></a>**S13.** messages.deleteMessages — <https://core.telegram.org/method/messages.deleteMessages>
<a id="s14"></a>**S14.** Telegram FAQ — <https://telegram.org/faq>
<a id="s15"></a>**S15.** Group Video Calls (blog, 2021) — <https://telegram.org/blog/group-video-calls>
<a id="s16"></a>**S16.** Deep links (invite/username syntax) — <https://core.telegram.org/api/links>
