# Screencast → How-To: архітектура та контракти

## Context

Тестове завдання: користувач завантажує короткий скрінкаст однієї операції в браузерному
застосунку — продукт видає готову інструкцію з нумерованими кроками, таймкодами та
скріншотами. Ключова складність не в генерації тексту, а в **доказовості**: бриф прямо
оцінює «recover visible steps rather than merely summarizing speech», «do not invent clicks»,
«remove abandoned mistakes while preserving final settings», «flag a missing critical step».

Порожня папка `D:\Codebridge_test_task`, новий проєкт. Затверджено на брейнштормі:

| Рішення | Значення |
|---|---|
| Провайдер | Gemini API (ключ з Google AI Studio, free tier) |
| Підхід | Три проходи: Observation → Authoring → Grounding check |
| Демо-апп | Власний міні-апп Orders (в репо) |
| Мова | Англійська всюди |
| Доставка | Деплой на безкоштовний хост + локальний запуск |
| Бюджет | до 8 робочих годин |

Мета архітектури: зробити так, щоб «ми не вигадуємо кліки» було **перевіреним фактом
з артефактом**, а не обіцянкою в промпті.

---

## Наріжний принцип

**Модель сприймає. Код вирішує.**

LLM добре відповідає на «що видно на екрані в цю секунду». LLM погано і невідтворювано
відповідає на «який шлях рекомендувати». Тому:

- **Observation** (LLM) — лише спостереження, жодного гайда, жодної прози.
- **Authoring reduce** (чистий TypeScript) — відсікання помилкових гілок, прапорці
  прогалин, рішення про відмову. Без API. Покрито юніт-тестами.
- **Phrasing** (LLM) — лише формулювання вже зафіксованих кодом кроків. Структурно
  не може додати крок.
- **Grounding** (LLM + ffmpeg) — перевірка кожного кроку проти реального кадру.

Наслідок: головна логіка продукту тестується детерміновано, без витрат і без мережі.
Це прямо закриває критерій reproducibility.

---

## Data Flow

```
  MP4 (≤2 хв, ≤100 МБ)
        │
        ▼
┌───────────────────┐
│ 1. Ingestion      │  валідація, ffprobe → duration/fps/резолюція
│   ingestion.ts    │  Files API upload → file_uri, очікування ACTIVE
└─────────┬─────────┘
          │  MediaAsset
          ▼
┌───────────────────┐
│ 2. Observation    │  1 запит: video + system prompt
│   observation.ts  │  media_resolution: HIGH, fps: 1, static mode
└─────────┬─────────┘  responseSchema → строгий JSON
          │  RawTimeline          ← сирі події, БЕЗ гайда
          ▼
┌───────────────────┐
│ 3a. Reduce        │  ЧИСТИЙ КОД, 0 запитів, 0 витрат
│   authoring/      │  • транзитивне відсікання superseded
│   reduce.ts       │  • visible=false → ніколи не крок
└─────────┬─────────┘  • gap → missing_step warning
          │  DraftGuide           • contradiction → clarification
          ▼                       • abstain-правила
┌───────────────────┐
│ 3b. Phrasing      │  1 запит, лише текст. Вхід: зафіксований
│   authoring/      │  список id. Вихід: рівно N речень, id-to-id.
│   phrase.ts       │  Невідповідність id/кількості → retry → fail
└─────────┬─────────┘
          │  DraftGuide + prose
          ▼
┌───────────────────┐
│ 4. Grounding      │  ffmpeg -ss → PNG на screenshot_t та t_end
│   frames.ts       │  N запитів (по одному на крок, ізольовано)
│   grounding.ts    │  «чи підтверджує цей кадр це твердження?»
└─────────┬─────────┘
          │  Verdict[]
          ▼
┌───────────────────┐
│ 5. Assembly       │  зшивання + фінальне рішення status
│   assemble.ts     │  ok / needs_clarification / declined
└─────────┬─────────┘
          │  GuideDocument
          ▼
┌───────────────────┐
│ 6. UI + Metrics   │  SSE-прогрес по стадіях, панель часу/токенів/
│   server.ts       │  вартості, export → Markdown
│   metrics.ts      │
└───────────────────┘
```

Метрики збираються **на кожній стадії** (`metrics.ts` обгортає всі виклики), а не
підсумовуються в кінці — інакше нема з чого звітувати про ретраї.

---

## Модуль 1 — Ingestion

**Файл:** `src/modules/ingestion.ts`

Відповідальність: прийняти файл, довести що він придатний, віддати Gemini-посилання.

1. Multipart upload → тимчасовий файл у `os.tmpdir()`.
2. Жорсткі ворота (все → `422`, не `500`):
   - MIME у whitelist: `video/mp4`, `video/webm`, `video/quicktime`
   - розмір ≤ 100 МБ
   - тривалість ≤ 150 сек (ліміт брифу 120 + допуск)
3. `ffprobe` (з `ffprobe-static`) → `duration`, `fps`, `width`, `height`.
   **Резолюція < 1280 по ширині → попередження** у результаті: дрібний UI-текст
   модель прочитає ненадійно. Не блокуємо, але фіксуємо.
4. Завантаження через Files API → polling до `state: ACTIVE` (таймаут 60 сек).
5. Видалення локального тимчасового файлу лише **після** стадії Grounding —
   кадри ріжемо з локальної копії, не качаємо назад.

```ts
type MediaAsset = {
  localPath: string;
  fileUri: string;          // Gemini Files API URI
  mimeType: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  sizeBytes: number;
  warnings: string[];       // напр. "low resolution: UI text may be unreliable"
};
```

---

## Модуль 2 — Observation Layer

**Файл:** `src/modules/observation.ts`
**Модель:** `gemini-3.8-flash`, `media_resolution: MEDIA_RESOLUTION_HIGH`, `fps: 1`,
`temperature: 0`, `responseSchema` (structured output).

### Системний промпт (контракт, не стиль)

```
You are a screen-recording observer. You do NOT write documentation.
Your only job is to report what is observable in this recording.

Emit a flat, chronologically ordered list of events. For each event:

VISIBILITY — the single most important rule.
  Set "visible": true ONLY if you can literally see the action or its result
  in the video frames. If you believe an action must have happened but you
  cannot see it, set "visible": false and describe it anyway. Never merge an
  inferred action into a visible one.

SPEECH vs SCREEN — these are separate channels. Never let one fill in for
  the other.
  - "spoken": true if the narrator described this event out loud.
  - A necessary action performed in silence is "visible": true, "spoken": false.
    This is normal and important. Report it.
  - If the narrator says one thing and the screen shows another, emit the event
    describing WHAT THE SCREEN SHOWS, and fill "conflict" with what was said.
    Do not resolve the conflict. Do not pick a side.

SUPERSEDING — corrections and abandoned attempts.
  If a later event undoes, reverses or replaces an earlier one, set the earlier
  event's "superseded_by" to the later event's id. Judge by observable effect on
  screen, not by tone of voice. A value typed then cleared, a filter set then
  changed, a dropdown option selected then re-selected: all superseded.

GAPS — jumps in the recording.
  If UI state changes with no visible cause (a cut, a jump, an off-screen action),
  emit an event with kind "gap" describing what changed and what must have
  happened in between. Set "visible": false. Never invent the click that would
  explain it.

TIMESTAMPS — seconds from the start, as numbers (e.g. 7.0, not "00:07").
  t_start  — when the action begins
  t_end    — when its effect is fully visible on screen. Add a buffer of one to
    two seconds past the moment you believe the change completes. Frames are
    sampled once per second, and menus, dialogs, checkboxes and row counts
    finish rendering after the click that started them. A t_end placed on the
    click itself lands on the state BEFORE the action, which reads as if the
    action never happened. Err late, never early.
  screenshot_t — the single most informative moment for a reader who has to
    FIND this control: prefer a frame where the target element is visible and
    not yet activated, with any dropdown or menu already open.

STATE — the visible consequence of an action.
  After any action that changes what the table shows, emit a "ui_state" event
  with the visible count, quoting the on-screen text exactly as it is written
  (for example "Showing 4 of 12"). This is the observable proof that the action
  took effect. If the count is not readable in the frames, say that instead —
  never compute it yourself.

SUCCESS — only if shown.
  Emit kind "success_state" only if the recording visibly shows the operation
  completed (a downloaded file, a confirmation, a changed list). Absence of a
  success state is a valid and expected outcome. Never assert success you did
  not see.

Describe the application generically ("the orders table", "the Status dropdown").
Do not use knowledge of how such apps usually work to fill in anything.
```

**Поправка від 2026-09-13 (після першого живого прогону A).** Блок `STATE` додано
вже після затвердження. Причина: у першому таймлайні A не виявилось жодної події
`ui_state` — модель зафіксувала кліки по фільтрах, але не їхній наслідок, тобто
`Showing 6 of 12 → 2 → 4`. Це те саме число, яке робить помилку спостережуваною,
і те саме, яке Grounding має зчитувати з кадру. Без нього крок «встановіть фільтр»
неможливо підтвердити нічим, крім самого факту кліку.

**Поправка від 2026-09-13 (після першого прогону Grounding).** У блок `TIMESTAMPS`
додано вимогу буфера 1–2 с до `t_end`. Причина зміряна, не теоретична: Grounding
повернув `contradicted` на тихий крок із чекбоксом. Перевірка кадрів очима
показала, що на `t_end: 32` чекбокс ще порожній, а позначеним він стає лише
близько 34–36 с. Дія була, таймкод — ні. Оскільки кадри семплюються раз на
секунду, а мікроанімації завершуються після кліку, `t_end` без запасу системно
ловить стан **до** дії. Помилятись треба пізно, не рано.

### JSON-контракт на виході

```ts
type RawTimeline = {
  schema_version: "timeline/1";
  app_context: {
    app_label: string;          // "an orders management table"
    operation_label: string;    // "export filtered orders to CSV"
    operation_confidence: number;      // 0..1
    is_single_operation: boolean;      // false → кандидат на відмову
    is_screen_recording: boolean;      // false → відмова
  };
  events: ObservedEvent[];
  global_notes: string[];
};

type ObservedEvent = {
  id: string;                   // "e1", "e2" — стабільні, посилаються один на одного
  kind:
    | "ui_action"               // клік, ввід, вибір — кандидат на крок
    | "ui_state"                // стан без дії (результат, екран)
    | "narration"               // тільки голос, без дії на екрані
    | "gap"                     // стан змінився без видимої причини
    | "success_state";          // видимий фінальний успіх
  t_start: number;              // сек
  t_end: number;                // сек
  screenshot_t: number;         // сек, найінформативніший кадр
  visible: boolean;             // видно на екрані?  false → ніколи не крок
  spoken: boolean;              // озвучено голосом?
  observation: string;          // що саме видно, нейтрально
  target: {                     // null якщо не застосовно
    element_label: string | null;   // "Export CSV"
    element_kind: string | null;    // "button" | "dropdown" | "text input" | ...
    value: string | null;           // "Shipped", "2024-01-01"
  } | null;
  superseded_by: string | null; // id пізнішої події, що це скасувала
  conflict: {                   // голос суперечить екрану
    spoken_claim: string;
    screen_shows: string;
  } | null;
  confidence: number;           // 0..1 — впевненість у самому спостереженні
};
```

**Чому `screenshot_t` окремо від `t_start`.** Таймкоди модель мислить із точністю
до секунди, а клік триває долі секунди. Кадр на `t_start` часто вже після кліку —
контрол зник або меню закрилось. `screenshot_t` дозволяє моделі обрати кадр, де
елемент ще видно, — саме такий скріншот потрібен читачу гайда.

---

## Модуль 3a — Authoring Reduce (детермінований мозок)

**Файл:** `src/modules/authoring/reduce.ts` — чисті функції, нуль I/O, нуль API.
**Тести:** `tests/reduce.test.ts` — на фікстурах `RawTimeline`, без мережі.

Алгоритм, по порядку:

1. **Ворота відмови (перед усім іншим).**
   `is_screen_recording === false` → `status: "declined"`, reason
   `not_a_screen_recording`. Далі не йдемо, гроші на Grounding не витрачаємо.
   `is_single_operation === false` → `status: "declined"`,
   reason `multiple_operations`.

2. **Транзитивне відсікання покинутих гілок.**
   Йдемо по ланцюгу `superseded_by` до кінця (з захистом від циклів).
   Кожна подія, у якої є непорожній ланцюг, іде в `discarded[]` **разом із
   вказівником на те, чим її замінили**.
   Фінальна ланка ланцюга — залишається. Так виконується «remove abandoned
   mistakes while preserving the final chosen settings»: скасований фільтр
   зникає з кроків, а той, на якому зупинились, залишається.

3. **Фільтр «не вигадуй кліків».**
   Крок може народитись **лише** з події `kind === "ui_action" && visible === true`.
   - `visible === false` → в `unverifiable[]`, у нумеровані кроки ніколи.
   - `kind === "narration"` → **ніколи не крок.** Це код, а не промпт. Саме
     тут структурно неможливе «summarizing speech»: озвучене без дії на екрані
     фізично не має шляху до списку кроків. Може стати `note` на сусідньому кроці.

4. **Прогалини.**
   Кожна `kind === "gap"` → `MissingStep` warning, вставлений **між** сусідніми
   кроками за часом, із текстом «що змінилось» і `severity`.
   `severity: "critical"` якщо прогалина розриває ланцюг до `success_state`
   (без неї операцію не повторити), інакше `"minor"`.

5. **Суперечності.**
   Будь-яка подія з `conflict !== null` → `ClarificationRequest`.
   Питання формулюється детерміновано з полів: *«At 0:28 the narrator said
   "{spoken_claim}" but the screen shows "{screen_shows}". Which was intended?»*
   Крок залишається в гайді, але позначений і **не вважається підтвердженим**.

6. **Успіх.**
   `has_success_state = events.some(e => e.kind === "success_state" && e.visible)`.
   `false` → warning `no_visible_success_state`. Гайд не заявляє успіх.

7. **Правила відмови (пороги в одному місці, `config/thresholds.ts`).**
   ```
   declined              ← !is_screen_recording | !is_single_operation
                           | steps.length === 0
                           | operation_confidence < 0.35
   needs_clarification   ← clarifications.length > 0
                           | будь-який critical MissingStep
                           | verified_ratio < 0.6   (після Grounding)
   ok_with_warnings      ← є minor warnings
   ok                    ← інакше
   ```
   Пороги — константи у файлі, а не магічні числа в логіці. Їх значення
   і чому саме такі — в delivery notes.

```ts
type DraftGuide = {
  schema_version: "draft/1";
  status: "ok" | "ok_with_warnings" | "needs_clarification" | "declined";
  decline_reason: string | null;
  steps: DraftStep[];              // порядок = порядок у гайді
  discarded: DiscardedAttempt[];   // покинуті помилки, поза рекомендованим шляхом
  missing_steps: MissingStep[];
  clarifications: ClarificationRequest[];
  unverifiable: string[];          // id подій з visible:false
  has_success_state: boolean;
};

type DraftStep = {
  index: number;                   // 1-based
  event_id: string;                // ← єдине джерело правди, звідки крок
  t_start: number;
  t_end: number;
  screenshot_t: number;
  observation: string;             // сире спостереження, ще не проза
  target: ObservedEvent["target"];
  notes: string[];                 // з narration-подій поблизу
  flags: ("conflict" | "after_gap" | "silent_action")[];
  instruction: string | null;      // заповнить 3b
  verification: Verdict | null;    // заповнить 4
};

type DiscardedAttempt = {
  event_id: string;
  t_start: number;
  observation: string;
  superseded_by_event_id: string;
  superseded_by_observation: string;   // чим замінили — для секції «що пробували»
};

type MissingStep = {
  after_step_index: number | null;     // null → на початку
  t_gap: number;
  what_changed: string;
  severity: "critical" | "minor";
};

type ClarificationRequest = {
  event_id: string;
  t: number;
  question: string;
  spoken_claim: string;
  screen_shows: string;
};
```

---

## Модуль 3b — Phrasing

**Файл:** `src/modules/authoring/phrase.ts`
**Модель:** `gemini-3.8-flash`, `temperature: 0`, лише текст, без відео.

Вхід: масив `{ event_id, observation, target }` — **уже зафіксований** списком з 3a.
Вихід: `{ event_id, instruction }[]`.

Промпт по суті: *«Rewrite each observation as one imperative English sentence.
Return exactly one object per input id, same ids, same order. Do not add, merge,
split or reorder. Do not add information that is not in the observation.»*

**Структурна гарантія.** Код валідує: кількість збігається, множина id збігається,
порядок збігається. Розбіжність → один retry → `fail` стадії (метрика ретраю
фіксується). Тобто цей прохід **фізично не може** ні додати крок, ні прибрати.
Найгірше, що він може — сформулювати речення невдало, і це видно людині.

---

## Модуль 4 — Grounding Check

**Файли:** `src/modules/frames.ts` (ffmpeg), `src/modules/grounding.ts` (перевірка).

### Витягування кадрів

`ffmpeg-static` + `ffprobe-static` — бінарники з npm, працюють і на Windows
локально, і в Linux-контейнері на хості. Системний ffmpeg не потрібен
(перевірено: у середовищі його немає).

Для кожного кроку ріжемо **два** PNG:

```
ffmpeg -ss <screenshot_t> -i <localPath> -frames:v 1 -q:v 2 step-<i>-shot.png
ffmpeg -ss <t_end>        -i <localPath> -frames:v 1 -q:v 2 step-<i>-after.png
```

`-ss` **перед** `-i` — швидкий seek по ключових кадрах, суттєво швидше на
довгих файлах. Точності до кадру тут не треба: ми свідомо беремо два різні
моменти, і саме перевірка вирішує, чи вони підтверджують крок.

Ширина обмежується до 1280 px (`-vf scale=1280:-1`) — і для розміру сторінки,
і щоб кадр лишався читабельним у high resolution.

### Запит перевірки — по одному на крок, ізольовано

Свідомо **не** батчимо кадри в один запит: модель, побачивши сусідні кроки,
почне «домислювати» узгоджену історію. Ізоляція — сенс цієї стадії.
Кожен запит дешевий (2 зображення ≈ 516 токенів), тож ціна ізоляції мізерна.

```
You are verifying one sentence of a how-to guide against two frames from the
recording it was derived from.

Frame 1 was taken at the moment the step begins.
Frame 2 was taken at the moment the step's effect should be visible.

Claim: "{instruction}"

Answer strictly:
- "supported"   — the frames show this control and/or this effect.
- "contradicted"— the frames show something that conflicts with the claim.
- "unclear"     — the frames neither confirm nor deny it (occluded, wrong
                  moment, text too small to read).

"unclear" is a correct and useful answer. Do not guess to be helpful.
Quote the on-screen text you relied on. If you cannot read any relevant
on-screen text, say so and answer "unclear".
```

```ts
type Verdict = {
  event_id: string;
  result: "supported" | "contradicted" | "unclear";
  evidence_text: string | null;   // процитований текст з екрану
  reasoning: string;              // 1-2 речення
  frames: { shot: string; after: string };  // шляхи/URL кадрів
};
```

**Ліміти free tier.** Ізоляція означає N послідовних запитів за кілька секунд —
це найшвидший шлях впертись у RPM-ліміт безкоштовної квоти саме тоді, коли
перевіряльник тицяє демо. Тому: запити йдуть **послідовно** (не `Promise.all`),
з обмежувачем конкурентності 1 і експоненційним backoff на `429`
(`0.5с → 2с → 8с`, максимум 3 спроби). Кожен ретрай інкрементує
`StageMetric.retries` — ретраї входять у звіт про вартість, як вимагає бриф.
Якщо крок не перевірився після ретраїв, він отримує `unclear` з причиною
`verification_unavailable`, а не тихо вважається підтвердженим.

Наслідки у збірці:
- `contradicted` → крок позначається **червоним**, `verified_ratio` падає.
  Крок **не видаляється**: видалити — значить приховати провал, а бриф вимагає
  про провали звітувати.
- `unclear` → жовтий, у підтверджені не рахується.
- `verified_ratio = supported / steps.length` → підставляється у правило
  `needs_clarification` з 3a, крок 7.

**Це і є той «one example of how you checked their output», який вимагає бриф** —
вбудований у продукт, з артефактом на кожен крок, а не абзац у звіті.

---

## Модуль 5 — Assembly

**Файл:** `src/modules/assemble.ts`

```ts
type GuideDocument = {
  schema_version: "guide/1";
  status: "ok" | "ok_with_warnings" | "needs_clarification" | "declined";
  decline_reason: string | null;
  title: string;                   // з operation_label
  app_label: string;
  source: { filename: string; durationSec: number; sha256: string };
  steps: FinalStep[];
  discarded: DiscardedAttempt[];
  missing_steps: MissingStep[];
  clarifications: ClarificationRequest[];
  warnings: string[];
  verified_ratio: number;
  has_success_state: boolean;
  metrics: RunMetrics;
};

type FinalStep = {
  index: number;
  instruction: string;
  t_start: number;
  t_end: number;
  timestamp_label: string;         // "0:07" — для людини
  screenshot_url: string;
  verification: Verdict;
  flags: ("conflict" | "after_gap" | "silent_action")[];
  notes: string[];
};
```

`sha256` джерельного файлу — щоб у delivery notes можна було довести, що
результат отриманий саме з того відео, що в репо.

---

## Модуль 6 — UI та Metrics

### Metrics

**Файл:** `src/modules/metrics.ts`, прайс — `src/config/pricing.ts`.

Кожен виклик Gemini йде через обгортку, яка знімає `usageMetadata`
(`promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`) і час.

```ts
type StageMetric = {
  stage: "ingestion" | "observation" | "phrasing" | "grounding" | "assembly";
  model: string | null;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  apiCalls: number;
  retries: number;
  costUsd: number;
};

type RunMetrics = {
  totalWallMs: number;
  timeToFirstStepMs: number;       // коли UI показав перший крок
  stages: StageMetric[];
  totalCostUsd: number;
  pricing: {
    source: string;                // URL офіційної сторінки
    checkedOn: string;             // "2026-09-12"
    note: string;                  // "list price; run executed on free tier"
  };
};
```

`config/pricing.ts` — звірені сьогодні цифри, з джерелом у коментарі:

```ts
// Джерело: https://ai.google.dev/gemini-api/docs/pricing — звірено 2026-09-12
export const PRICING = {
  "gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
} as const;
```

**Передреєстрована оцінка** (заміниться зміряними цифрами; high resolution,
~300 tok/сек, 2-хв відео):

| Стадія | Токени | $ |
|---|---|---|
| Observation | ~36 000 in / ~2 500 out | ~$0.036 |
| Phrasing | ~1 500 in / ~800 out | ~$0.004 |
| Grounding (8 кроків × 2 кадри) | ~6 000 in / ~1 500 out | ~$0.010 |
| **Разом на відео** | | **~$0.05** |

Хостинг рахується **окремо** і не змішується з цим числом. Free tier
проговорюється прямо: прогін виконано на безкоштовній квоті, у звіті
стоїть list price, бо «free credits are not zero operating cost».

### UI

Один Express-сервер: статика + `POST /api/process` з **SSE**-прогресом
(деплой на звичайний Node-хост, не serverless — обробка 30-60 сек не влазить
у лімітами serverless-функцій).

Екрани:
1. **Upload** — drag&drop MP4, ліміти написані на самій формі.
2. **Progress** — стадії з живим часом (тут видно, що продукт реально працює,
   а не віддає заготовку).
3. **Result**
   - банер статусу: `ok` / `warnings` / `needs clarification` / `declined`
   - нумеровані кроки: інструкція, чип таймкоду (клік → seek у вбудованому
     `<video>`), скріншот, **бейдж перевірки** (`supported` / `unclear` /
     `contradicted`) з цитатою з екрану у tooltip
   - бейджі `silent action` та `after gap` на відповідних кроках
   - **Missing steps** — вставлені в потік на своєму місці, червоні
   - **Clarifications** — блок питань нагорі
   - **Abandoned attempts** — свернута секція: що пробували і чим замінили
   - **Metrics** — час по стадіях, токени, вартість, ретраї
   - **Export → Markdown**

Свідоме рішення по UI: помилки й «unclear» **видні користувачу**, а не
приховані. Продукт, що чесно каже «цей крок я не зміг підтвердити», корисніший
за той, що впевнено бреше, — і це рівно те, що оцінює бриф.

---

## Структура файлів

```
D:\Codebridge_test_task\
  package.json  tsconfig.json  .env.example
  README.md                      # setup, запуск, деплой
  DELIVERY_NOTES.md              # inputs, expected/actual, fails, час, вартість
  src/
    server.ts                    # Express: статика + /api/process (SSE)
    config/  pricing.ts  thresholds.ts
    modules/
      gemini.ts                  # клієнт + retry + збір usageMetadata
      ingestion.ts
      observation.ts
      authoring/  reduce.ts  phrase.ts
      frames.ts
      grounding.ts
      assemble.ts
      metrics.ts
    schemas/                     # zod + дзеркальні Gemini responseSchema
      timeline.ts  draft.ts  guide.ts
  public/  index.html  app.js  styles.css
  fixtures/
    demo-app/orders.html         # записуваний міні-апп
    videos/  A.mp4 B.mp4 C.mp4 D.mp4 E.mp4
    ground-truth/  A.md ... E.md # ОЧІКУВАННЯ, написані ДО прогонів
    timelines/                   # збережені RawTimeline для тестів reduce
  tests/  reduce.test.ts  schemas.test.ts
```

Валідація: `zod` — єдине джерело правди для розбору відповідей.
Gemini `responseSchema` (підмножина OpenAPI) пишеться руками як дзеркало
zod-схеми, бо автогенерація з zod дає конструкції, яких ця підмножина не
приймає. Розбіжність ловиться `schemas.test.ts`.

---

## Демо-апп і тестовий набір

`fixtures/demo-app/orders.html` — одна сторінка, без залежностей: таблиця
замовлень, фільтри (Status, Date range, Search), кнопка **Export CSV**.
Спеціально закладаємо: чекбокс **«Include customer email»** у діалозі експорту
(його легко зробити безшумно) і статуси, які легко переобрати.

П'ять записів, усі до 2 хв, один голос, англійською:

| # | Запис | Що перевіряє | Очікуваний статус |
|---|---|---|---|
| A | Норма: фільтр Status=Shipped, **мовчки** тикається «Include customer email», помилково обирається Date=Last 7 days → виправляється на Last 30 days, Export → видимий файл | базовий флоу, тиха дія, виправлення, успіх | `ok` |
| B | A, але Status=Pending і фільтри в іншому порядку | regression-чек з брифу | `ok`, кроки відрізняються саме цим |
| C | A з вирізаною серединою: фільтр уже застосований, як — не видно | flag a missing critical step | `needs_clarification`, critical MissingStep |
| D | Голос: «I'm setting status to Shipped», екран: обрано Pending | not merely summarizing speech | `needs_clarification` + clarification на цьому кроці |
| E | Не скрінкаст / дві різні операції в одному записі | повна відмова | `declined` |

**Порядок робіт критичний:** `ground-truth/*.md` пишуться **до** першого прогону
пайплайна. Інакше «expected» стає переписаним «actual», і доказова частина
знецінюється.

---

## Бюджет 8 годин

| Час | Робота |
|---|---|
| 0:00–0:45 | Скаффолд, `gemini.ts`, `metrics.ts`, `pricing.ts` |
| 0:45–1:30 | `orders.html` з закладеними пастками |
| 1:30–2:10 | Запис A–E **+ ground truth до прогонів** |
| 2:10–3:10 | Observation: промпт, схема, перший живий прогін на A |
| 3:10–4:25 | `reduce.ts` + юніт-тести на збережених таймлайнах, `phrase.ts` |
| 4:25–5:25 | `frames.ts` + `grounding.ts` |
| 5:25–6:40 | UI, SSE, панель метрик, export |
| 6:40–7:25 | Прогін усіх п'яти, запис actual vs expected, фікси |
| 7:25–7:50 | Деплой |
| 7:50–8:00 | `DELIVERY_NOTES.md` + 3-хв вокшру |

Якщо час закінчується — ріжеться в цьому порядку: деплой → export у Markdown →
відео B. **Grounding не ріжеться ніколи** — без нього зникає сенс заявки.

---

## Verification

1. `npm test` — `reduce.test.ts` на збережених таймлайнах: відсікання покинутих
   гілок (у т.ч. транзитивне), `narration` ніколи не стає кроком, `visible:false`
   ніколи не стає кроком, `gap` → critical warning, кожне правило відмови.
   Без мережі, детерміновано.
2. `npm run dev` → `http://localhost:3000` → завантажити `fixtures/videos/A.mp4`
   → у результаті мусить бути: тиха дія як окремий крок, помилковий Date-фільтр
   **не** в кроках а в Abandoned, фінальний Last 30 days **у** кроках, видимий успіх.
3. B → порівняти з A: відрізняється рівно зміненою настройкою.
4. C → critical MissingStep на місці вирізу, жодного вигаданого кліку.
5. D → clarification з обома версіями, крок не помічений `supported`.
6. E → `declined`, Grounding не викликався (перевірити по метриках: 0 запитів).
7. **Слідування гайдом:** відкрити `orders.html` у чистому профілі й пройти
   гайд з відео A, не дивлячись відео. Розбіжності записати в delivery notes
   як є — включно з провалами.
8. Метрики: звірити суму по стадіях із передреєстрованою оцінкою вище,
   розбіжність пояснити.
