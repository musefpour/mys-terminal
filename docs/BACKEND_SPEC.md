# مشخصات بک‌اند Mys Terminal — مدل‌های داده و قابلیت‌ها

> این سند برای ساخت سرور بک‌اند نوشته شده است. کلاینت یک برنامه Electron است (`src/main/store.ts`، `src/main/auth.ts`، `src/shared/types.ts`) که الان همه چیز را **محلی** نگه می‌دارد:
> - `userData/sessions.json` ← نشست‌ها، پوشه‌ها، اسنیپت‌ها، ورک‌اسپیس‌ها، لاگ اتصال، known hosts، تنظیمات
> - `userData/secrets.bin` ← رمزها، Keychain، Vault، اسنیپت‌های محرمانه (AES-256-GCM + safeStorage)
> - `userData/auth.json` ← کاربران، پروفایل‌ها، حساب فعلی
> - `localStorage` رندرر ← اندازه داک‌ها، تب‌های باز، ترجیحات UI
>
> هدف بک‌اند: پیاده‌سازی واقعی **حالت آنلاین** (`settings.mode = 'online'`)، یعنی احراز هویت سمت سرور، ورک‌اسپیس تیمی با دعوت واقعی، اشتراک پوشه، همگام‌سازی بین دستگاه‌ها، لاگ ممیزی و فید به‌روزرسانی.
> حالت `offline` باید بدون هیچ تماسی با سرور کار کند (offline-first).

---

## ۰. اصول کلی (الزامی)

1. **رمزنگاری سرتاسری (E2EE) برای اسرار.** سرور هرگز رمز SSH، passphrase، کلید خصوصی، رمز پروکسی، secret کلید S3، رمزهای Vault یا متن اسنیپت محرمانه را به‌صورت متن ساده نمی‌بیند. این فیلدها سمت کلاینت رمز می‌شوند و سرور فقط `ciphertext` ذخیره می‌کند (جزئیات در بخش ۳).
2. **شناسه‌ها UUID هستند و کلاینت آن‌ها را می‌سازد** (کلاینت فعلی از `randomUUID()` استفاده می‌کند). سرور باید شناسه کلاینت را بپذیرد تا رکوردهایی که آفلاین ساخته شده‌اند بدون نگاشت دوباره همگام شوند.
3. **همه رکوردهای قابل همگام‌سازی** این فیلدهای مشترک را دارند:

   | فیلد | نوع | توضیح |
   |---|---|---|
   | `id` | uuid | ساخته‌شده توسط کلاینت |
   | `revision` | bigint | شمارنده یکنواخت که سرور با هر تغییر زیاد می‌کند (برای sync و کنترل همزمانی) |
   | `createdAt` | timestamptz | |
   | `updatedAt` | timestamptz | |
   | `createdBy` / `updatedBy` | uuid → User | |
   | `deletedAt` | timestamptz \| null | حذف نرم (tombstone)، تا حذف به دستگاه‌های دیگر هم برسد |

4. **زمان‌ها:** کلاینت زمان را به میلی‌ثانیه epoch می‌فرستد (`number`). API باید epoch ms بپذیرد و برگرداند.
5. **کدهای خطا:** خطاها رشته‌های ثابت انگلیسی برمی‌گردانند (مثل `username-taken`) تا کلاینت با i18n خودش ترجمه کند. فرمت پاسخ: `{ "ok": false, "code": "...", "message"?: "..." }`.
6. **پیشنهاد فناوری** (اگر ترجیح دیگری نیست): PostgreSQL، REST + WebSocket، JWT کوتاه‌مدت + Refresh Token چرخشی، ذخیره فایل روی S3-compatible.

---

## ۱. هویت و احراز هویت

### 1.1 `User`
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | PK |
| `username` | varchar(24) | یکتا، regex `^[a-z][a-z0-9_]{2,23}$` (`normalizeHandle`)، با حروف کوچک ذخیره شود |
| `displayName` | varchar(80) | |
| `email` | varchar(120) \| null | یکتا، lowercase، regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| `emailVerifiedAt` | timestamptz \| null | |
| `phone` | varchar(16) \| null | یکتا، فرمت E.164 (`^\+[1-9]\d{9,14}$`) |
| `phoneVerifiedAt` | timestamptz \| null | |
| `passwordHash` | text \| null | Argon2id یا scrypt (کلاینت فعلی scrypt با N=2^15 دارد). فقط برای ورود با تلفن |
| `pictureUrl` | text \| null | از Google |
| `locale` | varchar(8) | یکی از `LOCALE_IDS`، پیش‌فرض `fa` |
| `publicKey` | text \| null | کلید عمومی X25519 برای E2EE (بخش ۳) |
| `encryptedPrivateKey` | bytea \| null | کلید خصوصی که با کلیدی برگرفته از passphrase کاربر رمز شده |
| `keyDerivation` | jsonb \| null | `{ algo: "argon2id", salt, memory, iterations, parallelism }` |
| `status` | enum | `active` \| `disabled` \| `deleted` |
| `lastLoginAt` | timestamptz | |
| `createdAt` / `updatedAt` | timestamptz | |

### 1.2 `AuthIdentity` (روش‌های ورود متصل به کاربر)
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid → User | |
| `provider` | enum | `phone` \| `google` |
| `providerSubject` | varchar | برای google: `sub`، برای phone: شماره E.164 |
| `email` | varchar \| null | ایمیلی که provider داده |
| `createdAt` | timestamptz | |

یکتا روی (`provider`, `providerSubject`).

### 1.3 `OtpChallenge` (کد تأیید پیامکی)
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `phone` | varchar(16) | |
| `purpose` | enum | `signup` \| `reset` \| `change-phone` |
| `codeHash` | bytea | `sha256(phone:code)`، کد ۶ رقمی |
| `expiresAt` | timestamptz | ۵ دقیقه بعد |
| `attempts` | int | بیشتر از ۵ بار ← باطل |
| `resendAvailableAt` | timestamptz | ۳۰ ثانیه بعد |
| `ip` | inet | برای محدودیت نرخ |
| `consumedAt` | timestamptz \| null | |

### 1.4 `VerificationProof` (توکن یک‌بارمصرف بعد از تأیید OTP)
| فیلد | نوع | قید |
|---|---|---|
| `tokenHash` | bytea | توکن ۲۴ بایتی base64url، فقط هش ذخیره شود |
| `phone` | varchar | |
| `purpose` | enum | `signup` \| `reset` |
| `expiresAt` | timestamptz | ۱۰ دقیقه |
| `consumedAt` | timestamptz \| null | |

### 1.5 `Device`
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | کلاینت می‌سازد و محلی نگه می‌دارد |
| `userId` | uuid → User | |
| `name` | varchar(120) | hostname دستگاه (`clientHost`) |
| `platform` | enum | `darwin` \| `win32` \| `linux` |
| `arch` | varchar(16) | |
| `appVersion` | varchar(32) | |
| `lastSeenAt` | timestamptz | |
| `lastIp` | inet | |
| `revokedAt` | timestamptz \| null | |

### 1.6 `RefreshToken`
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | |
| `userId`, `deviceId` | uuid | |
| `tokenHash` | bytea | |
| `familyId` | uuid | برای تشخیص استفاده دوباره از توکن (reuse) و باطل کردن کل زنجیره |
| `expiresAt` | timestamptz | `remember=true` ← ۶۰ روز، در غیر این صورت ۱۲ ساعت |
| `rotatedAt` / `revokedAt` | timestamptz \| null | |

### قابلیت‌های احراز هویت
| # | قابلیت | جزئیات |
|---|---|---|
| A1 | درخواست OTP | `POST /v1/auth/phone/request {phone, purpose}`. نرمال‌سازی شماره مثل `normalizePhone` کلاینت (`09…` و `9xxxxxxxxx` ← `+98…`، `00` ← `+`). خطاها: `phone-invalid`، `account-exists` (برای signup)، `account-missing` (برای reset). ارسال پیامک از سمت سرور انجام شود (جایگزین `MYS_SMS_URL`). پاسخ: `{ok, phone, delivery:"sms"}` |
| A2 | تأیید OTP | `POST /v1/auth/phone/verify {phone, code}` ← `{ok, phone, proof}`. خطاها: `code-invalid`، `code-expired` |
| A3 | ثبت‌نام | `POST /v1/auth/signup {phone, proof, password, confirm, username}`. حداقل طول رمز ۶ (پیشنهاد: ۸). خطاها: `password-short`، `password-mismatch`، `username-invalid`، `username-taken`، `proof-invalid`، `account-exists` |
| A4 | ورود با رمز | `POST /v1/auth/login {phone, password, remember, device}`. خطاها: `account-missing`، `password-wrong`. محدودیت نرخ و قفل تدریجی |
| A5 | بازنشانی رمز | `POST /v1/auth/reset {phone, proof, password, confirm}` و بعد از آن باطل شدن همه Refresh Token ها |
| A6 | ورود با Google | کلاینت جریان PKCE را با loopback (`127.0.0.1:<port>/callback`) انجام می‌دهد و `code` + `code_verifier` + `redirect_uri` را به `POST /v1/auth/google` می‌فرستد. سرور با client secret خودش code را مبادله می‌کند، `id_token` را اعتبارسنجی می‌کند (aud، iss، exp) و کاربر را پیدا می‌کند یا می‌سازد. **Client ID دیگر لازم نیست در `auth.json` کاربر ذخیره شود** و از سرور گرفته می‌شود: `GET /v1/auth/config` |
| A7 | توکن | `POST /v1/auth/refresh`، `POST /v1/auth/logout` (باطل کردن توکن دستگاه فعلی) |
| A8 | پروفایل | `GET /v1/me`، `PATCH /v1/me {displayName, locale}` |
| A9 | تغییر username | `PUT /v1/me/username` با همان قیدها. username قبلی آزاد می‌شود |
| A10 | تنظیم یا تأیید ایمیل | `PUT /v1/me/email` ← ارسال لینک یا کد تأیید به ایمیل. بعد از تأیید، دعوت‌های در انتظار همان ایمیل فعال شوند (بخش ۲) |
| A11 | جستجو برای دعوت | `GET /v1/users/lookup?username=` ← `{username, name}` یا `username-missing`. `GET /v1/users/lookup?email=` ← `{email, known, name?}`. محدودیت نرخ برای جلوگیری از enumeration |
| A12 | مدیریت دستگاه‌ها | `GET /v1/me/devices`، `DELETE /v1/me/devices/:id` (خروج از راه دور) |
| A13 | حذف حساب | `DELETE /v1/me`: حذف داده شخصی و انتقال یا حذف ورک‌اسپیس‌هایی که کاربر مالک آن‌هاست |
| A14 | خروجی داده کاربر | `GET /v1/me/export` (GDPR) |

---

## ۲. ورک‌اسپیس، عضویت و دسترسی

### 2.1 `Workspace`
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `name` | varchar(80) | پیش‌فرض `Workspace`. اولین ورک‌اسپیس هر کاربر: `Personal` |
| `ownerId` | uuid → User | |
| `kind` | enum | `personal` \| `team` |
| + فیلدهای مشترک sync | | |

### 2.2 `WorkspaceMember`
| فیلد | نوع | توضیح |
|---|---|---|
| `workspaceId` | uuid | PK مرکب |
| `userId` | uuid | PK مرکب |
| `role` | enum | `owner` \| `admin` \| `member` \| `viewer` (کلاینت فعلی فقط owner/member دارد، بقیه پیشنهادی است) |
| `joinedAt` | timestamptz | |

### 2.3 `WorkspaceInvitation`
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | |
| `workspaceId` | uuid | |
| `email` | varchar(120) | normalize شده |
| `invitedBy` | uuid → User | |
| `role` | enum | |
| `status` | enum | `pending` \| `accepted` \| `revoked` \| `expired` |
| `tokenHash` | bytea | برای لینک دعوت |
| `invitedAt` (`createdAt`) | timestamptz | معادل `WorkspaceMember.invitedAt` کلاینت |
| `expiresAt` | timestamptz | پیشنهاد: ۱۴ روز |

> نگاشت به کلاینت: `WorkSpace.members[]` در کلاینت = اعضای فعال (`status:'active'`) + دعوت‌های pending (`status:'pending'`) با `email` هر کدام.

### 2.4 `WorkspaceKeyGrant` (برای E2EE، بخش ۳)
| فیلد | نوع | توضیح |
|---|---|---|
| `workspaceId`, `userId` | uuid | PK مرکب |
| `keyVersion` | int | با هر چرخش کلید زیاد می‌شود |
| `wrappedKey` | bytea | کلید ورک‌اسپیس که با `publicKey` عضو رمز شده (sealed box) |
| `grantedBy` | uuid | |

### قابلیت‌ها
| # | قابلیت | قوانین |
|---|---|---|
| W1 | فهرست ورک‌اسپیس‌های من | `GET /v1/workspaces`: فقط آن‌هایی که کاربر owner یا عضو فعال است (`canUseWorkspace`) |
| W2 | ساخت | `POST /v1/workspaces {id, name}` و سازنده owner می‌شود |
| W3 | تغییر نام | `PATCH /v1/workspaces/:id`: فقط owner یا admin |
| W4 | دعوت | `POST /v1/workspaces/:id/invitations {email, role}`. خطاها: `notFolderOwner` (اگر کاربر مالک نیست)، `invalidUser`، `cannotInviteSelf`، `alreadyMember`. اگر ایمیل کاربر شناخته‌شده باشد، عضو مستقیم اضافه شود (رفتار فعلی: `known ? active : pending`) و اعلان درون‌برنامه‌ای بگیرد. در غیر این صورت ایمیل دعوت فرستاده شود |
| W5 | فعال‌سازی خودکار دعوت | وقتی کاربری با ایمیل تأییدشده وارد یا ثبت‌نام می‌کند، همه دعوت‌های pending آن ایمیل پذیرفته شوند (`activatePendingInvites`) |
| W6 | پذیرش یا رد دعوت با لینک | `POST /v1/invitations/:token/accept`، `/decline` |
| W7 | حذف عضو | `DELETE /v1/workspaces/:id/members/:userId`: فقط owner. بعد از آن، چرخش کلید ورک‌اسپیس لازم است (بخش ۳) |
| W8 | ترک ورک‌اسپیس | `POST /v1/workspaces/:id/leave` (owner نمی‌تواند، مگر بعد از انتقال مالکیت) |
| W9 | انتقال مالکیت | `POST /v1/workspaces/:id/transfer {userId}` |
| W10 | حذف ورک‌اسپیس | فقط owner، با حذف نرم و امکان بازیابی ۳۰ روزه |
| W11 | ورک‌اسپیس فعال | **سمت دستگاه** است (`settings.activeWorkspaceId`) و نیاز به سرور ندارد |

### ماتریس دسترسی (پیشنهادی)
| عملیات | owner | admin | member | viewer |
|---|---|---|---|---|
| دیدن نشست و پوشه | ✔ | ✔ | ✔ (با رعایت ACL پوشه) | ✔ |
| باز کردن اتصال (گرفتن secret) | ✔ | ✔ | ✔ | ✔ |
| ساخت یا ویرایش نشست و پوشه | ✔ | ✔ | ✔ | ✖ |
| حذف | ✔ | ✔ | فقط آنچه خودش ساخته | ✖ |
| دعوت یا حذف عضو | ✔ | ✔ (به جز owner) | ✖ | ✖ |
| دیدن لاگ ممیزی همه | ✔ | ✔ | فقط لاگ خودش | فقط لاگ خودش |

---

## ۳. مدل رمزنگاری سرتاسری (E2EE)

سرور فقط blob ذخیره می‌کند، ولی باید این مدل‌ها و جریان‌ها را پشتیبانی کند:

1. هر کاربر روی کلاینت یک جفت کلید X25519 می‌سازد. `publicKey` به‌صورت متن ساده ذخیره می‌شود. `encryptedPrivateKey` با کلید برگرفته از passphrase کاربر (Argon2id) رمز می‌شود و سرور فقط ciphertext آن را نگه می‌دارد. این passphrase **جدا از رمز ورود** است، چون رمز ورود به سرور می‌رسد.
2. هر ورک‌اسپیس یک کلید متقارن ۲۵۶ بیتی (`WorkspaceKey`) دارد که کلاینت owner می‌سازد. این کلید برای هر عضو با کلید عمومی او wrap می‌شود و در `WorkspaceKeyGrant` قرار می‌گیرد.
3. همه فیلدهای محرمانه با `XChaCha20-Poly1305` یا `AES-256-GCM` و کلید ورک‌اسپیس (برای داده مشترک) یا کلید شخصی کاربر (برای داده شخصی) رمز می‌شوند.
4. **عضو تازه:** وقتی دعوت پذیرفته می‌شود، سرور یک رویداد `key-grant-needed` می‌فرستد و اولین کلاینت آنلاین owner یا admin، grant را می‌سازد. تا آن موقع عضو ساختار را می‌بیند ولی secret ها را نه.
5. **حذف عضو:** `keyVersion` زیاد می‌شود، کلاینت owner کلید تازه می‌سازد و secret ها را دوباره رمز می‌کند (endpoint دسته‌ای `POST /v1/workspaces/:id/rekey`).
6. **بازیابی:** کلید بازیابی (recovery key) که یک بار به کاربر نمایش داده می‌شود و یک نسخه `encryptedPrivateKey` با آن هم ذخیره می‌شود (`recoveryWrappedPrivateKey`).

ساختار مشترک فیلد رمزشده (`EncryptedBlob`):
```json
{ "v": 1, "alg": "xchacha20poly1305", "keyId": "ws:<workspaceId>:<keyVersion>" | "user:<userId>", "nonce": "base64", "ct": "base64" }
```

---

## ۴. پوشه‌ها

### `Folder`
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `workspaceId` | uuid → Workspace | |
| `parentId` | uuid \| null → Folder | بدون چرخه (سرور هم باید بررسی کند: `folderInsideItself`) |
| `name` | varchar(80) | خالی نباشد (`folderNameRequired`) |
| `sortKey` | varchar | ترتیب (fractional index)، **پیشنهادی** |
| `restricted` | bool | معادل `owner != null` در کلاینت |
| + فیلدهای مشترک sync | | |

### `FolderAccess` (پوشه خصوصی یا اشتراکی داخل ورک‌اسپیس)
| فیلد | نوع | توضیح |
|---|---|---|
| `folderId`, `userId` | uuid | PK مرکب |
| `role` | enum | `owner` \| `member` |

قانون دیدن (`canSeeFolder`): از پوشه به سمت ریشه بالا برو. اولین پوشه‌ای که `restricted=true` است تعیین‌کننده است: کاربر باید owner یا member آن باشد. اگر به ریشه برسیم و هیچ پوشه محدودی نباشد، همه اعضای ورک‌اسپیس آن را می‌بینند. **این فیلتر باید سمت سرور اعمال شود** (هم در لیست و هم در sync). نشست‌های داخل پوشه پنهان هم پنهان می‌مانند.

> نکته: کلاینت فعلی اعضای پوشه را با `username` و اعضای ورک‌اسپیس را با `email` نگه می‌دارد. در سرور هر دو باید با `userId` باشند و API برای نمایش، username/email را هم برگرداند.

قابلیت‌ها: CRUD، جابه‌جایی (`parentId`)، حذف بازگشتی (زیرپوشه‌ها حذف و نشست‌هایشان به ریشه منتقل می‌شوند: `folderId = null`)، تنظیم دسترسی `PUT /v1/folders/:id/access {restricted, members:[userId]}`.

---

## ۵. نشست‌ها (هاست‌ها) — مدل اصلی

### 5.1 `Session`
| فیلد | نوع | پیش‌فرض / قید | توضیح |
|---|---|---|---|
| `id` | uuid | | |
| `workspaceId` | uuid | | |
| `folderId` | uuid \| null | | |
| `sortKey` | varchar | | جایگزین ترتیب آرایه (`moveSession` با `beforeId`) |
| `name` | varchar(80) | `''` | |
| `protocol` | enum | | `local, ssh, sftp, telnet, raw, serial, ftp, s3, rdp, vnc, mosh, browser, wsl, docker, k8s, powershell` |
| `host` | varchar(253) | | برای S3 = نام باکت. برای docker/k8s/wsl = نام کانتینر، pod یا distro |
| `port` | int | از `DEFAULT_PORT` | 0..65535 |
| `username` | varchar(120) | | برای S3 = access key |
| `privateKeyPath` | text | | مسیر محلی است و روی دستگاه دیگر معتبر نیست ← **به `DeviceSessionOverride` منتقل شود** (5.4) |
| `certificatePath` | text | | مثل بالا |
| `keychainItemId` | uuid \| null | | **پیشنهادی**: ارجاع به کلید Keychain به جای مسیر فایل، تا روی همه دستگاه‌ها کار کند |
| `startupCommand` | text | | |
| `cwd` | text | | |
| `shell` | text | | |
| `x11` | bool | false | |
| `useAgent` | bool | true | |
| `agentForward` | bool | false | |
| `serialPath` | varchar | | محلی است ← override دستگاه |
| `baudRate` | int | 115200 | |
| `dataBits` | smallint | 8 | 7 یا 8 |
| `parity` | enum | `none` | `none`، `even`، `odd` |
| `stopBits` | smallint | 1 | 1 یا 2 |
| `url` | text | | برای browser آدرس است و برای S3 endpoint اختیاری |
| `domain` | varchar | | برای S3 = region (پیش‌فرض `us-east-1`)، برای RDP = domain. برای k8s context یا namespace هم در این فیلد یا فیلدهای مشابه است (کد hub را ببینید) |
| `ftpSecure` | enum | `off` | `off`، `explicit`، `implicit` |
| `jumpSessionId` | uuid \| null → Session | | نباید به خودش اشاره کند. باید در همان ورک‌اسپیس باشد. بعد از حذف jump host ← null |
| `proxyType` | enum | `none` | `none`، `socks5`، `http` |
| `proxyHost` | varchar(253) | | |
| `proxyPort` | int | 1080 | |
| `proxyUser` | varchar(120) | | |
| `rdpFullscreen` | bool | false | |
| `rdpClipboard` | bool | true | |
| `rdpShareHome` | bool | false | |
| `icon` | varchar | `''` | یکی از `HOST_ICON_IDS` (`shared/hostIcons.ts`) |
| `color` | char(7) | `''` | `#rrggbb` |
| `termTheme` | varchar | `''` | یکی از `TERM_THEME_IDS` یا خالی |
| `termFontSize` | smallint | 0 | 0..32، و 0 یعنی از تنظیمات برنامه |
| `termFontFamily` | varchar(120) | `''` | |
| `notes` | text | | پیشنهاد: حداکثر 10KB |
| `tags` | varchar[] | | **پیشنهادی** |
| + فیلدهای مشترک sync | | | |

> فیلدهای `hasPassword`، `hasPassphrase` و `hasProxyPassword` در کلاینت **مشتق** هستند و از وجود رکورد در `SessionSecret` محاسبه می‌شوند.
> فیلدهای آماری (`lastUsed`، `opens`، `errors`، `activeMs`، `bytesIn`، `bytesOut`، `dailyOpens`، `dailyErrors`، `errorLog`) **نباید** روی رکورد Session بمانند، چون هر بار باز شدن اتصال یک revision تازه و تداخل sync می‌سازند. به 5.5 و 5.6 منتقل شوند.

### 5.2 `TunnelTemplate` (جدول فرزند Session یا jsonb)
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `sessionId` | uuid | |
| `mode` | enum | `local` \| `remote` \| `dynamic` |
| `listenPort` | int | |
| `targetHost` | varchar | پیش‌فرض `127.0.0.1` |
| `targetPort` | int | برای dynamic = 0 |
| `label` | varchar(80) \| null | |
| `bindAddress` | varchar(64) \| null | |

### 5.3 `SessionSecret` (E2EE)
| فیلد | نوع | توضیح |
|---|---|---|
| `sessionId` | uuid | |
| `scope` | enum | `shared` (با کلید ورک‌اسپیس، برای همه اعضا) \| `personal` (با کلید کاربر، override شخصی روی نشست مشترک) |
| `userId` | uuid \| null | برای personal |
| `kind` | enum | `password` \| `passphrase` \| `proxyPassword` |
| `blob` | EncryptedBlob | |
| + فیلدهای sync | | |

یکتا روی (`sessionId`, `scope`, `userId`, `kind`). ارسال `null` از کلاینت یعنی حذف secret و ارسال رشته خالی یعنی «بدون تغییر» (رفتار `saveSession`).

### 5.4 `DeviceSessionOverride` (تنظیمات وابسته به دستگاه)
| فیلد | نوع |
|---|---|
| `deviceId`, `sessionId` | uuid |
| `privateKeyPath`, `certificatePath`, `serialPath`, `shell`, `cwd` | text |

> اگر نمی‌خواهید سرور مسیرهای محلی را ببیند، این جدول می‌تواند فقط محلی بماند. در این حالت فقط یک پرچم در سند لازم است.

### 5.5 `SessionUsageDaily` (آمار)
| فیلد | نوع | توضیح |
|---|---|---|
| `sessionId` | uuid | |
| `userId` | uuid | آمار هر کاربر جداست و در داشبورد جمع زده می‌شود |
| `day` | date | `YYYY-MM-DD` (`dayKey`) به وقت محلی کلاینت |
| `opens` | int | |
| `errors` | int | |
| `activeMs` | bigint | |
| `bytesIn` / `bytesOut` | bigint | |
| `lastUsedAt` | timestamptz | |

PK روی (`sessionId`, `userId`, `day`). کلاینت فقط ۱۴ روز اخیر را نشان می‌دهد. سرور می‌تواند داده بیشتری نگه دارد (پیشنهاد: ۹۰ روز) و مجموع کل (`opens`، `errors` و غیره) را با یک view محاسبه کند.
API: `POST /v1/usage/batch` (افزایشی، از نوع increment، تا آفلاین هم جمع شود): `[{sessionId, day, opens?, errors?, activeMs?, bytesIn?, bytesOut?}]`.

### 5.6 `SessionErrorLog`
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `sessionId`, `userId`, `deviceId` | uuid | |
| `at` | timestamptz | |
| `message` | varchar(240) | |

کلاینت ۱۲ مورد آخر را نشان می‌دهد. سرور می‌تواند بیشتر نگه دارد.

### قابلیت‌های نشست
- CRUD، **duplicate** (کپی secret ها و تونل‌ها با شناسه‌های تازه و صفر کردن آمار)، **move** (`folderId` + `sortKey`)، **favorite**، حذف (که `jumpSessionId` نشست‌های دیگر را پاک می‌کند و secret را هم حذف می‌کند).
- **وارد کردن دسته‌ای** `POST /v1/workspaces/:id/import`. پارس فایل‌های PuTTY، MobaXterm، SecureCRT و ssh-config سمت کلاینت انجام می‌شود و سرور فقط پوشه‌ها و نشست‌های آماده را می‌گیرد. باید به‌صورت تراکنشی ذخیره شود و تکراری‌ها رد شوند (تطبیق روی protocol، host (بدون حساسیت به حروف)، port، username و برای browser url و برای serial serialPath).
- **خروجی** `GET /v1/workspaces/:id/export?format=json|csv&folderIds=&sessionIds=`. secret ها هرگز در خروجی نمی‌آیند. پوشه‌های والد هم همراه می‌شوند. ستون‌های CSV: `name, folder, protocol, host, port, username, url, notes` (با BOM).
- **known hosts مشترک** (بخش ۹).

---

## ۶. اسنیپت‌ها (Macro) و بسته‌ها

### `Snippet` (در کلاینت: `Macro`)
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `scope` | enum | `personal` (`ownerId`) \| `workspace` (`workspaceId`). در کلاینت فعلی اسنیپت‌ها سراسری‌اند و پیش‌فرض personal است |
| `ownerId` / `workspaceId` | uuid | |
| `packageId` | uuid \| null → SnippetPackage | |
| `name` | varchar(80) | |
| `command` | text(8000) \| null | اگر `secret=false` باشد |
| `secret` | bool | اگر true باشد، `command` خالی است و متن در `commandBlob` رمز می‌شود |
| `commandBlob` | EncryptedBlob \| null | |
| `sendEnter` | bool | پیش‌فرض true |
| `targetSessionIds` | uuid[] | حداکثر ۴۰ |
| `tags` | varchar(24)[] | یکتا، حداکثر ۱۲ |
| `pinned` | bool | |
| `sortKey` | varchar | |
| + فیلدهای sync | | |

`SnippetUsage` (شخصی، برای هر کاربر): `snippetId, userId, uses int, lastRunAt` (جای `uses` و `lastRun` در کلاینت). از API افزایشی استفاده شود.

### `SnippetPackage`
| فیلد | نوع |
|---|---|
| `id` | uuid |
| `scope`, `ownerId` / `workspaceId` | |
| `name` | varchar(80)، خالی نباشد |
| `sortKey` | varchar |

قابلیت‌ها: CRUD تکی و ذخیره دسته‌ای (کلاینت فعلی کل لیست را با `macros.save(list)` می‌فرستد. سرور بهتر است diff را از طریق sync بگیرد). خروجی و ورود: اسنیپت‌های محرمانه بدون متن خارج می‌شوند و هنگام ورود رد می‌شوند.

---

## ۷. Keychain (هویت‌ها، کلیدها و گواهی‌ها)

### `KeychainItem`
| فیلد | نوع | رمزشده؟ | قید |
|---|---|---|---|
| `id` | uuid | | |
| `scope` | enum | | `personal` \| `workspace` |
| `ownerId` / `workspaceId` | uuid | | |
| `kind` | enum | | `identity` \| `key` \| `certificate` \| `touchid` \| `fido2` |
| `label` | varchar(80) | خیر | پیش‌فرض: username یا kind |
| `username` | varchar(120) | خیر | |
| `password` | EncryptedBlob | ✔ | حداکثر ۵۱۲ کاراکتر متن ساده |
| `privateKey` | EncryptedBlob | ✔ | حداکثر 32KB |
| `passphrase` | EncryptedBlob \| null | ✔ | فقط اگر `savePassphrase=true` باشد |
| `savePassphrase` | bool | | |
| `publicKey` | text(16000) | خیر | |
| `certificate` | text(32000) | خیر | |
| `keyType` | enum \| '' | | `ed25519` \| `ecdsa` \| `rsa` \| `ml-dsa` |
| `fingerprint` | varchar | خیر | **پیشنهادی**، برای نمایش |
| + فیلدهای sync | | | |

حداکثر ۲۰۰ مورد برای هر کاربر. کلیدهای `touchid` و `fido2` (سخت‌افزاری) فقط روی همان دستگاه معنی دارند و باید `deviceId` داشته باشند و روی دستگاه‌های دیگر فقط نمایش داده شوند. تولید کلید سمت کلاینت انجام می‌شود و سرور فقط نتیجه رمزشده را ذخیره می‌کند.

---

## ۸. Vault رمزها (تاریخچه تولیدکننده رمز)

### `VaultPassword` (همیشه personal)
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | |
| `secret` | EncryptedBlob | حداکثر ۲۵۶ کاراکتر |
| `label` | varchar(80) | **این هم پیشنهاد می‌شود رمز شود** |
| `kept` | bool | |
| `createdAt` | timestamptz | |

قوانین: حداکثر ۸۰ مورد. موارد `kept=false` حداکثر ۴۰ تا هستند و قدیمی‌ترها حذف می‌شوند. رمز تکراری اضافه نمی‌شود (چون سرور متن را نمی‌بیند، کلاینت باید یک HMAC از secret با کلید کاربر به نام `dedupeTag` بفرستد). خروجی CSV/TXT سمت کلاینت ساخته می‌شود.

---

## ۹. Known Hosts

### `KnownHost`
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | |
| `scope` | enum | `workspace` (برای اعتماد مشترک تیمی) \| `personal` |
| `workspaceId` / `userId` | uuid | |
| `hostKey` | varchar | کلید فعلی کلاینت (`host:port`، همان کلید `knownHosts`) |
| `fingerprint` | varchar | SHA256 |
| `keyType` | varchar | **پیشنهادی** |
| `addedBy` | uuid | |
| `addedAt` | timestamptz | |

یکتا روی (`scope`, `owner`, `hostKey`). وقتی fingerprint تغییر کند، به جای بازنویسی بی‌صدا باید رویداد ممیزی `hostkey-changed` ثبت شود.

---

## ۱۰. لاگ اتصال و ممیزی

### `ConnectionLog`
| فیلد | نوع | قید |
|---|---|---|
| `id` | uuid | کلاینت می‌سازد (برای ارسال idempotent) |
| `workspaceId` | uuid \| null | |
| `userId` | uuid | سرور از توکن پر می‌کند (به جای `userEmail` و `userName` کلاینت) |
| `deviceId` | uuid | |
| `startedAt` / `endedAt` | timestamptz | |
| `clientHost` | varchar(120) | |
| `clientIp` | varchar(64) | IP محلی که کلاینت گزارش داده |
| `remoteIp` | inet | IP درخواست که **سرور** ثبت می‌کند |
| `sessionId` | uuid \| null | null یعنی اتصال سریع (quick connect) |
| `hostLabel` | varchar(120) | |
| `protocol` | enum | |
| `username` | varchar(120) | |
| `saved` (`pinned`) | bool | شخصی است. پیشنهاد می‌شود جدا شود: `ConnectionLogPin(userId, logId)` |
| `endReason` | enum \| null | **پیشنهادی**: `ended` \| `lost` \| `error` |

قوانین: append-only (کاربر عادی نمی‌تواند لاگ دیگران را حذف کند، فقط pin خودش را تغییر می‌دهد یا از دید خودش پنهان می‌کند). کلاینت ۵۰۰ مورد نگه می‌دارد. نگه‌داری سمت سرور قابل تنظیم برای هر ورک‌اسپیس است (پیش‌فرض ۱۸۰ روز). API: `POST /v1/connection-logs/batch` و `GET /v1/connection-logs?workspaceId&userId&sessionId&from&to&cursor` (صفحه‌بندی cursor-based) و خروجی CSV برای owner.

### `AuditEvent` (ممیزی رویدادهای مدیریتی)
`id, workspaceId, actorId, deviceId, action, targetType, targetId, metadata jsonb, ip, at`.
Action ها: `session.create|update|delete`، `secret.read` (وقتی کلاینت secret نشست مشترک را برای اتصال باز می‌کند، به‌صورت اختیاری)، `member.invite|join|remove`، `folder.access.change`، `workspace.rekey`، `hostkey.add|change`، `login`، `login.failed`، `device.revoke`.

---

## ۱۱. تنظیمات

### `UserSettings` (همگام بین دستگاه‌ها، یک رکورد برای هر کاربر)
| فیلد | نوع | پیش‌فرض |
|---|---|---|
| `fontSize` | int | 13 |
| `fontFamily` | varchar | `Menlo, "SF Mono", ui-monospace, monospace` |
| `theme` | enum (`TERM_THEME_IDS`) | `mys` |
| `locale` | enum (`LOCALE_IDS`) | `fa` |
| `cursorBlink` | bool | true |
| `scrollback` | int | 10000 |
| `copyOnSelect` | bool | false |
| `pasteWarning` | bool | true |
| `highlightKeywords` | bool | true |
| `autoReconnect` | bool | true |
| `serverMonitor` | bool | true |
| + `revision`, `updatedAt` | | |

### تنظیمات فقط محلی (**به سرور نروند**)
`activeWorkspaceId`، `mode`، `openLocalOnStart`، `restoreTabs`، `autoUpdate`، `webgl`، `logAll`، `recordAll`، `windowBounds`، اندازه داک‌ها (`mys.dock.*`)، تب‌های باز (`mys.tabs.v1`)، `mys.sections`، `mys.files.follow`، `mys.scripts.collapsed`، تنظیمات سرورهای محلی (`mys.server.*`)، جفت‌های همگام‌سازی پوشه (`mys.sync.*`)، و **پیکربندی قفل برنامه (`lock`: salt/hash/minutes)**. هش رمز اصلی قفل نباید از دستگاه خارج شود.

> اگر سرور یک فیلد ناشناخته در تنظیمات گرفت، باید آن را نگه دارد (forward-compatible، با یک فیلد `extra jsonb`).

---

## ۱۲. تاریخچه دستورات

### `ShellHistoryEntry` (personal، اختیاری و پیش‌فرض خاموش)
`id, userId, command EncryptedBlob, dedupeTag (HMAC), lastUsedAt`. حداکثر ۲۰۰ مورد، تکراری‌ها به بالای لیست منتقل می‌شوند، هر دستور حداکثر ۵۰۰ کاراکتر. API برای پاک کردن کامل هم لازم است. چون ممکن است رمز داخل دستورها باشد، **رمزنگاری الزامی است**.

---

## ۱۳. ضبط جلسه و لاگ ترمینال (اختیاری، فقط با انتخاب کاربر)

### `Recording`
| فیلد | نوع | توضیح |
|---|---|---|
| `id` | uuid | |
| `userId`, `deviceId` | uuid | |
| `workspaceId` | uuid \| null | |
| `sessionId` | uuid \| null | |
| `title` | varchar | |
| `startedAt` | timestamptz | |
| `durationMs` | bigint | |
| `cols`, `rows` | int | |
| `size` | bigint | |
| `format` | enum | `asciicast-v2` (`.cast`) \| `text-log` (`.log`) |
| `storageKey` | text | کلید فایل در object storage |
| `encrypted` | bool | فایل باید سمت کلاینت رمز شود، چون خروجی ترمینال حساس است |
| `sharedWith` | enum | `private` \| `workspace` |

قابلیت‌ها: آپلود با presigned URL و multipart (فایل تا 64MB یا بیشتر)، لیست، دانلود، حذف، سهمیه حجم برای هر کاربر یا ورک‌اسپیس، و نگه‌داری خودکار (retention).

---

## ۱۴. همگام‌سازی (Sync Engine)

موجودیت‌های قابل sync:
`workspace, workspaceMember(read-only), folder, folderAccess, session, tunnelTemplate, sessionSecret, snippet, snippetPackage, keychainItem, vaultPassword, knownHost, userSettings, shellHistory`

| # | قابلیت | جزئیات |
|---|---|---|
| S1 | Pull | `GET /v1/sync/pull?cursor=<opaque>&limit=500` ← `{changes:[{entity, id, revision, deleted, data}], cursor, hasMore}`. فقط داده‌ای که کاربر اجازه دیدنش را دارد برمی‌گردد (ورک‌اسپیس‌ها و ACL پوشه). اگر دسترسی کاربر به چیزی گرفته شد، برای آن یک tombstone با `reason:"access-revoked"` فرستاده شود |
| S2 | Push | `POST /v1/sync/push {deviceId, changes:[{entity, id, op:"upsert"\|"delete", baseRevision, data}]}`. هر تغییر جداگانه اعتبارسنجی می‌شود (همان قیدهای `asSession`، `asFolder` و غیره). پاسخ: `{applied:[{id, revision}], conflicts:[{id, serverRevision, serverData}], rejected:[{id, code}]}` |
| S3 | کنترل همزمانی | اگر `baseRevision != revision فعلی` بود، تداخل است. سیاست پیشنهادی: ادغام در سطح فیلد (field-level LWW، با `updatedAt` هر فیلد) برای Session و Snippet، و رد کردن و برگرداندن نسخه سرور برای بقیه |
| S4 | Idempotency | هدر `Idempotency-Key` روی push و batch ها |
| S5 | اعلان زنده | WebSocket `wss://…/v1/realtime`: رویدادهای `sync.changed {cursor}`، `invitation.received`، `key-grant-needed`، `member.removed`، `device.revoked`، `session.locked-by` (اختیاری) |
| S6 | Snapshot اولیه | `GET /v1/sync/snapshot?workspaceId` برای دستگاه تازه |
| S7 | مهاجرت داده محلی | اولین بار که کاربر آنلاین می‌شود، کلاینت کل `sessions.json` (ورک‌اسپیس Personal، پوشه‌ها و نشست‌ها) و secret های رمزشده را push می‌کند. سرور باید ورک‌اسپیس محلی با `ownerEmail:''` را به کاربر فعلی منتسب کند |
| S8 | پاک‌سازی tombstone | بعد از ۹۰ روز. دستگاهی که cursor قدیمی‌تر دارد باید snapshot کامل بگیرد (`410 cursor-expired`) |

---

## ۱۵. به‌روزرسانی برنامه

`updater.ts` از `electron-updater` با provider `generic` استفاده می‌کند.

### `AppRelease`
`id, version (semver), channel (stable|beta), platform, arch, fileName, url, sha512, size, releaseNotes (per-locale jsonb), mandatory bool, minSupportedVersion, publishedAt, rolloutPercent`.

قابلیت‌ها:
- سرو کردن فایل‌های `latest-mac.yml`، `latest.yml` و `latest-linux.yml` روی FEED_URL
- rollout مرحله‌ای (با hash روی deviceId)
- `GET /v1/app/config` ← `{minVersion, googleClientId, features:{...}, smsEnabled}` (feature flags)

---

## ۱۶. اعلان‌ها و پیام‌رسانی

- **SMS:** OTP (رابط provider قابل تعویض، مثلاً Kavenegar یا Twilio)، قالب: `Mys Terminal Management: <code>`، چندزبانه
- **ایمیل:** دعوت ورک‌اسپیس، تأیید ایمیل، ورود از دستگاه تازه، تغییر رمز
- **`Notification`** (درون‌برنامه‌ای): `id, userId, type, payload jsonb, readAt, createdAt` و `GET /v1/notifications`

---

## ۱۷. نیازمندی‌های غیرعملکردی

| موضوع | نیازمندی |
|---|---|
| امنیت ارتباط | فقط TLS 1.2+. کلاینت می‌تواند certificate pinning داشته باشد |
| محدودیت نرخ | OTP: ۱ بار در ۳۰ ثانیه برای هر شماره، ۵ بار در ساعت برای هر شماره، ۲۰ بار در ساعت برای هر IP. Login: backoff نمایی. Lookup کاربر: ۳۰ بار در دقیقه |
| هش رمز | Argon2id (m=64MB, t=3) یا scrypt N=2^15 |
| توکن | Access JWT ده تا پانزده دقیقه‌ای با `sub`، `deviceId` و `sid`. Refresh چرخشی با تشخیص reuse |
| اعتبارسنجی | همه محدودیت طول‌ها و enum های این سند **سمت سرور هم** اعمال شوند. پیام خطا با کد ثابت |
| حریم خصوصی | سرور به هیچ متن ساده‌ای از secret ها، تاریخچه دستور و ضبط‌ها دسترسی ندارد. لاگ‌های سرور نباید بدنه درخواست‌های sync را ثبت کنند |
| چندزبانه | پیام‌های ایمیل و SMS بر اساس `User.locale` (۱۶ زبان، fa پیش‌فرض، پشتیبانی RTL در قالب ایمیل) |
| مقیاس | صفحه‌بندی cursor-based، ایندکس روی (`workspaceId`, `revision`) در همه جداول sync |
| پشتیبان‌گیری | بکاپ روزانه پایگاه داده، PITR، بازیابی حذف نرم تا ۳۰ روز |
| نسخه API | پیشوند `/v1`. کلاینت هدر `X-App-Version` و `X-Device-Id` می‌فرستد. سرور برای نسخه‌های قدیمی `426 upgrade-required` برمی‌گرداند |
| مستندات | OpenAPI 3.1 برای همه endpoint ها + تست یکپارچه |
| سهمیه‌ها | حداکثر نشست برای هر ورک‌اسپیس، حداکثر عضو، حجم ضبط‌ها (قابل تنظیم برای پلن‌های آینده) |

---

## ۱۸. خلاصه مدل‌ها

| مدل | دامنه | Sync | رمزشده |
|---|---|---|---|
| User | سراسری | – | فقط encryptedPrivateKey |
| AuthIdentity | کاربر | – | – |
| OtpChallenge, VerificationProof | موقت | – | هش |
| Device, RefreshToken | کاربر | – | هش |
| Workspace | ورک‌اسپیس | ✔ | – |
| WorkspaceMember | ورک‌اسپیس | فقط خواندنی | – |
| WorkspaceInvitation | ورک‌اسپیس | – | هش توکن |
| WorkspaceKeyGrant | ورک‌اسپیس/کاربر | ✔ | ✔ |
| Folder, FolderAccess | ورک‌اسپیس | ✔ | – |
| Session, TunnelTemplate | ورک‌اسپیس | ✔ | – |
| SessionSecret | ورک‌اسپیس/کاربر | ✔ | ✔ |
| DeviceSessionOverride | دستگاه | اختیاری | – |
| SessionUsageDaily, SessionErrorLog | کاربر×نشست | append | – |
| Snippet, SnippetPackage, SnippetUsage | کاربر/ورک‌اسپیس | ✔ | command محرمانه |
| KeychainItem | کاربر/ورک‌اسپیس | ✔ | ✔ (password, privateKey, passphrase) |
| VaultPassword | کاربر | ✔ | ✔ |
| KnownHost | ورک‌اسپیس/کاربر | ✔ | – |
| ConnectionLog, AuditEvent | ورک‌اسپیس | append | – |
| UserSettings | کاربر | ✔ | – |
| ShellHistoryEntry | کاربر | ✔ (اختیاری) | ✔ |
| Recording | کاربر/ورک‌اسپیس | فقط متادیتا | فایل ✔ |
| AppRelease | سراسری | – | – |
| Notification | کاربر | realtime | – |

## ۱۹. ترتیب پیشنهادی پیاده‌سازی

1. Auth (A1 تا A8) + Device + RefreshToken
2. Workspace + Member + Invitation (W1 تا W7)
3. Folder + Session + TunnelTemplate + Sync (S1 تا S4، S6، S7)
4. E2EE: کلید کاربر، KeyGrant، SessionSecret، Keychain، Vault، اسنیپت محرمانه
5. ACL پوشه + ConnectionLog + AuditEvent
6. Realtime (S5) + Notification + ایمیل
7. Usage stats، KnownHost مشترک، ShellHistory
8. Recording، AppRelease و feature flags
