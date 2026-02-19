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
