# Presentonika Orchestrator (API + Queue)

## Run

```bash
docker compose up -d
npm i
cp .env.example .env
npm run dev
```

## Theme packs

Worker reads themes from `process.env.THEMES_DIR || "themes"`.

Expected structure:

```text
themes/<themeId>/
  theme.json
  map.json
  template.out.zip
  preview.jpg        # optional
  decor/             # optional
```

Repository includes `themes/_example/` as a development placeholder.
Replace `themes/_example/template.out.zip` with a real template export from your editor (`template.out.zip` with `doc.json` at zip root).

## Job retention and status checks

- Completed jobs are retained for about **1 hour** (`removeOnComplete: { age: 3600 }`).
- Failed jobs are retained for about **24 hours** (`removeOnFail: { age: 86400 }`).
- For best UX, call `GET /jobs/:id` right after `POST /jobs` and/or use short polling.

## API examples

### Health

```bash
curl -s http://localhost:8080/health
```

### Create job

```bash
curl -s -X POST http://localhost:8080/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "presentationId": 123,
    "userId": 55,
    "topic": "Стили речи",
    "themeId": "_example",
    "language": "ru",
    "save": {
      "endpoint": "https://example.com/wp-json/presentonika/v1/save-outzip",
      "presentationId": 123,
      "saveToken": "TOKEN"
    }
  }'
```

### Get job status

```bash
curl -s http://localhost:8080/jobs/<jobId>
```

If job is completed, response includes `returnValue` with:
- `fillKeys`
- `imageSlots`
- `slideCount`
- `assemble.outZipPath`
- `assemble.droppedAtCount`
- `assemble.imagePlannedCount`
- `assemble.imageReplacedCount`
- `assemble.imageMissing`
- `assemble.backgroundsPlannedCount`
- `assemble.backgroundsReplacedCount`
- `assemble.backgroundsMissing`
- `assemble.chosenVariants`
- `assemble.debugFillsApplied`
- `upload` (attempted/ok/status/response*)

## Этап 3: локальная сборка out.zip


### Формат map.json (MVP)

- Номера слайдов в `slides` — **1-based** (`"1"`, `"2"`, ...).
- Для выбранного варианта можно задать:
  - `dropAt: number[]` — индексы в `slides[N].elements[]`
  - `drop: string[]` — удаление по `id`
- Для замены картинок без изменения `src` можно задать:
  - `imageAt: { "<elementIndex>": "<slotName>" }`
  - где `elementIndex` — **0-based** индекс в `slides[N].elements[]`
- Применение: `dropAt` -> `drop` -> image replacement через `imageAt`.

Пример:

```json
{
  "slides": {
    "1": {
      "imageAt": { "2": "s1_hero" },
      "variants": {
        "A": { "dropAt": [2], "drop": ["id1"] },
        "B": { "dropAt": [2] }
      }
    }
  }
}
```

На этапе 3 worker делает локальную сборку `out.zip`:
1. читает `template.out.zip` и `doc.json`
2. применяет `map.json` (вариант A/B по seed), сначала `dropAt` по индексам `slides[N].elements[]`, затем `drop` по ids (fallback)
3. заменяет `{{key}}` в тексте на `TEST_<key>`
4. готовит image replacement по `imageAt` и подменяет zip entries (без изменения `src` в `doc.json`)
5. пишет новый архив в `./out/<jobId>.out.zip`

Готовый файл лежит по пути из `returnValue.assemble.outZipPath` (например `out/p_123_... .out.zip`).

Проверить, что `doc.json` изменился:

```bash
unzip -p out/<jobId>.out.zip doc.json | head -n 60
```

### Проверка imageAt замены

Можно сравнить размер/байты файла изображения внутри собранного архива и тестового файла из theme pack:

```bash
unzip -p out/<jobId>.out.zip assets/images/slide-1-img-1.png | wc -c
wc -c themes/_example/test-images/hero.jpg
```

Если `imageAt` настроен на этот `src`, размер должен совпасть (или как минимум измениться относительно исходного template zip).

## Этап 5: генерация фонов по слайдам

При сборке worker автоматически генерирует PNG-фоны `backgrounds/slide-N.png` (1536x864) для каждого слайда и подменяет/добавляет их в `out.zip`.

Источник параметров:
- `themes/<themeId>/theme.json` (если есть)
- иначе применяются дефолты палитры и интенсивности


Параметры выразительности (`theme.json -> background`):
- `gradientStrength` (default `1.35`, clamp `0.8..2.5`) — усиливает контраст градиента
- `blobAlphaMin` / `blobAlphaMax` (default `0.18/0.32`, clamp `0..0.6`) — насыщенность blobs
- `vignette` (default `0.18`, clamp `0..0.35`) — затемнение краёв
- `accentBlobChance` (default `0.6`, clamp `0..1`) — как часто blob берёт accent-цвет
- `grain` (default `0.10`, clamp `0..0.3`) — уровень зерна

Как сделать фон сильнее:
- увеличьте `gradientStrength` до `1.5..1.9`
- увеличьте `blobAlphaMin/Max` (например `0.24/0.40`)
- увеличьте `vignette` до `0.22..0.30`

Как сделать фон мягче:
- уменьшите `gradientStrength` ближе к `1.0`
- уменьшите `blobAlphaMin/Max`
- уменьшите `vignette` до `0.08..0.15`

Временные файлы фонов создаются в `.tmp/<jobId>/backgrounds/`, после чего используются как replacements при сборке zip.

Проверка:

```bash
unzip -l out/<jobId>.out.zip | rg "backgrounds/slide-"
unzip -p out/<jobId>.out.zip backgrounds/slide-1.png | wc -c
unzip -p out/<jobId>.out.zip backgrounds/slide-2.png | wc -c
```

Файлы должны существовать, и обычно фоновые PNG для разных слайдов будут отличаться.


## Этап 7: from_url сохранение в WordPress (`save-outzip-from-url`)

По умолчанию orchestrator использует режим `from_url`:
1. Публикует собранный архив во временное staging-хранилище (`/staged/...`).
2. Вызывает WP endpoint `save-outzip-from-url` с JSON `{ "outZipUrl": "..." }`.
3. WP скачивает архив сам (маленький запрос вместо большого multipart upload).

Ключевые env-переменные:
- `WP_SAVE_MODE=from_url|upload` (default `from_url`)
- `PUBLIC_ZIP_BASE_URL` (локально: `http://localhost:8080`, прод: `https://editor.presentonika.ru`)
- `STAGED_ENABLE_SERVER=true`
- `STAGED_DIR=.staged`
- `STAGED_TTL_SECONDS=1800`
- `STAGED_CLEANUP_ON_SUCCESS=true|false`
- `STAGED_CLEANUP_DELAY_SECONDS=0`
- `WP_SAVE_FROM_URL_TIMEOUT_MS=30000`
- `WP_SAVE_RETRIES=10` (ретраи только для сетевых ошибок ECONNREFUSED/ENOTFOUND/ETIMEDOUT в `from_url`)
- `WP_SAVE_RETRY_BASE_DELAY_MS=400` (экспоненциальный backoff + jitter, cap 5000ms)
- `WP_SAVE_WAIT_TIMEOUT_MS=5000` (ожидание доступности endpoint перед запросом)
- `BACKGROUND_GEN_TIMEOUT_MS=60000` (таймаут генерации всех background-слайдов; при превышении job падает с `BackgroundGenTimeout`)
- `WP_FAIL_ON_UPLOAD_ERROR=true|false`

`returnValue.upload` в режиме `from_url` содержит:
- `mode: "from_url"`
- `outZipUrl`
- `attempted`, `ok`, `status`
- `responseJson`, `responseTextSnippet`

### Локальный тест без реального WordPress

1. В `.env`:

```bash
ENABLE_MOCK_WP=true
WP_SAVE_MODE=from_url
PUBLIC_ZIP_BASE_URL=http://localhost:8080
```

2. В payload job укажите endpoint:

```json
"save": {
  "endpoint": "http://localhost:8080/mock/wp-save-outzip-from-url",
  "presentationId": 123,
  "saveToken": "TOKEN"
}
```

3. После выполнения job проверьте:

```bash
ls .tmp/mock-wp/123/received.out.zip
```


После успешного `from_url` сохранения staged URL может стать недоступным (`404 not_found`) — это зависит от cleanup-настроек.

Для отладки (чтобы URL жил дольше):
- `STAGED_CLEANUP_ON_SUCCESS=false` (полагаться на TTL), или
- `STAGED_CLEANUP_DELAY_SECONDS=<N>` чтобы удалить staged-файл с задержкой.


### Dev-устойчивость при `npm run dev`

В single-process dev-режиме (`concurrently` + `tsx watch`) API может кратко перезапускаться.
Чтобы worker не падал на transient `ECONNREFUSED` в `wp_save_from_url`, orchestrator теперь:
1) ждёт доступность endpoint (`waitForHttp`),
2) делает ретраи только на сетевых ошибках с backoff/jitter,
3) **не ретраит** обычные HTTP-ответы (4xx/5xx) по умолчанию.

Это поведение безопасно и для production endpoint'ов: retry применяется только при сетевом сбое соединения.

### Продакшен заметка

Для production `outZipUrl` должен быть на домене editor (allowlist в WP).
Когда orchestrator будет на VPS, проксируйте `/staged/*` editor-доменом на orchestrator:

```nginx
location /staged/ {
  proxy_pass http://127.0.0.1:<ORCH_PORT>/staged/;
}
```

### Fallback режим

Если нужен старый multipart-путь, установите `WP_SAVE_MODE=upload` — orchestrator использует прежнюю загрузку файла в `save.endpoint`.


## Этап 9: auto choose variants (Hybrid MVP+)

Теперь вариативность может выбираться автоматически через `map.json -> slides[N].choose`:

### 1) Seed mode

```json
"choose": {
  "mode": "seed",
  "variants": ["A", "B"]
}
```

Выбор детерминированный по `presentationId` + `slideIndex` и всегда повторяемый для одинаковых входных данных.

### 2) Fill length mode

```json
"choose": {
  "mode": "fillLength",
  "key": "s4_bullets",
  "threshold": 100,
  "lt": "oneCol",
  "gte": "twoCol"
}
```

Если длина `fills[s4_bullets]` меньше порога — берётся `oneCol`, иначе `twoCol`.

### debug.fills override в POST /jobs

Можно принудительно подложить тексты и проверить правила без LLM:

```json
{
  "presentationId": 123,
  "userId": 55,
  "topic": "Demo",
  "themeId": "_example",
  "debug": {
    "fills": {
      "s4_bullets": "Очень длинный текст ..."
    }
  },
  "save": {
    "endpoint": "http://localhost:8080/mock/wp-save-outzip-from-url",
    "presentationId": 123,
    "saveToken": "TOKEN"
  }
}
```

Результат выбора смотрите в:
- `GET /jobs/:id -> returnValue.assemble.chosenVariants`
- `GET /jobs/:id -> returnValue.assemble.debugFillsApplied`

## Этап 10: Hardening (cleanup + limits + timings)

### Cleanup service

API-процесс запускает периодический cleanup (worker не запускает его):
- удаляет старые `.tmp/<jobId>/...` директории,
- удаляет старые `out/*.out.zip`,
- удаляет старые `.staged/*` как safety-net,
- удаляет старые `.tmp/mock-wp/<presentationId>/...`.

Cleanup best-effort: ошибки логируются warning-логами и не падают процесс.

Новые env:
- `ENABLE_CLEANUP=true`
- `ARTIFACT_TTL_SECONDS=21600`
- `CLEANUP_INTERVAL_SECONDS=600`
- `MOCK_WP_TTL_SECONDS=21600`

### Limits / guardrails

Worker теперь валидирует лимиты:
- `MAX_TEMPLATE_ZIP_BYTES` — размер `template.out.zip` перед чтением.
- `MAX_SLIDES` — максимальное число слайдов после parse_doc.
- `MAX_OUTZIP_BYTES_LOCAL` — размер итогового `out/<jobId>.out.zip` после assemble.
- `MAX_STAGED_BYTES` — размер zip перед публикацией в `.staged`.

Ошибки выглядят так:
- `TemplateTooLarge: <size> > <limit>`
- `TooManySlides: <count> > <limit>`
- `OutZipTooLarge: <size> > <limit>`
- `StagedTooLarge: <size> > <limit>`

### Диагностика: stage timings + stats

`GET /jobs/:id -> returnValue.stats` теперь содержит:
- `timingsMs` по стадиям:
  - `load_theme_pack`
  - `read_template_zip`
  - `parse_doc`
  - `apply_variants_fills`
  - `prepare_images`
  - `generate_backgrounds`
  - `assemble_zip`
  - `publish_outzip`
  - `wp_save_from_url` / `upload_to_wp`
- `outZipBytes`
- `backgroundsBytesTotal`
- `backgroundsCount`
- `stagedCleanupMode` (`immediate` / `delay` / `disabled`)

### Быстрая manual-проверка

1. Проверка cleanup:
   - выставьте `ARTIFACT_TTL_SECONDS=5`, `CLEANUP_INTERVAL_SECONDS=3`, `ENABLE_CLEANUP=true`;
   - выполните job;
   - подождите >5s и проверьте, что старые артефакты удалились из `.tmp`, `out`, `.staged`.

2. Проверка лимита out zip:
   - временно выставьте `MAX_OUTZIP_BYTES_LOCAL=1000000` (1MB);
   - выполните job и убедитесь, что задача падает с `OutZipTooLarge`.
