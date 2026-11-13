# ساختار Mys Terminal

Electron workstation شبیه MobaXterm در `/Volumes/MYsData/Projects/MysTerminal/mys-terminal-electron`.

## پشته

- electron-vite 5 + Electron 44 + Vite 6 + React 18 + TypeScript
- main و preload خروجی CJS در `out/`
- `"main": "./out/main/index.js"` — بدون `"type": "module"`
- رندرر: `src/renderer` با HMR؛ main معمولاً روی این دیسک داغ ری‌لود نمی‌شود

اجرا: `npm run dev`  
نوع‌سنجی: `npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit`

## درخت سورس

```
src/
  main/          فرآیند اصلی
    index.ts     پنجره، منو، IPC
    hub.ts       باز کردن پروتکل‌ها و اتصال زنده
    live.ts      وضعیت اتصال (pty, ssh, ftp, s3)
    files.ts     مرورگر فایل (local / sftp / ftp / s3)
    s3.ts        AWS Signature V4 و عملیات باکت
    auth.ts      حساب محلی، OTP، Google PKCE، scrypt
    store.ts     نشست‌ها و اسرار
    tunnels.ts   تونل SSH
    tools.ts     ping / traceroute / DNS / whois / ports / WOL
    which.ts     تشخیص باینری‌ها
    i18n.ts      ترجمه در main
  preload/index.ts
  shared/
    types.ts     Protocol، Session، OpenSpec، Account
    api.ts       قرارداد IPC رندرر
    i18n/        en منبع نوع Messages است؛ همه localeها همه کلید را دارند
  renderer/src/
    App.tsx      نوار بالا، داک چپ، Workspace، دیالوگ‌ها
    model.tsx    وضعیت سراسری
    layout.ts    تب و split
    themes.ts    ۲۵ تم؛ Iran Dark = iran
    components/  Sidebar, Workspace, TerminalView, FilePanel,
                 RightPanel, SessionDialog, LoginDialog, PasswordGen,
                 DockResize, LanguagePicker
```

## پروتکل‌ها

`local` `ssh` `sftp` `mosh` `telnet` `raw` `ftp` `s3` `serial` `rdp` `vnc` `browser`

- ترمینال: local, ssh, telnet, raw, serial, mosh
- فقط فایل (بدنه پر): sftp, ftp, s3
- داک راست مشترک: ssh و local

S3: host = باکت، domain = منطقه، username = access key، password = secret، url = endpoint اختیاری.

## داک‌ها

- چپ: نشست‌ها — `localStorage mys.dock.start` پیش‌فرض ۳۰۰، بازه ۲۲۰–۷۲۰
- راست: فایل‌ها — `mys.dock.end` پیش‌فرض ۳۴۰
- دستگیره مثلثی نیست؛ درگ لبه داخلی، RTL-aware

## حساب

`userData/auth.json`. OTP شش رقمی، ۵ دقیقه. بدون `MYS_SMS_URL` کد با Notification مک می‌آید نه SMS. Google به Client ID دسکتاپ نیاز دارد.

## i18n

`en.ts` با `as const` منبع نوع است. de-AT از de و pt-BR از pt ارث می‌برند. کلید جدید باید در همه localeها باشد.
