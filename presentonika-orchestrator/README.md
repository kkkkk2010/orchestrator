# Presentonika Orchestrator (API + Queue)

## Run

```bash
docker compose up -d
npm i
cp .env.example .env
npm run dev
```

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
    "themeId": "modern-dark",
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
