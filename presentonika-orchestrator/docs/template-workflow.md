# Template workflow (без хранения бинарников в git)

## 1) Создание шаблона в редакторе
1. Откройте teacher skeleton (10 слайдов) и тему (`teacher-dark|teacher-light|teacher-bright`).
2. Для каждого текстового блока добавьте placeholder вида `{{sN_key}}`.
3. Для image-placeholder используйте отдельные image-элементы (не decor/background).
4. Проверьте, что ключи из `docs/teacher-skeleton.md` присутствуют в template.

## 2) Экспорт template.out.zip
1. Экспортируйте `template.out.zip` из редактора.
2. Положите файл локально (не в git):
   - `themes-local/<themeId>/template.out.zip`
3. Убедитесь, что рядом есть `map.json`, `theme.json`, `meta.json`.

## 3) Проверка качества шаблона
```bash
npm run template:qa -- <themeId>
npm run theme:validate -- <themeId>
```

`template:qa` делает отчёт:
- слайды и placeholder keys;
- `missingKeysInTemplate`;
- `duplicateKeysLocations`;
- `textElementsWithoutPlaceholders`;
- image summary.

JSON-отчёт: `.tmp/template-qa/<themeId>.report.json`.

## 4) Полуавтоматическая правка (best-effort)
```bash
npm run template:patch -- <themeId> --from-report
npm run template:patch -- <themeId> --from-report --apply
```

- без `--apply` это dry-run;
- c `--apply` создаётся `themes-local/<themeId>/template.patched.out.zip`.

> Важно: patch best-effort, перед продом обязательно проверить вручную.

## 5) Deploy на VPS
1. Скопируйте `themes-local/<themeId>/` на VPS (через `rsync`/`scp`).
2. В `.env` задайте:
   - `THEMES_DIR=themes-local`
3. Перезапустите сервисы orchestrator.
4. Повторно прогоните `template:qa` и `theme:validate` на VPS.

## 6) Примеры rsync/scp
```bash
rsync -av themes-local/ user@vps:/opt/presentonika/orchestrator/themes-local/
scp themes-local/teacher-dark/template.out.zip user@vps:/opt/presentonika/orchestrator/themes-local/teacher-dark/
```
