# HANDOFF — читати першим у новій сесії

Останнє оновлення: **2026-09-13**, кінець Фази 6 + редизайн UI (поза фазами).
Код проєкту завершено.
**Лишились лише живі прогони A(перевірка)–E: квота вичерпана.**

## Що це за проєкт

Тестове завдання Codebridge. Продукт: користувач завантажує короткий скрінкаст
(MP4, ≤2 хв, один браузерний застосунок, одна операція, один голос) — на виході
**перевірена інструкція**: нумеровані кроки, таймкоди, скріншоти, і кожен крок
посилається на конкретний момент у відео.

Оцінювання: 80% реалізація (коректний флоу, складні входи, evidence, зміряні
швидкість/вартість, відтворюваність), 20% продуктове мислення. Бюджет ~8 годин.

Повна архітектура з усіма JSON-контрактами: **`docs/ARCHITECTURE.md`** — читати
перед написанням будь-якого модуля. Нижче — лише стан і найближча задача.

## Наріжний принцип, з якого все випливає

**Модель сприймає. Код вирішує.**

LLM відповідає на «що видно на екрані в цю секунду». Рішення «який шлях
рекомендувати» приймає детермінований TypeScript. Тому `reduce.ts` — не промпт,
а чисті функції під юніт-тестами без мережі.

Найважливіший наслідок: крок може народитись **лише** з події
`kind === "ui_action" && visible === true`. Подія `kind: "narration"` фізично не
має шляху до нумерованого списку. Вигадати клік неможливо не тому, що ми
попросили модель, а тому що в коді немає ребра графа.

## Пайплайн

```
MP4 → Ingestion → Observation [Gemini, video] → RawTimeline
    → Authoring Reduce [чистий TS, 0 запитів] → DraftGuide
    → Phrasing [Gemini, лише текст, id-to-id] → проза кроків
    → Grounding Check [ffmpeg кадри + Gemini, по 1 запиту на крок] → Verdict[]
    → Assembly → GuideDocument → UI (SSE) + Metrics
```

## Статус

### Фаза 1 — ЗАВЕРШЕНА ✅

- Каркас: `package.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), структура папок, `.env.example`, `.gitignore`
- `npm install` → 185 пакетів, 0 vulnerabilities. `npx tsc --noEmit` → exit 0
- `fixtures/demo-app/orders.html` — демо-апп, **перевірений у справжньому Chrome**
- `scripts/serve-demo-app.ts` — статичний сервер, щоб у кадрі був `localhost`
- `fixtures/ground-truth/RECORDING-SCRIPT.md` — сценарії A–E + передреєстровані
  очікування
- `git init` виконано, **комітів немає** (комітимо лише на прямий запит)

### Фаза 2 — ЗАВЕРШЕНА ✅ (таймлайн A прийнято користувачем 2026-09-13)

Написано:

- `src/schemas/timeline.ts` — zod-контракт + **рукописне дзеркало** Gemini
  `responseSchema`. `schema_version` свідомо не просимо в моделі: це наш конверт,
  модель віддає `ObservationPayload`, код додає версію
- `src/modules/ingestion.ts` — ворота (MIME / ≤100 МБ / ≤150 с), ffprobe,
  Files API → `ACTIVE`, `MediaAsset`. Бере локальний шлях: multipart → tmpdir це
  робота `server.ts` у Фазі 5
- `src/modules/observation.ts` — системний промпт, `fps: 1`,
  `MEDIA_RESOLUTION_HIGH`, `temperature: 0`, structured output
- `src/modules/gemini.ts` — створення клієнта + retry
- `src/types/ffprobe-static.d.ts` — у пакета немає типів
- `scripts/observe.ts` → `npm run observe -- fixtures/videos/A.mp4`

`fixtures/timelines/A.json` — 10 подій, integrity clean, збігається з
передреєстрованими очікуваннями RECORDING-SCRIPT по всіх п'яти пунктах.

### Фаза 3 — ЗАВЕРШЕНА ✅ (чернетка A прийнята 2026-09-13, усі 9 рішень затверджені)

- `src/config/thresholds.ts` — `minOperationConfidence: 0.35`,
  `narrationAttachWindowSec: 5`
- `src/schemas/draft.ts` — типи `DraftGuide` (+ `Verdict`, бо на нього
  посилається `DraftStep`). Zod тут свідомо немає: `DraftGuide` будує наш власний
  чистий код, парсер валідував би наш вихід проти наших же типів
- `src/modules/authoring/reduce.ts` — чисті функції, нуль I/O
- `tests/reduce.test.ts` — **26 тестів, усі проходять**, без мережі
- `scripts/reduce.ts` → `npm run reduce -- fixtures/timelines/A.json`

Результат на A: `status: ok`, 5 кроків, 1 discarded (Last 7 days → Last 30 days),
0 missing, 0 clarifications, 0 unverifiable, `has_success_state: true`.

### Агентська структура (2026-09-13, поза фазами)

- `CLAUDE.md` скорочено 76 → 43 рядки за інструкцією Anthropic: жорсткі правила
  пішли в хуки, довідковий матеріал — у скіли, дублювання з ARCHITECTURE/HANDOFF
  видалено. Emphasis витрачено рівно на два правила
- `.claude/hooks/guard.mjs` + `.claude/settings.json` — PreToolUse guard:
  запис у `RECORDING-SCRIPT.md` → **deny**, `git commit` / `git push` → **deny**
  (комітить користувач вручну), запис Gemini-model-id у будь-який файл під `src/`
  → **ask**. Читання ніде не блокується. Перевірено 19 payload-ами
- `.claude/skills/` — `phase-report`, `run-observation`, `ground-truth-check`,
  `schema-mirror`. Хук активний одразу, **скіли підхоплюються лише після
  рестарту сесії**

### Фаза 3b — ЗАВЕРШЕНА ✅ (текст A прийнято 2026-09-13)

- `src/schemas/draft.ts` доповнено: `PhrasedStep` / `PhrasedGuide` (тип-звуження,
  `instruction` більше не nullable) + `PhrasingResponseSchema` і рукописне
  Gemini-дзеркало `PHRASING_RESPONSE_SCHEMA`. **Нового `schema_version` немає** —
  phrasing заповнює вже наявне поле, форма не змінюється
- `src/modules/authoring/phrase.ts` — `gemini-3.7-flash`, `temperature: 0`,
  лише текст. Структурна гарантія у чистій функції `findStepMismatch`
- `tests/phrase.test.ts` — 7 тестів на гарантію, без мережі
- `scripts/phrase.ts` → `npm run phrase -- fixtures/timelines/A.json`

Зміряно на A (2026-09-13): 16.7 с, 3 виклики (2 transport-ретраї на 503,
0 структурних), **in 670 / out 106** токенів. За list price 3.8-flash це
$0.0009 проти передреєстрованих $0.004 на Phrasing.

### Фаза 4 — ЗАВЕРШЕНА ✅ (прийнято 2026-09-13, усі 6 відступів затверджені)

- `src/modules/frames.ts` — `ffmpeg-static`, `-ss` перед `-i`, `scale=min(1280,iw)`,
  два PNG на крок (`screenshot_t` → shot, `t_end` → after). Чиста
  `planFramePairs()` окремо від I/O
- `src/modules/grounding.ts` — по одному ізольованому запиту на крок,
  `MEDIA_RESOLUTION_HIGH`, inline PNG, `temperature: 0`. Чисті `summariseVerdicts()`
  і `verdictCacheKey()`
- `src/modules/verdict-cache.ts` — `fixtures/verdicts/<video>.json`, ключ = sha256
  від байтів обох кадрів + instruction + модель
- `src/schemas/draft.ts` — `GroundingResponseSchema` + дзеркало;
  **`Verdict.unavailable_reason`** додано (розрізняє «модель не певна» і «ми не питали»)
- `src/modules/ingestion.ts` — `probe()` → експортована `probeVideo()`
- `tests/frames.test.ts`, `tests/grounding.test.ts` — усього **48 тестів**
- раннер стадії (згодом переріс у `scripts/guide.ts`, див. Фазу 5)

Зміряно на A (2026-09-13): frames 2.1 с / 10 PNG / 1.0 МБ; grounding 88.7 с,
11 викликів (6 ретраїв на 503/429), **in 11 828 / out 289**, тобто
**~2 366 вхідних токенів на верифікацію** — у 4.6× більше за передреєстровані
«2 зображення ≈ 516 токенів». Другий прогін: **0 викликів**, усе з кешу.

#### ❗ Розбіжність із передреєстрованим очікуванням A

Очікувалось `verified_ratio: 1.0`, отримано **0.80**: крок 4 (чекбокс
«Include customer email») → **`contradicted`**.

**Grounding має рацію, помилка вище за течією.** Перевірено очима по кадрах:
на 31 с і 32 с чекбокс не позначений, курсор лише підведений; на 36 с він уже
позначений. Тобто дія відбулась, але **пізніше** за `t_end: 32`, який дала
Observation. Це не баг верифікації — це перша знайдена помилка таймкодів, і
знайшов її саме Grounding.

`RECORDING-SCRIPT.md` **не редагується** (і заблокований хуком). Факт іде в
`DELIVERY_NOTES.md` як є.

**Рішення користувача (2026-09-13): варіант (б)** — правити промпт Observation,
а не підганяти кадри. У блок `TIMESTAMPS` додано вимогу буфера 1–2 с до `t_end`
(поправка внесена і в `ARCHITECTURE.md`). **Перепрогін A ще не виконаний** —
див. блокер нижче.

### Фаза 5 — ЗАВЕРШЕНА ✅ (прийнято 2026-09-13, усі 9 рішень затверджені)

- `src/schemas/guide.ts` — `GuideDocument` / `FinalStep`. **Поля `metrics` немає:**
  `RunMetrics` визначає `metrics.ts` у Фазі 6, а тип, який ніхто не заповнює, —
  це саме той спекулятивний артефакт, якого ми уникаємо
- `src/modules/assemble.ts` — чисті функції; тут **уперше** виконується повна
  сходинка статусів, бо `verified_ratio` раніше просто не існує
- `src/modules/markdown.ts` — рендер у Markdown: бейджі верифікації, скріншоти,
  прогалини всередині потоку кроків, `<details>` для доказів і покинутих спроб
- `src/config/thresholds.ts` — додано `minVerifiedRatio: 0.6` (тепер має споживача)
- `tests/assemble.test.ts` — сходинка статусів + рендер, усього **66 тестів**
- `scripts/guide.ts` → `npm run guide -- fixtures/videos/A.mp4`.
  **`scripts/ground.ts` перейменовано в `guide.ts`**, бо скрипт тепер робить
  увесь ланцюг і віддає готовий документ

Результат на A (на кешах, 0 запитів): `ok_with_warnings`, `verified_ratio 0.80`,
Markdown у `fixtures/guides/A.md`.

### ⛔ БЛОКЕР: добова квота `gemini-3.7-flash` вичерпана

`GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit 20` — вичерпано
2026-09-13 на перепрогоні Observation. Скидається опівночі за тихоокеанським
часом (~10:00 за Києвом).

**Не перемикати модель самовільно** (і хук усе одно спитає). За робочою угодою —
стоп і питання про білінг. Незавершене:

1. Перепрогін Observation для A з новим промптом (1 запит)
2. Phrasing на оновленому таймлайні (1 запит)
3. Grounding 5 кроків — кеш промахнеться, бо кадри зміняться (5 запитів)

Разом ~7 запитів, щоб отримати очікуваний `verified_ratio: 1.0`.

### Фаза 6 — НАПИСАНА, чекає на приймання

- `src/config/pricing.ts` — прайс із джерелом і датою на кожному рядку.
  У `gemini-3.7-flash` поле `basis` прямо каже, що ставка позичена в 3.8-flash
- `src/modules/metrics.ts` — `StageMetric` / `RunMetrics`, збір **на кожній
  стадії**, а не підсумком. До архітектурного переліку стадій додано `reduce` і
  `frames`: токенів не палять, але палять час, а бриф міряє і швидкість
- **`src/pipeline.ts`** — увесь ланцюг в одному місці; CLI і сервер — тонкі
  обгортки над ним. Дві копії пайплайну розійшлися б
- `src/server.ts` — Express, статика + `POST /api/process` зі **справжнім SSE**
  (multipart всередину, `text/event-stream` назад). Звичайний Node, не
  serverless: один запит живе 30–60 с
- `public/index.html` / `app.js` / `styles.css` — upload → прогрес по стадіях →
  результат із бейджами, скріншотами, чіпами таймкодів (клік → seek у `<video>`),
  панеллю метрик і копіюванням Markdown
- `scripts/guide.ts` — переписаний поверх `pipeline.ts`
- `tests/metrics.test.ts` — усього **76 тестів**
- `DELIVERY_NOTES.md` — повна структура; `TBD` там, де прогону ще не було

Перевірено без жодного запиту до API: CLI на кешах A (0 викликів, 4.0 с),
сервер на вільному порту — `/api/health`, статика, кадри, SSE-потік і типізована
помилка `unsupported_file_type` із прибиранням тимчасового файлу.

**Порт 3000 на цій машині зайнятий стороннім Next.js-застосунком** — для
перевірки використовував `PORT=3177`.

### Редизайн UI (2026-09-13, поза фазами)

Преміальний редизайн на **чистому vanilla CSS** — «zero build step» лишився
недоторканим: ні Tailwind, ні препроцесора, ні PostCSS.

Змінено рівно три файли:

- `public/styles.css` — переписаний (4.7 КБ → 43 КБ, один звичайний файл)
- `public/index.html` — **тільки `<head>`**: preconnect + Google Fonts (Inter,
  JetBrains Mono, `display=swap`) і `<meta name="theme-color">`
- `DELIVERY_NOTES.md` — абзац «A deliberately plain UI» переписано: відмовились
  від *фреймворку*, а не від дизайну; плюс уточнення до секції про `.gap`

`public/app.js` не чіпався взагалі. **md5 всього `<body>` в `index.html`
збігається до і після редизайну: `ba9861f409dcf3b018c4866242b3ccb9`** — це і є
доказ, що DOM-контракт цілий.

Дизайн-система (з `ui-ux-pro-max`): база **Refined Minimalism**
(`minimalism-and-swiss-style`, єдиний із `risk:low` + обидві теми), скло —
**лише** на дрібних плаваючих контролах (чипи, бейджі: датасет дає glassmorphism
`risk:conditional`). **Soft UI / Neumorphism відкинуто** — `risk:high`, dark
лише `conditional`. Палітра `API Developer Portal`, типографіка
`Modern Dark Cinema` (Inter + JetBrains Mono на всі цифри). Три свідомі відступи
від датасету: тіні всупереч `--shadow: none` мінімалізму; **зелений НЕ став
CTA** (він означає *verified*, інтеракція — синій `#2563eb→#1d4ed8`); light —
окремо підібрані токени, не інверсія.

Архітектура файла: `@layer tokens, base, layout, components, states, motion,
responsive` — порядок оголошено один раз, тож жодне правило не потребує
`!important`, щоб перебити інше. Токени тришарові: primitive → semantic →
component. Іконки — Lucide, вбудовані як `mask-image` data-URI, тому беруть
`currentColor` і не коштують жодного запиту.

**Рейка прогресу читає стан із того, що `app.js` уже пише** — жодного нового
класу: готова стадія це `li:has(.time:not(:empty))`, а ретрай — єдиний момент,
коли рядок ще `.running`, а `.detail` вже має текст. П'ять станів із наявного DOM.

#### Виправлено чотири реальні дефекти (не косметика)

1. **`#file` був недосяжний із клавіатури.** Атрибут `hidden` → `display:none` →
   інпут поза tab-порядком, тобто вибір файлу з клавіатури був неможливий
   взагалі. Авторський CSS б'є UA-правило: інпут повернуто як фокусований
   прозорий піксель із `pointer-events:none`, кільце малює `.dropzone:focus-within`
2. **Ніде не було `:focus-visible`** — при тому, що головні контроли це `<label>`,
   чип-кнопки і `<summary>`
3. **CTA провалював AA:** білий на верхньому стопі градієнта `#3b82f6` = **3.68:1**.
   Плюс `<button>` має непрозорий UA-`buttonface`, а задано було лише
   `background-image` — при втраті градієнта лейбл став би білим на світло-сірому.
   Тепер стопи `#2563eb → #1d4ed8` (5.17 і 6.70) + явний `background-color`
4. **Респонсив лежав у `@layer layout`**, який програє `components` — майже весь
   мобільний блок був мертвий. Додано шар `responsive` останнім

Також прибрано `background-attachment: fixed` на користь фіксованого
псевдошару (`body::before`): на сторінці ~6130 px це перемальовування градієнта
на кожен скрол.

`--ease-spring` (`cubic-bezier(0.32, 1.5, 0.5, 1)`) видалено після зауваження
хука `impeccable`: overshoot суперечив і Refined Minimalism, і власному
попередженню датасету («reads as sloppy on informational UI»). Один
`--ease-out` на всю сторінку. Зауваження `overused-font: inter` придушене
найвужчим `ignore-value` у `.impeccable/config.json` — шрифт затверджений
користувачем.

## Робоча угода з користувачем

- Строго фаза за фазою. Не генерувати код наперед, навіть якщо «очевидно далі»
- Чиста кодова база: **жодних штучних умов і прихованих милиць**, ніяких
  захардкоджених відповідей під демо-файли
- Після кожної фази — стоп і звіт
- Мова спілкування: українська. Мова коду, UI, гайда й delivery notes: англійська

## Перевірені факти (НЕ переприймати з пам'яті, вони вже звірені)

Gemini pricing — джерело https://ai.google.dev/gemini-api/docs/pricing, звірено 2026-09-12:

- `gemini-3.8-flash`: **$0.75/1M вхід, $3.75/1M вихід** (до 31.12.2026), відео
  приймає, free tier є
- Відео-токени: ~100 tok/сек при `media_resolution: low`, **~300 tok/сек при
  high** (1 FPS × 258 tok/кадр + 32 tok/сек аудіо). Для скрінкастів потрібен
  **high**, інакше не читається текст в UI
- Таймкоди модель віддає у `MM:SS` — точність 1 секунда. Саме тому в схемі є
  окремий `screenshot_t` і по два кадри на крок
- Files API: 2 ГБ на free tier, inline до 100 МБ
- Керовані параметри static mode: `fps`, `media_resolution`, `start_offset/end_offset`

Передреєстрована оцінка вартості: **~$0.05 за 2-хв відео** (Observation ~$0.036,
Phrasing ~$0.004, Grounding ~$0.010). Це list price, який у `DELIVERY_NOTES.md`
замінять зміряні цифри. Free tier ≠ нульова собівартість — бриф це прямо ловить.

API-ключ: Google AI Studio (у користувача є), кладеться в `.env` як
`GEMINI_API_KEY`. Anthropic API не потрібен і не заводився. Підписки Claude Pro /
Gemini Pro — це чат, не API, на реалізацію не впливають.

### Зміряно на живих прогонах 2026-09-13 (Фаза 2)

- **Free tier має добовий ліміт `GenerateRequestsPerDayPerProjectPerModel`:
  20 запитів на модель на добу.** Невдалі `503` теж його з'їдають. Квота
  `gemini-3.8-flash` була вичерпана під час діагностики 503-ів
- **Робоча модель зараз — `gemini-3.7-flash`** (рішення користувача: доїсти її
  безкоштовну квоту; коли скінчиться — **стоп і питати про білінг**, не
  перемикатись самовільно). Її pricing ще НЕ звірений — зробити у Фазі 6
- A.mp4: 44.2 с, 1920×1032, **7.00 fps** (Game DVR пише VFR, номінальні 29.97 —
  неправда; тому `ingestion.ts` бере `avg_frame_rate`)
- Прогін A: ingestion 7.1 с, observation 8.6 с, **in 13 435 / out 1 593** токенів
- `in ≈ 288 tok/с × 44.2 с` — це **підтверджує, що `MEDIA_RESOLUTION_HIGH` реально
  застосувався**; на LOW було б ~4 400. Тобто передреєстровані ~300 tok/с зійшлись
- За list price 3.8-flash це $0.0152 за 44 с ⇒ ~$0.039 екстрапольовано на 2 хв,
  проти передреєстрованих $0.036 для Observation

### Поправка до ARCHITECTURE.md від 2026-09-13

У системний промпт Observation додано блок **`STATE`**: після дії, що змінює
вміст таблиці, модель зобов'язана віддати `ui_state` з видимим лічильником
(«Showing 4 of 12»). Причина: у першому таймлайні A не було **жодного**
`ui_state` — кліки є, наслідку немає. Саме це число робить помилку
спостережуваною і саме його має зчитувати Grounding. Після поправки
`ui_state` з'явились (6 → 2 → 4 of 12).

### Звірено під час редизайну UI 2026-09-13

- **Тести не залежать від `public/`.** Усі 6 наборів у `tests/` — чистий
  Node/vitest проти модулів `src/`. Жоден не вантажить jsdom, HTML чи CSS.
  Єдина згадка `public/` у всьому наборі — це рядок-**шлях** в
  `assemble.test.ts:210` (`imageBasePath: '../../public/'`). Отже правки в
  `public/*.css` фізично не можуть зламати 76 тестів; ганяти їх варто як доказ,
  а не як страховку
- **`src/server.ts:89` викликає `runPipeline` БЕЗ кешів** (на відміну від
  `scripts/guide.ts`, який підкладає timeline / phrased / verdictCache з
  `fixtures/`). Тому **справжній аплоад через UI спалить ~7 запитів до Gemini**.
  При вичерпаній квоті це просто впаде 429 — не перевіряти UI завантаженням файлу
- **Як дивитись UI з нульовою квотою** (рецепт перевірений):
  1. `npm run guide -- fixtures/videos/A.mp4 --json` — 0 викликів, ~2.2 с на
     кешах, друкує `{document, metrics}` у stdout (перші два рядки — банер npm)
  2. `PORT=3177 npm run dev`, відкрити сторінку
  3. **після** завантаження підмінити `window.fetch` — `app.js` бере глобальний
     `fetch` у момент виклику — і віддати збережений payload як SSE-потік
     (`data: {...}\n\n`). Рендер іде справжнім шляхом `renderSummary` /
     `renderSteps` / `renderMetrics`, нічого не вивантажується
  4. Стани, яких немає в A (`.gap`, `needs_clarification`, `declined`,
     `#failure`, `running`/`skipped`/retry), перевіряти інʼєкцією тієї ж розмітки
     в живу сторінку з консолі
- **Контраст зміряно, не оцінено на око**, у ОБОХ темах, з композитингом
  напівпрозорих шарів: **жодного провалу, мінімум 4.98:1** при цілі 4.5:1
- Вікно Chrome у цій сесії **не зменшується** нижче ~1568 px. Вузькі ширини
  перевіряти в same-origin `<iframe width="375">` — медіазапити всередині
  рахуються від вьюпорта фрейма. Так перевірено: 0 горизонтального скролу на
  365 px, таблиця метрик скролиться сама в собі
- Усі 4 `@keyframes` лежать усередині `prefers-reduced-motion: no-preference` —
  звірено обходом CSSOM, а не читанням файла

### Безпека

`.env.example` містив **живий API-ключ**, ідентичний тому, що в `.env`, і цей
файл не в `.gitignore`. Замінено на плейсхолдер 2026-09-13.
**Ключ треба ротувати** — він уже побував у файлі, призначеному для публічного репо.

## Перевірені числа демо-аппа (Chrome, 2026-09-12)

| Status | Date range | Рядків |
|---|---|---|
| All | All time | 12 |
| Shipped | All time | 6 |
| Shipped | Last 7 days | **2** |
| Shipped | Last 30 days | **4** |
| Pending | All time | 4 |
| Pending | Last 30 days | **3** |
| Cancelled | All time | 2 |

Дати генеруються як зсуви в днях від «сьогодні», тому числа не залежать від дати
запису. Кожна зміна фільтра рухає видиме число `Showing N of 12` — саме це робить
виправлену помилку спостережуваною.

Експорт перевірено перехопленням Blob:
- чекбокс OFF → `Order ID,Customer,Date,Status,Total`
- чекбокс ON → `Order ID,Customer,**Email**,Date,Status,Total`

Тобто тиха дія має об'єктивний наслідок, а банер успіху друкує список колонок
**на екран** — цей текст читає Grounding з кадру.

## Тестовий набір

| # | Відео | Перевіряє | Очікуваний статус |
|---|---|---|---|
| A | Норма: Shipped → помилково Last 7 → виправлення на Last 30 → тихо тикається чекбокс → Export | базовий флоу, тиха дія, виправлення, успіх | `ok` |
| B | Pending + Last 30, фільтри в іншому порядку | regression-чек | `ok` |
| C | A з вирізаною серединою | flag a missing critical step | `needs_clarification` |
| D | Голос «Shipped», екран Pending | not merely summarizing speech | `needs_clarification` |
| E | Export + Mark shipped = дві операції | повна відмова | `declined` |

Повні сценарії й критерії провалу: `fixtures/ground-truth/RECORDING-SCRIPT.md`.
**Цей файл не редагується після першого прогону** — інакше «expected» стає
переписаним «actual» і доказова частина знецінюється. Фактичні результати йдуть
у `DELIVERY_NOTES.md`.

## Команди

```bash
npm run demo-app     # демо-апп на http://localhost:4173/
npm run observe -- fixtures/videos/A.mp4      # Ingestion + Observation, пише fixtures/timelines/A.json
npm run reduce  -- fixtures/timelines/A.json  # Authoring Reduce, без мережі й без ключа
npm run phrase  -- fixtures/timelines/A.json  # Reduce + Phrasing, 1 запит до Gemini
npm run guide   -- fixtures/videos/A.mp4      # увесь ланцюг → fixtures/guides/A.md; --refresh ігнорує кеші
npm run dev          # сервер на :3000 (PORT= щоб змінити); upload + SSE
npm test             # vitest — 76 тестів, проходять
npx tsc --noEmit     # typecheck, зараз проходить
```

## Що ріжеться першим, якщо час закінчується

Деплой → export у Markdown → відео B. **Grounding не ріжеться ніколи** — без
нього зникає сенс усієї заявки.
