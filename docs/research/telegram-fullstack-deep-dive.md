# تلگرام از دید فول‌استک دولوپر — ۱۰۰ قابلیت با جزئیات فنی + دیت‌دایو معماری و مهندسی معکوس

> **سطح:** فول‌استک دولوپر | **هدف:** یادگیری عمیق | **ساختار:** دسته‌بندی موضوعی با جزئیات پیاده‌سازی
>
> این نسخه ارتقایافته سند قبلی است (آن فایل هم همچنان موجود است). هر قابلیت علاوه بر شرح، «چطور کار می‌کند» را با نام متدها/constructorهای MTProto، Bot API و جریان داده توضیح می‌دهد. بخش دوم معماری را با فرمول‌های واقعی باز می‌کند و بخش سوم یک پلی‌بوک عملی مهندسی معکوس است. همه‌چیز آموزشی است و فقط روی حساب و دستگاه خودت تمرکز دارد.

---

## بخش اول — ۱۰۰ قابلیت با جزئیات پیاده‌سازی

### الف) پیام‌رسانی و چت‌ها (۱–۱۴)

1. **قالب‌بندی غنی متن (Rich Text Entities)**
   پیام در MTProto یک `string` ساده است؛ قالب‌بندی با آرایه `Message.entities` از نوع‌هایی مثل `messageEntityBold`، `messageEntityItalic`، `messageEntityCode/Pre`، `messageEntitySpoiler` و `messageEntityCustomEmoji` تعریف می‌شود — هر entity یعنی `(offset, length, type)`. در Bot API همین ساختار با parse_mode سمت سرور تبدیل می‌شود.

2. **ویرایش پیام**
   متد `messages.editMessage` (Bot API: `editMessageText`). در چت خصوصی و گروه بدون محدودیت زمانی؛ در کانال سمت سرور تا ۴۸ ساعت. نسخه قبلی نگه‌داری نمی‌شود؛ پیام جایگزین و `updateEditMessage` به همه کلاینت‌های آنلاین پوش می‌شود.

3. **حذف از هر دو طرف (Revoke)**
   `messages.deleteMessages` با فلگ `revoke=true` — سرور پیام را از دیتابیس همه اعضا پاک می‌کند و فقط یک `updateDeleteMessages` با pts جدید برای سینک می‌فرستد. در کانال فقط ادمین و در گروه با مجوز `delete_messages`.

4. **Reply و ساختار reply_to**
   ریپل فقط یک ارجاع در `messageReplyHeader` است (`reply_to_msg_id`)، نه کپی متن. سرور مرجع را نگه می‌دارد؛ اگر پیام مرجع حذف شود، کلاینت با رفرنس dangling روبه‌رو می‌شود و خودش پیام خالی رندر می‌کند.

5. **نقل‌قول جزئی (Partial Quote)**
   در لایه‌های جدید `messageReplyHeader` فیلدهای `quote_text`، `quote_entities` و `quote_offset` دارد: ریپل با یک بازه انتخابی از پیام اصلی. سرور اسنپ‌شات نقل‌قول را نگه می‌دارد تا اگر متن مرجع ویرایش شد، معنای نقل‌قول حفظ شود.

6. **منشن / هشتگ / لینک به‌صورت entity**
   @user با `messageEntityMention`، هشتگ با `messageEntityHashtag` و لینک t.me با `messageEntityTextUrl`. کلاینت‌ها این رنج‌ها را روی UTF-16 محاسبه می‌کنند — در متن‌های فارسی و ایموجی‌دار، offset/length باید دقیق حساب شود وگرنه entity جابه‌جا می‌افتد.

7. **پین چند پیام**
   `messages.updatePinnedMessage` با فلگ‌های `pm_silent` (بدون اعلان پین) و `pm_oneside` (فقط برای خودت). لیست پیام‌های پین‌شده با state چت از سرور می‌آید و سقف تعداد را سرور اعمال می‌کند.

8. **پیام زمان‌بندی‌شده / Send when online**
   `messages.sendMessage` با فلگ `schedule_date` (timestamp آینده) — پیام در صف سرور ذخیره می‌شود و `messages.getScheduledMessages` لیستش را می‌دهد. گزینه «When online» یعنی سرور اول last seen مخاطب را چک می‌کند و بعد تزریق می‌کند.

9. **پیام بی‌صدا**
   فلگ `silent` در خود constructor ارسال — نه در تنظیمات نوتیفیکیشن. سرور آن را همراه پیام حمل می‌کند؛ کلاینت گیرنده اعلان نمی‌سازد ولی بج و شمارنده عادی می‌ماند.

10. **فوروارد و ردّ فوروارد**
    `messages.forwardMessages` پیام جدیدی با `messageFwdHeader` (from_id، date، post_author…) می‌سازد. فلگ `drop_author` امضای نویسنده را می‌شوید. اگر چت مبدا فلگ `noforwards` داشته باشد، سرور خودش فوروارد را رد می‌کند.

11. **Auto-Delete / TTL چت**
    `messages.setChatTTL` (۲۴ ساعت / ۷ روز / ۱ ماه) — سرور `ttl_period` را روی پیام‌های بعدی ست می‌کند؛ سرور و کلاینت هر دو تایمر پاک‌سازی را اجرا می‌کنند.

12. **Reactions**
    `messages.sendReaction` با `ReactionTypeEmoji` یا `ReactionTypeCustomEmoji` (documentId استیکر). نتیجه در `Message.reactions` با count و `recent_reactions`؛ سرور مدیریت تکراری‌ها را خودش انجام می‌دهد. Premium واکنش‌های بیشتر و paid reaction (با Stars) دارد.

13. **نظرات زیر پست کانال**
    کانال به یک «گروه بحث» لینک می‌شود (`channels.setDiscussionGroup`)؛ هر پست به‌صورت خودکار با `messageFwdHeader` در گروه بحث فوروارد می‌شود و ریپل‌های همان فوروارد، کامنت‌های پست‌اند. کلاینت با `linked_chat_id` بین دو پیر می‌پرد.

14. **Typing / Read state**
    `messages.setTyping` با اکشن‌هایی مثل `sendMessageTypingAction` و `sendMessageRecordVideoAction`؛ دریافت با `updateUserTyping` / `updateChatUserTyping` که فقط پوش می‌شوند و ذخیره نمی‌شوند. Read state با `messages.readHistory` و آپدیت‌های `updateReadHistoryInbox/Outbox` سینک می‌شود.

### ب) رسانه، فایل و ابر (۱۵–۲۶)

15. **فضای ابری و سینک چنددستگاهی**
    همه پیام‌ها روی سرور (DC حساب) می‌مانند؛ کلاینت با `messages.getHistory` (پارامترهای `offset_id`، `max_id`، `limit`) صفحه‌بندی می‌کند و با آپدیت‌ها سینک. دستگاه جدید فقط state (pts/qts) و تاریخچه را به‌مرور می‌گیرد.

16. **آپلود فایل‌های بزرگ**
    `upload.saveFilePart` برای فایل‌های کوچک و `upload.saveBigFilePart` برای بزرگ‌ها؛ پارت‌ها تا ۵۱۲ کیلوبایت و آپلود موازی روی چند اتصال. در پارت آخر checksum قابل ست است. سقف حجم = ۲ گیگ (۴ گیگ با Premium) و enforcement سمت سرور است.

17. **استریم ویدیو/صدا**
    استریم یعنی زنجیره‌ای از `upload.getFile` با `offset/limit` (هر درخواست حداکثر حدود ۱ مگابایت). ویدیوی قابل‌استریم با فلگ `supports_streaming` در `documentAttributeVideo` و MP4 با moov atom قبل از mdat.

18. **ارسال بدون افت کیفیت (Send as File)**
    ارسال با `InputMediaDocument` — سرور هیچ re-encode انجام نمی‌دهد؛ filename در `documentAttributeFilename` و MIME از attributes گرفته می‌شود.

19. **آلبوم رسانه‌ای**
    `messages.sendMultiMedia` با آرایه InputMedia (تا ۱۰ آیتم)؛ سرور به همه پیام‌های آلبوم یک `Message.grouped_id` یکسان می‌دهد. آلبوم واقعاً چند پیام مجزاست — پس هر رسانه ریپل/واکنش مستقل دارد.

20. **فشرده‌سازی عکس/ویدیو**
    کاملاً سمت کلاینت: عکس به چند `PhotoSize` (ابعاد مختلف) + `photoStrippedSize` (thumbnail فشرده) encode می‌شود؛ ویدیو قبل از آپلود ترنسکود سخت‌افزاری می‌شود. سرور هیچ پردازش تصویری ندارد.

21. **استیکرهای انیمیشنی**
    TGS = Lottie JSON با gzip — رندر با rlottie سمت کلاینت، سرور هیچ رندری انجام نمی‌دهد. ویدیواستیکر = WebM با VP9، بدون صدا، حداکثر ~۳ ثانیه. ساخت پک با متدهای `messages.*Sticker*` (مثل `messages.addStickerToSet`).

22. **Custom Emoji**
    همان documentهای استیکر که داخل متن با `messageEntityCustomEmoji` (documentId) استفاده می‌شوند. استفاده همه‌جا ویژه Premium است؛ enforcement سمت سرور.

23. **جستجوی رسانه**
    `messages.search` با فیلترهای `InputMessagesFilterPhotos / Video / Music / Documents / Url` و… — جستجو سمت سرور روی متادیتای پیام‌های آن پیر انجام می‌شود و خروجی لیست message id برای صفحه‌بندی است.

24. **کش و حافظه محلی**
    کلاینت‌ها LRU cache با سقف قابل تنظیم دارند؛ کلید فایل‌ها volume_id/local_id (عکس) یا document id است. پاکسازی خودکار بر اساس عمر کش، سمت کلاینت.

25. **ویرایش سریع رسانه**
    کراپ/چرخش/تریم کاملاً قبل از آپلود سمت کلاینت انجام می‌شود — سرور هیچ ویرایشی ارائه نمی‌دهد؛ به همین دلیل خروجی با فایل اصلی تفاوت بایت‌به‌بایت دارد.

26. **تب‌های رسانه چت**
    همان جستجوی سرور (بند ۲۳) روی پیر مشخص + استخراج لینک‌ها از entityهای URL که سمت سرور موقع ایندکس انجام می‌شود.

### ج) کانال‌ها، گروه‌ها و مدیریت (۲۷–۴۰)

27. **گروه → سوپرگروه (migrate)**
    گروه معمولی سقف ~۲۰۰ عضو دارد؛ `messages.migrateChat` آن را به `channel` با فلگ megagroup تبدیل می‌کند و chat id عوض می‌شود (برای ربات‌ها با پیشوند -100). سوپرگروه تا ۲۰۰ هزار عضو.

28. **کانال broadcast**
    `channel` با فلگ broadcast؛ پیام‌ها به‌صورت یک‌طرفه به اعضا توزیع می‌شوند. توزیع فیزیکی (fan-out) کار سرور است و کلاینت فقط آپدیت می‌گیرد.

29. **حقوق ادمین (ChatAdminRights)**
    struct فلگ‌محور: `post_messages`، `edit_messages`، `delete_messages`، `ban_users`، `restrict_members`، `pin_messages`، `promote_admins`، `invite_users`، `change_info`، `add_admins`، `anonymous`، `manage_call`، `manage_topics` و… هر مجوز یک بیت است و با `channels.editAdmin` اعمال می‌شود.

30. **محدودسازی عضو (ChatBannedRights)**
    ban و mute با همان struct: `view_messages=false` یعنی بن کامل، `send_messages=false` یعنی readonly، `send_media/embedded_links` محدودتر… با `until_date=0` مادام‌العمر است؛ سرور در لحظه ارسال، بیت‌ها را چک و رد می‌کند.

31. **لینک دعوت هوشمند**
    `messages.exportChatInvite` با فلگ‌های `expire_date` / `usage_limit` / `request_needed`. تایید عضویت با `messages.hideChatJoinRequest` (approve/deny). هر لینک hash منحصربه‌فرد دارد و آمار usage سمت سرور نگه‌داری می‌شود.

32. **Aggressive anti-spam**
    حالت اختیاری سوپرگروه: پیام اعضایی که تازگی عضویت‌شان زیر آستانه است فقط به ادمین‌ها می‌رسد تا تایید/حذف شود؛ هدف خشکاندن broadcast اسپم از داخل گروه‌های بزرگ.

33. **Slow mode**
    فیلد `slowmode_seconds` در megagroup full؛ نقض آن با خطای `SLOWMODE_X` (همان خانواده rate limit) جواب می‌دهد. ادمین‌ها معاف‌اند.

34. **نظرسنجی و کوییز**
    `inputMediaPoll` → `messageMediaPoll` با فلگ‌های `anonymous` / `multiple_choice` / `quiz` / `close_date`. نتایج با آپدیت‌های pollResults می‌آیند و برای poll ناشناس، لیست رأی‌دهندگان اصلاً وجود ندارد.

35. **پست زمان‌بندی‌شده کانال**
    همان `schedule_date` در ارسال؛ لیست با `messages.getScheduledMessages`؛ تا لحظه انتشار قابل ویرایش/حذف است.

36. **گزارش مدیریتی (Recent Actions)**
    `channels.getAdminLog` با فیلتر نوع رخداد (ban، delete، edit، invite و…) — فقط حدود ۴۸ ساعت اخیر روی سرور نگه‌داری می‌شود و فقط برای ادمین‌ها.

37. **Stats API**
    `stats.getBroadcastStats` / `stats.getMegagroupStats` — سری‌های زمانی رشد، منبع عضو و نمودارهای آماده؛ داده سمت سرور تجمیع شده و در دسترس ادمین‌های کانال/گروه بزرگ است.

38. **Boost**
    سرویس سطح‌بندی‌شده: boost با انرژی کاربران Premium به کانال/گروه می‌خورد و سطح بالاتر = سهمیه استوری، والپیپر اختصاصی، آیکون و پک ایموجی. وضعیت با متدهای namespace boosts در لایه‌های جدید.

39. **اشتراک پولی کانال**
    پست‌های `inputMediaPaidMedia` (قیمت‌گذاری با Stars) و اشتراک‌های دوره‌ای کانال؛ تسویه سمت سرور انجام می‌شود و ربات/کانال فقط رویداد می‌گیرد.

40. **دیپ‌لینک‌ها**
    t.me/username (resolve عمومی)، t.me/c/<internal_id>/<msg_id> (پیام در گروه خصوصی؛ internal id بدون -100)، t.me/bot?start=payload (پایلود برای ربات). رزولوشن با `contacts.resolveUsername`.

### د) ربات‌ها، مینی‌اپ‌ها و پرداخت (۴۱–۵۰)

41. **Bot API = REST wrapper روی MTProto**
    `https://api.telegram.org/bot<token>/<Method>` با JSON. توکن = `<bot_id>:<secret>`. ربات در هسته یک کاربر با فلگ bot است؛ Bot API همان RPCهای MTProto را از سمت خود تلگرام می‌زند و به تو JSON می‌دهد.

42. **Inline bots**
    کاربر `@bot query` می‌زند → سرور query را به ربات می‌رساند → ربات با `answerInlineQuery` آرتیکل‌ها را برمی‌گرداند → انتخاب کاربر به پیام با fwd از inline bot تبدیل می‌شود. فلگ inline_mode هم در BotFather فعال می‌شود.

43. **Inline Keyboard و Callback**
    `InlineKeyboardMarkup` با `callback_data` حداکثر ۶۴ بایت؛ کلیک → `callback_query` به ربات → `answerCallbackQuery` برای ack/آلرت. داده بزرگ‌تر باید در دیتابیس خود ربات با شناسه کوتاه ذخیره شود.

44. **Mini Apps (Web App)**
    وب‌اپ داخل webview تلگرام با SDK جاوااسکریپت (`window.Telegram.WebApp`). اعتبارنامه با `initData`: رشته فیلدهای مرتب‌شده (data-check-string) و hash = HMAC-SHA256 با کلید مشتق‌شده از bot_token — بک‌اند فقط با توکن خودش verify می‌کند، بدون هیچ تماسی با تلگرام.

45. **پرداخت و Invoice**
    `sendInvoice` → پیام فاکتور → کاربر پرداخت → `pre_checkout_query` (باید بک‌اند ربات تایید کند) → `successful_payment`. کالاهای دیجیتال با currency=XTR (Stars) و کالای فیزیکی با درگاه فیات.

46. **Login Widget**
    ویجت جاوااسکریپت روی سایت؛ callback شامل آبجکت user + `auth_date` + `hash`. اعتبارسنجی سمت سرور: secret = SHA256(bot_token) و hash = HMAC-SHA256(data-check-string, secret). ورود بدون پسورد، فقط هویت تلگرام.

47. **Webhook و Long Polling**
    `setWebhook` (URL باید TLS باشد روی پورت‌های 443/80/88/8443؛ header امنیتی `X-Telegram-Bot-Api-Secret-Token`) یا `getUpdates` با offset (long poll). فقط یکی فعال است؛ `deleteWebhook` برای برگشت به polling.

48. **دستورات و scope ربات**
    `setMyCommands` با `BotCommandScope` (default، all_private_chats، all_group_chats، all_chat_administrators، chat، chat_administrators، chat_member) — یعنی منوی دستورات per-chat قابل شخصی‌سازی است.

49. **سیستم file_id ربات‌ها**
    هر فایلی که ربات می‌بیند یک file_id می‌گیرد و بدون دانلود مجدد بازارسال می‌شود؛ ولی دانلود مستقیم با Bot API (`getFile`) تا ۲۰MB — بالاتر باید سرور Bot API خودمیزبان یا کلاینت MTProto داشته باشی.

50. **اقتصاد Stars و هدایا**
    موجودی Stars، refund با `refundStarPayment`، گیفتی‌های قابل کلکسیون/ارتقا و هدیه Premium — همه تراکنش‌ها سمت سرور تسویه می‌شوند و ربات فقط رویداد دریافت می‌کند.

### هـ) حریم خصوصی و امنیت (۵۱–۶۲)

51. **رمزنگاری cloud chats**
    لینک کلاینت↔سرور با AES-256-IGE رمز است (msg_key از SHA256 مشتق می‌شود) — ولی سرور محتوا را می‌فهمد و plaintext را در دیتابیسش نگه می‌دارد، برای سینک چنددستگاهی و جستجو. این تصمیم محصولی و مستند است.

52. **Secret Chat (E2E واقعی)**
    `messages.requestEncryption` → `updateEncryption` → `messages.acceptEncryption` با key_fingerprint؛ کلید از DH بین دو کلاینت ساخته می‌شود و هش آن به شکل ۴ ایموجی برای هر دو طرف نمایش داده می‌شود (تشخیص MITM). پیام‌ها با کلید مشتق از DH رمز می‌شوند؛ سرور فقط ciphertext می‌بیند.

53. **Cloud Password با SRP**
    سرور فقط (salt1, salt2, g, p, verifier) نگه می‌دارد؛ KDF سفارشی با ده‌ها هزار تکرار SHA256 روی پسورد+saltها می‌کوبد. در لاگین، اثبات SRP انجام می‌شود و سرور هیچ‌وقت پسورد/x را نمی‌بیند — brute-force سمت سرور با پارامترهای فعلی عملاً بی‌فایده است.

54. **رمز محلی اپ و قفل چت**
    Passcode کلاینت با KDF مبتنی بر SHA512 به کلید محلی تبدیل و دیتای حساس (نشست/دیتابیس) با آن رمز می‌شود؛ قفل چت‌های خاص با بیومتریک روی کلاینت. سرور بی‌اطلاع است.

55. **Privacy rules**
    `account.setPrivacy` با `InputPrivacyKey` (statusTimestamp، profilePhoto، phoneCall، phoneP2P، forwards، phoneNumber و…) و `InputPrivacyRule` (AllowAll/AllowContacts/AllowUsers/DisallowUsers). اعمال قواعد سمت سرور است — یعنی کلاینت‌های دیگر هم نمی‌توانند دورش بزنند.

56. **نمای پروفایل**
    همان مکانیزم privacy روی `userFull`: اگر `profilePhoto` مخفی باشد، resolve‌کننده به‌جای عکس واقعی یک عکس جهانی placeholder می‌گیرد.

57. **پنهان‌سازی شماره**
    برای غیرمخاطبین، `users.getUsers` فیلد phone_number را خالی برمی‌گرداند اگر rule اجازه ندهد؛ پیدا کردن با شماره هم از مسیر `contacts.importContacts` تحت همان قواعد فیلتر می‌شود.

58. **noforwards**
    فلگ روی پیر/چت؛ سرور forward/copy/save را رد می‌کند و کلاینت‌ها UI را غیرفعال می‌کنند. چون enforcement سمت سرور است از مسیر API دورزدنی ندارد — البته اسکرین‌شات فیزیکی همیشه ممکن است.

59. **TTL در Secret Chat**
    تایمر عمدتاً سمت کلاینت اجرا می‌شود (سرور ciphertext را نمی‌فهمد) و حتی محتوای داخل نوتیفیکیشن هم پاک می‌شود؛ تصویر عکس/ویدیوی استوری‌وار secret هم از cache خارج می‌شود.

60. **حذف خودکار حساب**
    `account.setAccountTTL` (گزینه‌های ۱ تا ۱۲ ماه)؛ هر لاگین تایمر را reset می‌کند و سرور خودش حساب را حذف می‌کند — بدون نیاز به هیچ کلاینتی.

61. **مدیریت نشست‌ها**
    `account.getAuthorizations` (لیست دستگاه‌ها با IP/پلتفرم/تاریخ) و `account.resetAuthorization` (خاتمه از راه دور). هر نشست = یک auth_key مستقل per DC.

62. **هشدار ورود و تحویل کد**
    `auth.sendCode` کد را می‌سازد؛ وقتی دستگاه معتبری آنلاین است، کد اول داخل خود تلگرام تحویل می‌شود و بعد SMS. لاگین از دستگاه ناشناس اعلان امنیتی برای کاربر می‌سازد.

### و) تماس صوتی و تصویری (۶۳–۷۰)

63. **تماس E2E**
    سیگنالینگ با `phone.requestCall` / `phone.acceptCall` روی MTProto؛ مدیا با libwebrtc روی UDP با DTLS-SRTP. تنظیمات شبکه (سرورهای ICE/TURN) با `phone.getCallConfig` از سرور می‌آید.

64. **گروه‌کال**
    `phone.createGroupCall` / `phone.joinGroupCall` با ssrcهای WebRTC؛ صدا به رله سرور می‌رود و توزیع می‌شود؛ شنونده نامحدود و گوینده فعال با سهمیه slot محدود.

65. **پخش زنده + RTMP**
    گروه‌کال با حالت broadcast (یک‌طرفه)؛ ورود خارجی با RTMP URL/Key (namespace phone) تا از OBS و ابزارهای مشابه پخش شود.

66. **اشتراک صفحه**
    ترک screen با WebRTC در تماس خصوصی و گروه‌کال؛ کیفیت با RTCP تطبیقی تنظیم می‌شود.

67. **لغو نویز و بیت‌ریت تطبیقی**
    AEC/NS کتابخانه webrtc سمت کلاینت؛ بیت‌ریت بر اساس packet loss/RTT تنظیم می‌شود — سرور نقشی در پردازش صدا ندارد.

68. **لینک دعوت ویدیوچت**
    `phone.exportGroupCallInvite` → لینک t.me؛ مهمان بدون عضویت قبلی گروه join می‌شود (میزبان تایید می‌کند).

69. **جلوه‌های ویدیو**
    Blur پس‌زمینه و فیلترها سمت کلاینت روی فریم‌ها قبل از encode — سرور اطلاعی از اعمال‌شدن آن‌ها ندارد.

70. **ارتقای تماس به گروه‌کال**
    `phone.inviteToGroupCall`؛ تماس دو نفره به اتاق گروهی تبدیل و بقیه اعضا دعوت می‌شوند.

### ز) استوری و پروفایل (۷۱–۷۷)

71. **stories.sendStory**
    با `InputPrivacyRule` (همان سیستم privacy چت‌ها) + expiry حدود ۲۴ ساعت؛ مدیا همان InputMedia معمولی است و اشتراک‌گذاری استوری دیگران با `inputMediaStory`.

72. **ریپل استوری**
    پیام معمولی در چت خصوصی با `reply_to` حاوی `story_id` و `story_peer` — یعنی «پاسخ به استوری» یک نوع پیام جدید نیست، فقط یک مرجع است.

73. **لیست بیننده‌ها**
    `stories.getStoryViews` — بیننده‌ها + واکنش‌ها؛ فقط برای مالک استوری و از مسیر سرور.

74. **استوری دائمی پروفایل**
    پین استوری روی پروفایل (ویژه Premium) — سرور استوری را از چرخه ۲۴ ساعته خارج و در بخش saved پروفایل نگه می‌دارد.

75. **استوری کانال**
    همان namespace stories ولی با پیر کانال؛ دسترسی با سطح Boost کافی باز می‌شود.

76. **آواتار ویدیویی**
    `photo` با فیلد `video_sizes` — کلاینت اولین فریم را thumbnail می‌گذارد و ویدیوی کوتاه را روی هاور/تپ پخش می‌کند.

77. **Usernames متعدد**
    لیست `Username`های اضافی روی پروفایل؛ resolve همه را با `contacts.resolveUsername` پشتیبانی می‌کند. collectibleها مالکیت‌شان روی Fragment (سرویس جدا) است.

### ح) رابط کاربری و سفارشی‌سازی (۷۸–۸۵)

78. **تم‌ها**
    فرمت per-platform (.attheme در اندروید، theme bundle در دسکتاپ)؛ رنگ‌ها key/value و فایل تم یک document معمولی است که مثل هر فایلی اشتراک می‌شود.

79. **والپیپرها**
    `account.getWallPapers` → `WallPaper` با پترن + رنگ‌ها + intensity؛ والپیپر سفارشی چت هم با همان struct بین دو طرف سینک می‌شود.

80. **پوشه‌های چت**
    `ChatFolder` با فلگ‌های include/exclude/pinned؛ اشتراک‌گذاری پوشه با لینک از طریق namespace chatlists (مثل `chatlists.exportChatlistInvite`).

81. **آرشیو**
    `folders.editPeerFolders` با `InputFolderPeer` — یعنی آرشیو سمت سرور سینک می‌شود، نه فقط یک state محلی.

82. **Saved Messages**
    پیر «خودت» (inputPeerSelf)؛ فوروارد به آن یعنی پیام در چت خصوصی خودت ذخیره می‌شود — ساده‌ترین bookmark با همان زیرساخت پیام.

83. **ترجمه درون‌برنامه‌ای**
    در برخی کلاینت‌ها با سرویس ترجمه سمت تلگرام و در بقیه با provider سمت کلاینت؛ متن پیام به سرور ترجمه می‌رود (نکته حریم خصوصی: برای cloud chats که سرور از قبل متن را دارد، تفاوتی ایجاد نمی‌کند).

84. **تبدیل پیام صوتی به متن**
    `messages.transcribeAudio` (Premium) — تبدیل سمت سرور انجام می‌شود و کلاینت فقط متن نهایی را می‌گیرد.

85. **جستجوی سراسری**
    `messages.searchGlobal` برای همه پیرها + فیلتر نوع/تاریخ؛ پرش به پیام با جفت (peer, msg_id) انجام می‌شود.

### ط) بهره‌وری، حساب و مدیریت (۸۶–۹۳)

86. **چند حساب هم‌زمان**
    هر حساب auth_key و DC مستقل دارد؛ اپ موبایل چند نشست را در یک کلاینت مدیریت می‌کند و سوییچ حساب یعنی سوییچ session — نه لاگین مجدد.

87. **Premium**
    همه محدودیت‌ها سمت سرور اعمال می‌شوند: سقف آپلود ۴ گیگ، اولویت دانلود در CDN، واکنش‌های بیشتر، بج و امکانات اضافه. کلاینت فقط UI را قفل/باز می‌کند؛ دورزدن با کلاینت مهندسی‌شده ممکن نیست.

88. **Business**
    namespace `account.updateBusiness*` (ساعات کاری، مکان، quick replies، پیام خوش‌آمد/غیبت) — سریع‌ترین پاسخ‌ها به‌صورت shortcut بین حساب business و مخاطب جابه‌جا می‌شوند.

89. **Export داده**
    اپ دسکتاپ با صفحه‌بندی getHistory/getMessages کل تاریخچه را به HTML/JSON می‌ریزد — این یعنی «خروجی کامل داده» بدون هیچ API خارجی دیگر.

90. **اعلان per-chat (PeerNotifySettings)**
    `account.updateNotifySettings` per-peer با mute_until، sound و show_previews؛ سرور نگه می‌دارد → سینک بین دستگاه‌ها. اعلان پیش‌فرض با `account.updateDeviceSettings`? (تنظیم per-device سمت کلاینت).

91. **ورود با QR**
    `auth.exportLoginToken` روی دستگاه مقصد → QR؛ دستگاه مبدأ با `auth.acceptLoginToken` تایید می‌کند → نشست جدید بدون کد SMS ساخته می‌شود.

92. **سرویس‌های رسمی داخلی**
    @BotFather (ساخت/تنظیم ربات)، @Stickers (مدیریت پک‌ها)، @SpamBot (گزارش محدودیت‌ها) — همه ربات‌های عادی روی Bot API هستند؛ تلگرام خودش هم مشتری خودش است.

93. **خاتمه همه نشست‌ها**
    `account.resetAuthorization` (به‌جز نشست فعلی) — auth_keyهای قدیمی باطل می‌شوند و RPCهای بعدی با `SESSION_REVOKED` جواب می‌گیرند.

### ی) API و توسعه (۹۴–۱۰۰)

94. **api_id / api_hash**
    هر اپ شخصی یک جفت اعتبار از my.telegram.org می‌گیرد؛ در `initConnection` ارسال می‌شود و سرور رفتار (مثل سقف‌ها) را per-app تنظیم می‌کند. بدون آن هیچ کلاینت MTProtoای کار نمی‌کند.

95. **TDLib**
    کتابخانه C++ رسمی با API JSON (`td_api.tl`) — auth، updates، فایل‌ها و secret chats را کامل مدیریت می‌کند. برای فول‌استک راحت‌ترین راه ساخت کلاینت سفارشی: همه رویدادها با یک callback JSON می‌آیند.

96. **سرور Bot API خودمیزبان**
    repo رسمی telegram-bot-api؛ اجرای اختصاصی یعنی سقف فایل بالاتر و لاگ کامل — ابزار عالی برای دیدن contract سرور بدون دی‌کامپایل.

97. **کتابخانه‌های جامعه**
    Telethon/Pyrogram (پایتون)، GramJS (Node)، mtcute (TypeScript)، MadelineProto (PHP) — همه MTProto خام را پیاده‌سازی کرده‌اند؛ سورس‌شان بهترین نمونه‌کد پروتکل است.

98. **MTProto Proxy**
    پروکسی مخصوص پروتکل: کلاینت با secret (16 بایت، hex با پیشوند ee) وصل می‌شود؛ کلید obfuscation لایه transport از SHA256(header + secret) مشتق می‌شود و حالت fake-TLS با padding شبیه ClientHello دارد. مقصد واقعی از دید پروکسی مخفی می‌ماند.

99. **کلاینت‌های اوپن‌سورس**
    tdesktop (C++/Qt)، Telegram-Android (Java/Kotlin)، Telegram-iOS (Swift + submodules)، Web-K (Kotlin/JS) و Web-A (TypeScript) و Telegram X — همه GPL؛ بهترین «کد مرجع» برای معکوس‌کاری.

100. **شمای TL عمومی**
    core.telegram.org/schema + JSON layered schema + فایل api.tl در repoها؛ هر قابلیت جدید = constructor جدید + bump لایه؛ diff بین دو لایه یعنی نقشه راه قابلیت‌ها.

---

## بخش دوم — معماری در عمق (سطح فول‌استک)

### ۱. لایه ترنسپورت: چه فرمتی روی سیم می‌رود؟

سه فرمت پایه روی TCP (به‌علاوه HTTP و WebSocket و UDP):
- **Abridged (tag 0xEF):** طول تقسیم بر ۴ در یک بایت (payload تا ~۵۰۸ بایت) یا `0x7F` + سه بایت LE برای بزرگ‌ترها.
- **Intermediate (tag 0xEE):** چهار بایت LE طول + payload؛ بدون seq و CRC.
- **Full:** چهار بایت seq + چهار بایت طول + payload + CRC32.

**Obfuscated transport** روی همه‌ی این‌ها سوار می‌شود؛ هدر ۶۴ بایتی:
- بایت‌های ۰–۵۵ تصادفی‌اند؛ فقط قید: چهار بایت اول نباید 0xEF یا فعل HTTP باشد (تا با ترنسپورت غیر obfuscated اشتباه گرفته نشود).
- بایت‌های ۵۶ به بعد، tag ترنسپورت واقعی و شماره DC را حمل می‌کنند.
- کلید AES-256-CTR از بایت‌های ۸–۳۹ و IV از بایت‌های ۴۰–۵۵ همان هدر گرفته می‌شود و استریم از بایت ۵۶ به بعد رمز می‌شود؛ در جهت سرور→کلاینت همان کلید به‌صورت byte-reversed استفاده می‌شود.
- این لایه فقط ضد-DPI است؛ بعد از برداشتنش، رمز اصلی MTProto سر جایش است.

### ۲. رمزنگاری MTProto 2.0 — فرمول‌های واقعی

پکت رمز‌شده = `auth_key_id(8B) + msg_key(16B) + AES-IGE(plaintext)`:

- `auth_key_id = SHA1(auth_key)[0:8]` — راه سریع پیدا کردن auth_key مربوطه در سمت سرور.
- `x = 0` برای کلاینت→سرور و `x = 8` برای جهت برعکس.
- `msg_key = SHA256(auth_key[88+x : 88+x+32] + plaintext)[8:24]`
- مشتق کلید و IV (مطابق مستندات رسمی):

```
sha1_a = SHA1(msg_key + auth_key[x : x+32])
sha1_b = SHA1(auth_key[32+x : 48+x] + msg_key + auth_key[48+x : 64+x])
sha1_c = SHA1(auth_key[64+x : 96+x] + msg_key)
sha1_d = SHA1(msg_key + auth_key[96+x : 128+x])
aes_key = sha1_a[0:8]  + sha1_b[8:20]  + sha1_c[4:16]                     # 32 بایت
aes_iv  = sha1_b[0:8]  + sha1_c[16:20] + sha1_d[0:8]  + sha1_a[8:20]     # 32 بایت
```

- plaintext باید مضرب ۱۶ بایت باشد؛ حداقل ~۱۲ بایت padding تصادفی توصیه‌شده است.
- نکته معماری: IGE حالت استانداردی نیست و انتقادهای امنیتی داشته است؛ تلگرام با گره‌زدن msg_key به متن تا حدی مقاوم‌سازی می‌کند. Secret chats اهمیت این بحث را کلاً دور می‌زنند (E2E).

### ۳. قاب پیام plaintext

```
server_salt(8) | session_id(8) | msg_id(8) | seq_no(4) | length(4) | body | padding
```

- `msg_id = unix_time << 32 + counter`؛ برای کلاینت فرد و برای سرور زوج؛ باید یکتا و صعودی باشد.
- `seq_no = 2 × (تعداد پیام‌های content-related قبلی) + (۱ اگر همین پیام content-related است)`.
- content-related یعنی RPC واقعی؛ ack/pong/container نیستند.
- سرویس‌پیام‌هایی که هر کلاینت باید بفهمد: `msg_container#73f1f8dc` (چند پیام در یک پکت)، `msgs_ack#62d6b459`، `pong#347773c5`، `new_session_created#9ec20908`، `bad_server_salt#edab447b`، `rpc_result#f35c6d01`، `rpc_error#2144ca19`.
- برای `bad_msg` و `bad_server_salt` باید state machine retry کامل داشته باشی — جزئیاتی که کتابخانه‌های جدی، سال‌ها صرف پخته‌کردنش کردند.

### ۴. TL در عمل

- انواع پایه: int/long به‌صورت little-endian؛ string: اگر ≤۲۵۳ بایت، یک بایت طول؛ وگرنه `0xFE` + سه بایت؛ در هر دو حالت padding به مضرب ۴.
- vector: constructor `1cb5c415` + تعداد + عناصر.
- هر constructor = CRC32 از امضایش در شِما؛ نوع‌های boxed constructor را حمل می‌کنند و bareها نه.
- RPC واقعی: `invokeWithLayer(layer)` + `initConnection(api_id, device_model, system_version, app_version, lang_pack, lang_code, …)` + متد اصلی.
- خطاها با `rpc_error` کد ۴۰۰ و رشته‌هایی مثل `PHONE_NUMBER_INVALID`، `FLOOD_WAIT_X`، `SLOWMODE_X` می‌آیند — بخش بزرگی از معکوس‌کردن رفتار سرور، خواندن همین رشته‌های خطاست.

پکینگ string به زبان پایتون:

```python
def pack_str(b: bytes) -> bytes:
    out = bytes([len(b)]) + b if len(b) < 254 else b'\xfe' + len(b).to_bytes(3, 'little') + b
    return out + b'\x00' * ((-len(out)) % 4)
```

### ۵. جریان احراز هویت — قدم‌به‌قدم

1. `req_pq` → `resPQ(pq, server_nonce, server_public_key_fingerprints)`.
2. کلاینت باید **pq را factor کند** (عدد ۶۴ بیتی) — عمداً سمت کلاینت، تا replay و MITM گران شود.
3. `pq_inner_data` با RSA سرور رمز و ارسال می‌شود → `server_DH_params_ok`.
4. تبادل DH کامل می‌شود → **auth_key**؛ تأیید با `dh_gen_ok`.
5. از این‌جا همه RPCها با همان auth_key + server_salt + session_id رمز و شماره‌گذاری می‌شوند.

### ۶. SRP (Cloud Password)

سرور فقط (salt1, salt2, g, p, verifier) را نگه می‌دارد. KDF سفارشی: پسورد با saltها در ده‌ها هزار تکرار SHA256 می‌کوبید تا x ساخته شود و verifier = g^x mod p. در لاگین، اثبات SRP انجام می‌شود؛ سرور هیچ‌وقت پسورد/x را نمی‌بیند و brute-force با پارامترهای فعلی عملاً بی‌فایده است.

### ۷. Updates state machine — قلب سینک

- per-account: `pts` (پیام‌ها)، `qts` (رویدادهای مخفی)، `date/seq` (ترتیب کلی آپدیت‌ها).
- هر آپدیت پوش‌شده این شمارنده‌ها را جلو می‌برد؛ اگر gap دیدی، با state قبلی `updates.getDifference` بزن.
- هر کانال pts مستقل خودش را دارد (`updates.getChannelDifference`).
- طراحی رایج کلاینت‌ها: صف آپدیت + تضمین ترتیب + debounce روی getDifference — عملاً event sourcing.

### ۸. فایل‌ها

- آپلود: پارت‌های ≤۵۱۲KB با `upload.saveFilePart/saveBigFilePart`، موازی روی چند اتصال.
- دانلود: `upload.getFile(offset, limit)` — استریم ویدیو یعنی همین متد با offset جلو‌رونده.
- **file_reference**: هر فایل توکن انقضادار دارد؛ با خطای `FILE_REFERENCE_EXPIRED` باید از پیام مبدا رفرش شود — معروف‌ترین منبع باگ در کلاینت‌های ثالث.
- CDN: رسانه‌های پرمصرف روی CDN جدا با کلید CDN؛ کلاینت باید صحت داده CDN را چک کند.

### ۹. DCها و مهاجرت

- حساب کاربر یک DC خانه دارد و RPC باید به همان DC برود؛ برخی کانال‌های خاص ممکن است روی DC دیگری باشند و سرور خودش پیام را بین DCها می‌برد.
- برای ساختن auth_key روی DC دوم: `auth.exportAuthorization` → `auth.importAuthorization`.
- لیست DCها از config سرویس می‌آید — IPها می‌توانند تغییر کنند؛ هاردکد نکن.

### ۱۰. وب‌کلاینت‌ها

همان MTProto ولی روی WebSocket؛ سریال‌سازی در JS و رمزنگاری در نسخه‌های جدید با WebAssembly. این یعنی MTProto را می‌شود کاملاً داخل مرورگر با DevTools دیباگ کرد — هیچ رازی در باینری‌های بسته نیست.

---

## بخش سوم — پلی‌بوک عملی مهندسی معکوس

> کلاینت‌های رسمی اوپن‌سورس‌اند (GPL)؛ پس معکوس‌کاری یعنی: خواندن سورس + زیر نظر گرفتن ترافیک خودت + بازسازی پروتکل. تنها پارچه بسته، سرور است — و رفتارش از پاسخ‌ها و شِما استنتاج می‌شود. همه تست‌ها فقط روی حساب و دستگاه خودت.

### گام ۰ — هدف و دامنه را دقیق کن

بین‌عملکردی (ساخت کلاینت/ربات پیشرفته)؟ پژوهش پروتکل؟ ممیزی امنیتی؟ یادگیری طراحی سیستم؟ تعیین کن کدام لایه را می‌خواهی: transport، TL، منطق کلاینت یا رفتار سرور — هر لایه ابزار خودش را می‌خواهد.

### گام ۱ — سورس‌باز را setup کن

```bash
git clone --depth 1 https://github.com/tdlib/td
git clone --depth 1 https://github.com/telegramdesktop/tdesktop
git clone --depth 1 https://github.com/morethanwords/tweb   # وب‌کلاینت K
```

فایل‌های کلیدی: `td/telegram/td_api.tl`، `tdesktop/Telegram/Resources/tl/api.tl` و `tdesktop/Telegram/SourceFiles/mtproto/*`. این‌ها «specification اجرایی» پروتکل‌اند — مستندات رسمی ناقص است، کد کامل است.

### گام ۲ — اعتبارنامه و حساب آزمایشگاهی

از my.telegram.org یک api_id/api_hash بگیر و یک حساب جدا برای آزمایش بساز. تلگرام دو DC تست با شماره‌های آزمایشی دارد — برای تمرین بدون آسیب به حساب اصلی. از همین اول 2FA و passcode را فعال کن و sessionهای آزمایشگاهی را بعداً terminate کن.

### گام ۳ — کلاینت آزمایشگاهی با Telethon

```python
from telethon import TelegramClient, events

client = TelegramClient('lab', API_ID, API_HASH)

@client.on(events.Raw)
def raw(u):
    print(type(u).__name__, u.to_dict())   # همه آپدیت‌های خام با constructor واقعی

with client:
    client.loop.run_until_complete(client.run_until_disconnected())
```

- با `functions.*` هر متدی را صدا بزن و ورودی/خروجی را ثبت کن.
- decode دستی بافرها با `telethon.extensions.BinaryReader` — بهترین تمرین TL.
- فلگ‌ها را عمداً تغییر بده (مثل `noforwards`) و تفاوت پاسخ سرور را مستند کن؛ این یعنی معکوس‌کردن contract سرور با داده واقعی.

### گام ۴ — کپچر شبکه و حذف obfuscation

```bash
sudo tcpdump -i any -w tg.pcap host 149.154.167.51   # IP نمونه DC؛ از config بگیر
```

- ساختار کلی بسته‌ها (اندازه/جهت/تناوب) در Wireshark قابل تحلیل است.
- حذف لایه obfuscation برای ترافیک خودت (کلیدش در هدر آشکار است):

```python
from Crypto.Cipher import AES

key, iv = header[8:40], header[40:56]
ctr = AES.new(key, AES.MODE_CTR, nonce=b'', initial_value=int.from_bytes(iv, 'big'))
plain = ctr.decrypt(stream)   # از بایت ۵۶ به بعد؛ در جهت معکوس: key[::-1]
```

- پشت این لایه، رمز اصلی MTProto است که بدون auth_key خودت دیکود نمی‌شود؛ برای decode کامل کلاینت را instrument کن (گام ۵)، نه شبکه را.

### گام ۵ — instrument کردن کلاینت رسمی

- در tdesktop کلاس‌های transport در `Telegram/SourceFiles/mtproto/` هستند؛ قبل از encrypt بافر را لاگ کن و با pcap خودت مقایسه کن.
- در TDLib هم همین‌طور: با verbosity بالا RPCها لاگ می‌شوند.
- تحلیل پویا با سورس، عملاً کل framing و رمزنگاری را باز می‌کند — بدون Ghidra.

### گام ۶ — تحلیل ایستا (فورک‌ها و اپ‌های غیررسمی)

```bash
apktool d app.apk -o out
jadx --deobf app.apk -d src
```

- کتابخانه‌های نیتیو (libtgcalls، libtdjson) با Ghidra/IDA؛ شروع از exported JNIها.
- برای فورک‌های مشکوک، diff با سورس رسمی بگیر؛ تغییرات غیرعادی همان‌جایی است که بدافزار قایم شده — این زاویه، کاربرد دفاعی مستقیم RE است.

### گام ۷ — جرم‌شناسی داده محلی

- Desktop: پوشه `tdata`؛ کلید محلی از passcode مشتق می‌شود و بدون آن فایل نشست عملاً بلااستفاده است.
- Android: دیتابیس SQLite محلی؛ پیام‌های cloud به‌صورت plaintext محلی می‌نشینند؛ secret chats رمزند.
- نتیجه دفاعی: هرکس دستگاه را داشته باشد تاریخچه را دارد؛ رمز دستگاه + passcode اپ + 2FA حیاتی‌اند و sessionهای بلااستفاده را terminate کن.

### گام ۸ — بازسازی پروتکل؛ تمرین نهایی

کوچک‌ترین کلاینت ممکن را بنویس: transport abridged/obfuscated → TL packer → جریان auth → `messages.sendMessage` → حلقه updates. وقتی دستی انجامش بدهی، auth_key و msg_key و seq_no برایت «دستی» می‌شوند. مراجع: مستندات MTProto v2.0، سورس gramjs/mtcute و مستندات مفصل MadelineProto (به‌خصوص در obfuscation).

### گام ۹ — schema diffing

```bash
git -C tdesktop log --oneline -- Telegram/Resources/tl/api.tl
git -C tdesktop diff v5.x..v5.y -- Telegram/Resources/tl/api.tl
```

constructorهای جدید = قابلیت‌های در راه؛ همین تکنیک است که پیش از عرضه رسمی، فیچرها را لو می‌دهد.

### گام ۱۰ — بخش‌های HTTPS (Bot API / Mini Apps / وب)

Bot API معمولی HTTPS است؛ با mitmproxy روی دستگاه خودت قابل مشاهده. برای بک‌اند مینی‌اپ، امضای initData را این‌طور verify کن:

```ts
// بدون هیچ تماسی با تلگرام
const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
const check = Object.entries(params)
  .filter(([k]) => k !== 'hash')
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([k, v]) => `${k}=${v}`)
  .join('\n');
const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
// مقایسه با params.hash + چک تازگی auth_date
```

### گام ۱۱ — مرزهای قانونی و اخلاقی (کوتاه اما جدی)

فقط حساب و دستگاه خودت؛ نه اسپم، نه جمع‌آوری داده دیگران، نه خرید/فروش session. فورک‌ها تابع GPL؛ استفاده از API تابع ToS تلگرام؛ قانون‌گذاری RE هم بسته به کشور متفاوت است — چک کن.

### جدول خلاصه ابزارها

| لایه | ابزار | خروجی |
| --- | --- | --- |
| شِما | `api.tl` + core.telegram.org/schema | نقشه انواع و متدها |
| تحلیل پویا | Telethon/GramJS/TDLib + `events.Raw` | لاگ RPC و آپدیت‌های خام |
| شبکه | tcpdump/Wireshark + stripping CTR | تشخیص و تحلیل بسته |
| ایستا | jadx/apktool/Ghidra/Hopper | smali/java/native |
| داده محلی | sqlite3 + پوشه tdata | جرم‌شناسی دفاعی |
| بازسازی | Python/TS + TL packer | کلاینت مینیمال |

### واژه‌نامه سریع

- **MTProto**: پروتکل RPC باینری + رمزنگاری خود تلگرام
- **auth_key**: کلید ۲۰۴۸ بیتیِ DH بین کلاینت و DC؛ مبنا همه رمزنگاری cloud
- **msg_key**: هش وابسته به متن، برای مشتق کلید AES-IGE هر پیام
- **server_salt / session_id**: مقاوم‌سازی هر session در برابر replay
- **TL / Layer**: زبان تعریف انواع + شماره نسخه شِما
- **pts/qts/seq**: شمارنده‌های state برای سینک آپدیت‌ها
- **file_reference**: توکن موقت دانلود فایل
- **obfuscated transport**: لایه AES-CTR ضد-DPI روی ترنسپورت
- **SRP**: اثبات پسورد بدون افشای آن به سرور
- **constructor CRC32**: شناسه هر نوع در شِما؛ کلید دیکود باینری

