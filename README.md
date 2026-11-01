# FocusLens

Rasmlar asosida yaratilgan, kamerali diqqat yordamchisi. Windows 10/11 x64 uchun mustaqil ilova; Next.js, React va Electron asosida. Interfeys o‘zbekcha va inglizcha.

## O‘rnatish

`release/FocusLens-Setup-1.0.0-x64.exe` faylini oching. O‘rnatish papkasini tanlang va **Install** tugmasini bosing. Administrator huquqi talab qilinmaydi. Ish stoli yoki Start menyusidan **FocusLens** ni oching. O‘rnatilgandan keyin Node.js, Python yoki qo‘shimcha kutubxona o‘rnatish kerak emas.

Bu shaxsiy build raqamli sertifikat bilan imzolanmagan. Windows nashriyotchisi tekshirilmagan deb ko‘rsatishi mumkin. `release/SHA256SUMS.txt` fayli yakuniy paketning nazorat summasini beradi.

## Foydalanish

1. Boshlash yo‘riqnomasidan o‘ting yoki kamera ishlatmasdan davom eting.
2. Kamerani o‘zingiz yoqing. Yuzingizni markazga joylashtiring; yorug‘lik yaxshi bo‘lsin. Kalibrlash uchun kamida 20 soniya sifatli namuna kerak. Kamera ruxsati rad etilsa, taymer kamera bo‘lmagan rejimda ishlashda davom etadi.
3. **Pomodoro**, **Chuqur ish** yoki **Maxsus** vaqtni tanlang. Boshlash, pauza va qayta boshlash tugmalari mavjud. Qisqa/uzoq tanaffuslar hamda avtomatik davom ettirish Sozlamalarda belgilanadi.
4. Umumiy ko‘rinish, Statistika va Yutuqlardagi ko‘rsatkichlar haqiqiy sessiyalardan hisoblanadi. Birinchi ochishda soxta statistika bo‘lmaydi.
5. Sozlamalarda JSON zaxirasini eksport/import qilish mumkin. Import mavjud tarixni almashtiradi; avval eksport qiling.

Kamera yoqilmaganida sahifa faolligi qayd etiladi, insonning haqiqiy diqqat holati o‘lchanmaydi. Kamera ishlayotganida ham yuz mavjudligi, bosh yo‘nalishi va ko‘z ochiqligi taxminiy signallardir; ilova fikr, hissiyot yoki tibbiy holatni aniqlamaydi. Boshqa brauzerda ochilgan saytni ish stoli ilovasi ko‘ra olmaydi. Yomon yorug‘lik, ko‘zoynak, yuzning yopilishi va kamera joylashuvi aniqlikka ta’sir qiladi.

## DeepSeek

Sozlamalarning AI bo‘limida shaxsiy DeepSeek API kalitini kiriting. Kalit Windows himoyalangan xotira mexanizmi bilan shifrlanadi; interfeysga qaytarilmaydi, IndexedDB yoki eksport fayliga yozilmaydi. Bo‘sh kalitni saqlash kalitni o‘chiradi.

DeepSeek **API mutlaqo bepul emas**; foydalanish tokenlar bo‘yicha to‘lanadi. Tarif va API kalitini rasmiy manbadan tekshiring:

- https://api-docs.deepseek.com/quick_start/pricing/
- https://platform.deepseek.com/

AI so‘rovi faqat foydalanuvchi yordamchini ishga tushirganda yuboriladi. Yuboriladigan ma’lumot — savolingiz va tanlangan davrning raqamli umumiy ko‘rsatkichlari. Kamera tasviri, video, biometrik identifikator yoki batafsil hodisalar yuborilmaydi. Model: `deepseek-flash` (2026-10-13 rasmiy hujjatiga muvofiq). Kalitsiz rejim mahalliy qoidalarga asoslangan tavsiyalar beradi; bu DeepSeek javobi sifatida ko‘rsatilmaydi. Internet yoki balans bo‘lmasa ilovaning asosiy funksiyalari ishlayveradi.

## Maxfiylik va saqlash

- OpenCV.js va MediaPipe Face Landmarker maxsus Web Worker ichida qurilmada ishlaydi. Barcha modellar setup ichiga kiritiladi.
- Kamera kadrlari faqat tahlil qilish uchun operativ xotirada saqlanadi, keyin tashlanadi. Video yozish/yuklash funksiyasi yo‘q.
- Sessiyalar, holat davomiyliklari, yutuqlar va sozlamalar IndexedDB orqali mahalliy saqlanadi. Asosiy papka Windows `%APPDATA%/FocusLens` (Electron foydalanuvchi profili).
- Ilova qayta ochilishida taymer pauzada tiklanadi. Saqlanmagan oxirgi 5 soniyagacha ma’lumot favqulodda yopilishda yo‘qolishi mumkin.
- Ilovani oddiy o‘chirishda tarix saqlanadi. Zaxira eksporti API kalitini o‘z ichiga olmaydi.
- Ish stoli interfeysining tarmoq kirishi cheklangan. DeepSeek bilan aloqa faqat Electron asosiy jarayonidan HTTPS orqali bajariladi.

## Saytlarni bloklash kengaytmasi

Ixtiyoriy Chrome/Edge Manifest V3 kengaytmasi `extension/` ichida va o‘rnatilgan ilovaning `resources/browser-extension/` papkasida. Brauzer Extensions sahifasida Developer mode → Load unpacked orqali shu papkani tanlang. Kengaytma tugmasidan bloklashni yoqing/o‘chiring. Bu mustaqil boshqariladi; desktop taymeri yoki blocklist bilan avtomatik sinxronizatsiya yo‘q. Desktopdagi ro‘yxat o‘zi saytlarni bloklamaydi. Kengaytma brauzer tarixini saqlamaydi/yubormaydi.

## Source / Development

Node.js 22+ (build used Node 24), Windows x64. Dependencies are pinned by `package-lock.json`.

```powershell
npm ci
node scripts/prepare-vision.mjs
npm run dev
```

Local preview: http://127.0.0.1:3000. Browser camera access needs a secure context (localhost or HTTPS). The desktop DeepSeek key bridge is deliberately unavailable in a normal browser.

```powershell
npm run typecheck
npm test
npm run build
npm run desktop
npm run package:win
```

`npm run build` creates an offline static export and manifest. `npm run preview` serves the built PWA at http://127.0.0.1:4173. The browser PWA precaches local assets after its first complete load; the installed Windows app reads packaged assets directly and needs no HTTP server. Desktop runtime and compiler downloads are needed at build time only.

Camera runtime integration test: `node tests/vision-runtime.cjs` (requires installed Chrome/Edge). Desktop integration test: `npm run test:desktop` after build. Browser/PWA test: `node tests/pwa-runtime.cjs`. Automated tests use a separate local profile; they do not read the user's camera or existing app data.

Camera detection was verified against a public-domain portrait and blank frames; native capture was tested with Chromium's synthetic camera. Real webcam hardware and accuracy across users or lighting require calibration on the target computer. A live paid DeepSeek request was not tested because no user API key was provided; local advice, the desktop API bridge, aggregate filtering and encrypted key storage were tested.

## Architecture

- `app/`, `components/`: six reference screens, shared sidebar, bilingual controls.
- `lib/`: session engine, Dexie persistence, analytics, achievements, camera lifecycle.
- `public/workers/`: OpenCV preprocessing plus face landmark inference and smoothed state estimation.
- `public/vision/`: bundled WASM, OpenCV runtime and model with SHA-256 manifest.
- `electron/`: restricted desktop window, secure static protocol, encrypted API key store and HTTPS AI client.
- `extension/`: optional independently controlled website blocker.

UI uses current Next.js 16 with a static export instead of the attachment's older Next.js 14. Camera processing includes the explicitly requested OpenCV.js and MediaPipe for facial landmarks. Model inference runs at up to about 5 Hz on 640px frames to reduce CPU load; the camera preview can still display smoothly. The requested CPU target cannot be guaranteed for every laptop.

## Licenses

OpenCV and MediaPipe use Apache-2.0 terms; Electron and Next.js use MIT; bundled packages retain applicable license notices. Model source and checksum are recorded in `public/vision/manifest.json`. This project includes no private API key or cloud video pipeline.
