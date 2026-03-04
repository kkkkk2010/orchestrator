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
- **пропускает активные job-директории с `.tmp/<jobId>/.lock`**,
- удаляет старые `out/*.out.zip`,
- удаляет старые `.staged/*` как safety-net,
- удаляет старые `.tmp/mock-wp/<presentationId>/...`.

Cleanup best-effort: ошибки логируются warning-логами и не падают процесс.


TTL-переменные (`ARTIFACT_TTL_SECONDS`, `MOCK_WP_TTL_SECONDS`) задаются в **секундах** и сравниваются cleanup-сервисом корректно в миллисекундах (`ttlMs = seconds * 1000`).

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

## Этап 11: Teacher Skeleton + Theme tools

Добавлены 3 teacher-theme packs (скелеты):
- `themes/teacher-dark`
- `themes/teacher-light`
- `themes/teacher-bright`

Каждый pack содержит:
- `theme.json`
- `map.json` (choose/variants scaffold)
- `meta.json`
- `decor/` (placeholder)
- `template.out.zip` (временный placeholder, сейчас скопирован из `_example`; заменить на реальный teacher 10-slide template)

### Teacher skeleton spec

Полная спецификация 10 слайдов, ключей и правил лежит в:
- `docs/teacher-skeleton.md`

### Tools

Inspect структуры doc по слайдам/элементам:

```bash
npm run theme:inspect -- teacher-dark
```

Validate theme pack:

```bash
npm run theme:validate -- teacher-dark
```

`theme:validate` проверяет:
- required files/theme pack structure
- размер template zip (`MAX_TEMPLATE_ZIP_BYTES`)
- что `doc.json` содержит ровно 10 слайдов (error)
- корректность `map.json` индексов/правил (`imageAt`, `dropAt`, `choose`)
- предупреждает о недостающих skeleton fill-keys
- предупреждает только при неожиданном naming для `slide.background.src` (для runtime background наличие файла в template не требуется)

Exit code:
- `0` если нет errors
- `1` если есть errors (warnings допустимы)

## Production deploy (Docker Compose)

For VPS deployment (same host as `editor.presentonika.ru`) use `docker-compose.prod.yml` with 3 services:
- `redis`
- `orchestrator-api` (HTTP API)
- `orchestrator-worker` (BullMQ worker)

### 1) Prepare env

```bash
cp .env.prod.example .env
```

Key production defaults:
- `ENABLE_MOCK_WP=false`
- `STAGED_ENABLE_SERVER=true`
- `ENABLE_CLEANUP=true`

### 2) Build and run

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 3) Health check

```bash
curl -s http://127.0.0.1:8080/health
```

### 4) Nginx snippet (editor domain)

Proxy staged files from editor nginx to orchestrator API port:

```nginx
location /staged/ {
  proxy_pass http://127.0.0.1:8080/staged/;
}
```

If needed, you can also proxy API routes similarly.

### 5) Local production-like verification

```bash
# create job
curl -s -X POST http://127.0.0.1:8080/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "presentationId": 123,
    "userId": 55,
    "topic": "Prod test",
    "themeId": "_example",
    "save": {
      "endpoint": "http://127.0.0.1:8080/mock/wp-save-outzip-from-url",
      "presentationId": 123,
      "saveToken": "TOKEN"
    }
  }'

# poll status
curl -s http://127.0.0.1:8080/jobs/<jobId>
```

For staged URL testing, set `STAGED_CLEANUP_ON_SUCCESS=false` temporarily.

## Public nginx exposure for `/orchestrator/*` + MVP+ security

Paste the following blocks into existing `server { server_name editor.presentonika.ru; ... }`.
Keep editor app on `/` proxy as-is.

```nginx
# Orchestrator API under /orchestrator/
location ^~ /orchestrator/ {
  proxy_pass http://127.0.0.1:8080/;
  proxy_http_version 1.1;

  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  proxy_connect_timeout 10s;
  proxy_send_timeout 300s;
  proxy_read_timeout 300s;
  send_timeout 300s;

  proxy_buffering off;
  proxy_request_buffering off;

  add_header Cache-Control "no-store" always;
}

# Staged zip streaming (keep enabled)
location ^~ /staged/ {
  proxy_pass http://127.0.0.1:8080/staged/;
  proxy_http_version 1.1;

  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  proxy_connect_timeout 10s;
  proxy_send_timeout 300s;
  proxy_read_timeout 300s;

  proxy_buffering off;
  add_header Cache-Control "no-store" always;
}
```

Notes:
- trailing slash in `proxy_pass http://127.0.0.1:8080/;` is required for correct `/orchestrator/...` rewrite.
- CORS is not required for server-to-server WordPress calls.

### Security model (first 100 users)

`/jobs` and `/jobs/:id` require header:

- `X-Orchestrator-Key: <PRESENTONIKA_ORCHESTRATOR_KEY>`

If missing/wrong:

- `401 { "error": "unauthorized" }`

`POST /jobs` also has per-IP rate-limit (Redis fixed window):

- `JOBS_RATE_LIMIT_MAX=30`
- `JOBS_RATE_LIMIT_WINDOW_SECONDS=300`

If exceeded:

- `429 { "error": "rate_limited" }`
- `Retry-After: <seconds>`

`/health` remains public.
`/staged/:name` remains token-protected via staged signed token.

### Apply commands

```bash
sudo nginx -t && sudo systemctl reload nginx
cd /path/to/presentonika-orchestrator
cp .env.prod.example .env   # if needed
# set PRESENTONIKA_ORCHESTRATOR_KEY to a long random value

docker compose -f docker-compose.prod.yml up -d --build
```

### Minimal tests

```bash
# 1) health open
curl -i https://editor.presentonika.ru/orchestrator/health

# 2) /jobs without key => 401
curl -i -X POST https://editor.presentonika.ru/orchestrator/jobs \
  -H 'Content-Type: application/json' \
  -d '{"presentationId":1,"userId":1,"topic":"x","themeId":"_example","save":{"endpoint":"https://example.com","presentationId":1,"saveToken":"t"}}'

# 3) /jobs with key => accepted
curl -i -X POST https://editor.presentonika.ru/orchestrator/jobs \
  -H 'X-Orchestrator-Key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"presentationId":1,"userId":1,"topic":"x","themeId":"_example","save":{"endpoint":"https://example.com","presentationId":1,"saveToken":"t"}}'

# 4) /jobs/:id with key
curl -i https://editor.presentonika.ru/orchestrator/jobs/<jobId> \
  -H 'X-Orchestrator-Key: YOUR_KEY'

# 5) staged with signed token
curl -i 'https://editor.presentonika.ru/staged/<name>.out.zip?t=<token>'
```

## Этап: ImagePlan v1

Теперь orchestrator всегда добавляет в корень `out.zip` файлы:
- `imagePlan.json`
- `diagnostics.json`

Их best-effort копии сохраняются в `.tmp/<jobId>/imagePlan.json` и `.tmp/<jobId>/diagnostics.json`.

### Как строятся imagePlan slots

1) Сначала auto-detect ищет image placeholders в `doc.json` (по `meta/name/src/tags` + fallback для non-decor image).
2) Затем `map.json -> slides[N].imageAt` применяется как override (переименование slotId и/или forced binding).
3) После `dropAt/drop` индексы ремапятся по `elementId`; удалённые элементы исключаются из финальных `slots`.

Новые env-флаги:
- `IMAGEPLAN_AUTO_DETECT=true`
- `IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR=true`

### Manual проверка

1) Создать job (`themeId: teacher-dark` или `_example`).
2) Дождаться `state=completed`.
3) Проверить `imagePlan.json` и `diagnostics.json` в zip:

```bash
unzip -l out/<jobId>.out.zip | rg "imagePlan.json|diagnostics.json"
unzip -p out/<jobId>.out.zip imagePlan.json | jq .
unzip -p out/<jobId>.out.zip diagnostics.json | jq .
```

4) Убедиться:
- `imagePlan.version == 1`
- `slots` не пустой (если на слайдах есть placeholders)
- `returnValue.assemble.imageSlotCount`, `imageSlotsDroppedCount`, `imageSlotsInvalidCount`, `imagePlanMode` заполнены.

5) Если `slotCount=0`, проверить:
- `diagnostics.imagePlan.mode`
- `diagnostics.imagePlan.invalidReasons`
- `map.json -> slides[N].imageAt` (опционально)

### Placeholder нормализация

Перед генерацией fillKeys orchestrator делает best-effort нормализацию:
- `{{ key }}` -> `{{key}}`
- безопасная склейка split-runs вида `"{{" + "key" + "}}"`

Это уменьшает случаи, когда `{{key}}` пропускается и остаётся `TEST_key`.

## RAG integration (FastAPI microservice)

Orchestrator can enrich generation with retrieval results from external RAG service.

### Env vars

- `RAG_ENABLED=false`
- `RAG_FAIL_ON_ERROR=false`
- `RAG_BASE_URL=http://localhost:8000`
- `RAG_API_KEY=`
- `RAG_COLLECTION=default`
- `RAG_MODE=retrieve` (`retrieve|query`)
- `RAG_TOP_K=10`
- `RAG_MIN_SCORE=0.45`
- `RAG_TIMEOUT_MS=15000`
- `RAG_MAX_RETRIES=2`
- `RAG_RETRY_BASE_DELAY_MS=400`
- `RAG_MAX_CONTEXT_CHARS=12000`
- `RAG_MAX_HITS=12`
- `RAG_DEFAULT_SOURCE_URIS=` (CSV)
- `RAG_INCLUDE_IN_OUTZIP=true`

Job payload can override defaults:

```json
"rag": {
  "collection": "default",
  "sourceUris": ["s3://bucket/a.pdf"],
  "topK": 8,
  "minScore": 0.5,
  "mode": "retrieve"
}
```

### Local checks for RAG service

```bash
curl -s http://localhost:8000/healthz -H 'X-API-Key: <API_KEY>'
curl -s http://localhost:8000/readyz -H 'X-API-Key: <API_KEY>'
```

### Manual tests

A) `RAG_ENABLED=false`
- run a job and verify `GET /jobs/:id -> returnValue.rag.enabled=false`.

B) `RAG_ENABLED=true` + retrieve mode
- set `RAG_BASE_URL=http://localhost:8000`, `RAG_API_KEY=...`;
- create job (`teacher-dark` or `_example`);
- verify `returnValue.rag.ok=true` and `returnValue.rag.hitCount > 0`;
- verify `.tmp/<jobId>/rag.json` exists;
- verify `out/<jobId>.out.zip` contains `rag.json` when `RAG_INCLUDE_IN_OUTZIP=true`.

C) RAG unavailable
- set `RAG_ENABLED=true`, `RAG_BASE_URL=http://localhost:9999`;
- with `RAG_FAIL_ON_ERROR=false`: job should still complete and `returnValue.rag.ok=false`;
- with `RAG_FAIL_ON_ERROR=true`: job should fail with `RagFailed: ...`.


## LLM fallback diagnostics

Если в итоговом `doc.json` остаётся много `TEST_<key>`, проверьте:

1) `.tmp/<jobId>/llm.request.json` — какие `fillKeys` и prompt snippet ушли в модель.
2) `.tmp/<jobId>/llm/batch-*.request.json` — батчевые запросы (keys, prompt snippet).
3) `.tmp/<jobId>/llm/batch-*.response.txt` / `.parsed.json` / `.error.json`.
4) `out.zip -> diagnostics.json -> llm`:
   - `attempted`, `ok`, `parseOk`, `parseError`
   - `receivedKeysCount`, `missingKeysCount`
   - `usedFallbackForAll`
5) `out.zip -> diagnostics.json -> fills`:
   - `remainingTestTokensCount` и `remainingMustacheTokensCount`
   - `remainingSamples`

Быстрый признак причины:
- `usedFallbackForAll=true` + `parseError` => ответ не распарсился/не провалидировался.
- `parseError` содержит `aborted` => увеличьте `LLM_TIMEOUT_MS` и/или уменьшите `LLM_MAX_KEYS_PER_REQUEST`.
- `fillKeysCount=0` => placeholders не были найдены в template.
- `LLM_ENABLED=true` и пустой ключ => `error` с `LLMConfigError`.
- если `llm.ok=true`, но текст не заменился — проверь `diagnostics.fills.remainingTestTokensCount`.

Быстрый чек по VPS:
```bash
unzip -p out/<jobId>.out.zip diagnostics.json | jq ' .llm '
```

## Как включить DeepSeek + RAG (пошагово)

1. Убедитесь, что RAG сервис доступен на `http://localhost:8000` и проиндексированы источники.
2. В orchestrator `.env` заполните:

```env
RAG_ENABLED=true
RAG_BASE_URL=http://localhost:8000
RAG_API_KEY=super-secret-key
RAG_COLLECTION=default
RAG_MODE=retrieve
RAG_TOP_K=8
RAG_MIN_SCORE=0.45

LLM_ENABLED=true
LLM_FAIL_ON_ERROR=false
DEEPSEEK_API_KEY=<YOUR_DEEPSEEK_KEY>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
LLM_TIMEOUT_MS=300000
LLM_TOTAL_TIMEOUT_MS=600000
LLM_MAX_KEYS_PER_REQUEST=12
LLM_BATCH_MODE=bySlide
LLM_RETRIES=2
LLM_RETRY_BASE_DELAY_MS=400
LLM_RETRY_MAX_DELAY_MS=5000
LLM_RETRY_ON_ABORT=true
```

3. Перезапустите API и worker.
4. Отправьте `POST /jobs` (опционально с `rag.sourceUris`).
5. Проверьте `GET /jobs/:id`:
   - `returnValue.rag.ok=true` и `hitCount>0`;
   - `returnValue.llm.ok=true` и `model` заполнен;
   - `returnValue.assemble.imagePlanIncluded=true`.
6. Проверьте `.tmp/<jobId>/rag.json` и (если включено) `rag.json` внутри `out.zip`.

Если RAG недоступен и `RAG_FAIL_ON_ERROR=false`, worker продолжит без grounding-контекста.
Если DeepSeek недоступен и `LLM_FAIL_ON_ERROR=false`, worker использует fallback `TEST_<key>`.

Даже если RAG вернул пустые фрагменты, в LLM всегда передаётся `RAG_MINI_PROMPT`:
- сначала используй приложенные фрагменты;
- если их недостаточно — дополни ответ собственными знаниями без выдуманных ссылок `[n]`.

## Quality Gate v1 checks

```bash
unzip -p out/<jobId>.out.zip diagnostics.json | jq '.fills, .typography, .textFit, .imagePrompts'
unzip -p out/<jobId>.out.zip doc.json | rg "TEST_|{{"
```

Ожидаемо после Quality Gate:
- `.fills.finalRemainingTestTokensCount == 0`
- `.fills.finalRemainingMustacheTokensCount == 0`
- во втором выводе нет совпадений.
