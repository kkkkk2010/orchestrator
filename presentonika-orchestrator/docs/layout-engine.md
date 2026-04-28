# Layout Engine

## Архитектура

- **Theme = style**: `theme.json` (цвета, типографика, параметры фона).
- **Layout = structure**: 1-slide pack (`layout.out.zip` + `layout.json`).

Layout packs хранятся локально и **не должны коммититься**.

## Каталоги

Primary (rw):

- `layouts-local/<layoutId>/layout.out.zip`
- `layouts-local/<layoutId>/layout.json`
- `layouts-local/<layoutId>/preview.jpg` (optional)

Fallback (ro):

- `layouts/<layoutId>/layout.out.zip`
- `layouts/<layoutId>/layout.json`

## Включение

```bash
LAYOUT_ENGINE_ENABLED=true
LAYOUT_ENGINE_DIR=layouts-local
LAYOUT_ENGINE_FAIL_ON_MISSING_LAYOUT=false
LAYOUT_ENGINE_VARIATION=true
LAYOUT_DEBUG_LABEL=true
```

Если engine не может собрать раскладку и `FAIL_ON_MISSING_LAYOUT=false`, worker делает `legacy_fallback` на старый template pipeline.

## Docker/VPS

`docker-compose.yml` и `docker-compose.prod.yml` уже включают layout engine и монтируют внешний каталог:

```yaml
./layouts-local:/app/layouts-local:ro
```

Для тестового прогона `LAYOUT_DEBUG_LABEL=true` добавляет в левый верхний угол каждого слайда подпись вида `layout: edu-cover-a`.
Выключить можно через `LAYOUT_DEBUG_LABEL=false`.

Для тестового деплоя достаточно распаковать архив с layout pack в корень проекта на VPS так, чтобы появился каталог:

```bash
layouts-local/<layoutId>/layout.json
layouts-local/<layoutId>/layout.out.zip
```

После этого можно пересобрать и поднять сервисы:

```bash
docker compose build
docker compose up -d
```

В production compose используется тот же mount; если запускаете его явно, команда такая:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## Импорт нового layout

1. Сделайте 1-slide layout в редакторе и экспортируйте `out.zip`.
2. Импортируйте в библиотеку:

```bash
npm run layout:import -- --zip ./my-cover.out.zip --id my-cover-v1 --slideType cover
```

3. Проверьте:

```bash
npm run layout:validate -- my-cover-v1
npm run layout:inspect -- my-cover-v1
```

4. Запустите job с `LAYOUT_ENGINE_ENABLED=true`.

## Built-in fallback

Если пользовательские layouts отсутствуют, orchestrator использует встроенные teacher-layouts для 10-слайдового плана.

## Диагностика

`diagnostics.json` содержит `layoutEngine`:

- `enabled`
- `mode` (`catalog`, `builtins`, `legacy_fallback`)
- `selectedLayouts[]`
- `missingLayoutTypes[]`
- `slotBindingWarnings[]`
- `mergedAssetsCount`
