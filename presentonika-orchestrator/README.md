# Сервис сборки презентаций

Orchestrator принимает задачу от WordPress, собирает презентацию из шаблона и сохраняет готовый `out.zip`. API и воркер запускаются отдельно, а очередь хранится в Redis.

## Как это работает

1. API принимает задачу и кладёт её в очередь.
2. Воркер открывает набор шаблонов и выбирает подходящие макеты.
3. Текст заполняется через модель, при необходимости добавляются материалы из RAG.
4. Сервис подставляет картинки, собирает архив и проверяет результат.
5. Готовый файл отправляется обратно в WordPress.

## Быстрый запуск

Нужны Node.js 20 и Redis.

```bash
npm ci
cp .env.example .env
npm run dev
```

По умолчанию API доступен на `http://localhost:8080`.

Проверка состояния:

```bash
curl http://localhost:8080/health
```

## Основные команды

```bash
npm run typecheck
npm test
npm run build
npm run theme:validate -- teacher-dark
```

## Наборы шаблонов

Каждый набор лежит в `themes/<themeId>/` и обычно содержит:

```text
theme.json
map.json
template.out.zip
preview.jpg
```

Локальные рабочие шаблоны можно держать в `themes-local/` и `layouts-local/`. Эти папки не нужно добавлять в Git.

Проверить набор:

```bash
npm run theme:inspect -- teacher-dark
npm run theme:validate -- teacher-dark
```

## API

- `GET /health` — состояние сервиса;
- `POST /jobs` — создать задачу;
- `GET /jobs/:id` — получить состояние и результат.

Рабочие маршруты защищены заголовком `X-Orchestrator-Key`. Значение берётся из `PRESENTONIKA_ORCHESTRATOR_KEY`.

## Запуск через Docker

```bash
cp .env.prod.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

Перед первым запуском нужно создать общую сеть:

```bash
docker network create presentonika_shared
```

Секреты задаются только через `.env` на сервере. Файлы `.env`, временные архивы, логи и локальные шаблоны в репозиторий не добавляются.
