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

Временные файлы фонов создаются в `.tmp/<jobId>/backgrounds/`, после чего используются как replacements при сборке zip.

Проверка:

```bash
unzip -l out/<jobId>.out.zip | rg "backgrounds/slide-"
unzip -p out/<jobId>.out.zip backgrounds/slide-1.png | wc -c
unzip -p out/<jobId>.out.zip backgrounds/slide-2.png | wc -c
```

Файлы должны существовать, и обычно фоновые PNG для разных слайдов будут отличаться.
