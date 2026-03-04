# Template Assistant Guide (CLI-only)

## Быстрый старт
```bash
npm run template:generate -- teacher-dark
npm run template:qa -- teacher-dark --zip themes-local/teacher-dark/template.generated.out.zip
```

## Что делает template:generate
- Берёт базовый `template.out.zip` по `THEMES_DIR` (или fallback `themes`).
- Генерирует 10-слайдовый teacher skeleton doc с placeholder-ключами.
- Пишет результат в `themes-local/<themeId>/template.generated.out.zip`.
- Автоматически запускает QA и сохраняет отчёт в `.tmp/template-qa/<themeId>.generated.report.json`.

## Как понять, что шаблон готов
В отчёте должно быть:
- `missingKeysInTemplate: []`
- `slideCount: 10`
- `imageElementsSummary.placeholderLikeCount > 0`

## Визуальная проверка
1. Запустить orchestrator с `THEMES_DIR=themes-local`.
2. Создать тестовый job для `teacher-dark`.
3. Открыть полученный `out.zip` в editor и проверить:
   - все текстовые блоки заполнены;
   - image slot'ы отображаются в image picker.

## Как подкрутить layout
- Открой `src/tools/templateGenerate.ts`.
- Правь bbox в `makeLayout()` (x/y/width/height).
- Перегенерируй:
  ```bash
  npm run template:generate -- teacher-dark
  ```
