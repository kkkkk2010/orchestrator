# DeckPlan UI Integration

This document describes the backend contract for the future DeckPlan editor UI.

## 1. Create A Plan

Call `POST /plans` with the same `X-Orchestrator-Key` used by `/jobs`.

```bash
curl -X POST "https://ORCHESTRATOR_HOST/plans" \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $PRESENTONIKA_ORCHESTRATOR_KEY" \
  -d '{
    "topic": "Османская империя",
    "subject": "history",
    "grade": "7",
    "language": "ru",
    "slideCount": 10,
    "presentationType": "auto",
    "constraints": {
      "includeQuiz": true,
      "includeHomework": true,
      "depth": "school"
    }
  }'
```

## 2. Response Shape

`/plans` returns both the canonical `deckPlan` and a compact `planForUi`.

```json
{
  "ok": true,
  "deckPlan": {
    "version": 1,
    "topic": "Османская империя",
    "language": "ru",
    "slideCount": 10,
    "presentationType": "historical_overview",
    "centralQuestion": "...",
    "thesis": "...",
    "slides": []
  },
  "planForUi": {
    "version": 1,
    "topic": "Османская империя",
    "language": "ru",
    "slideCount": 10,
    "presentationType": "historical_overview",
    "centralQuestion": "...",
    "thesis": "...",
    "slides": [
      {
        "slide": 1,
        "slideType": "cover",
        "role": "frame",
        "titleIntent": "...",
        "claim": "...",
        "mustInclude": ["...", "..."],
        "mustAvoid": ["..."],
        "requiredItems": [],
        "visualSuggestions": [],
        "editable": true
      }
    ],
    "editableFields": {
      "basic": [
        "centralQuestion",
        "thesis",
        "presentationType",
        "slides[].slideType",
        "slides[].role",
        "slides[].titleIntent",
        "slides[].claim",
        "slides[].mustInclude",
        "slides[].mustAvoid"
      ],
      "advanced": [
        "slides[].requiredItems",
        "slides[].visualSuggestions"
      ]
    },
    "uiWarnings": []
  },
  "diagnostics": {
    "source": "llm",
    "llmUsed": true
  }
}
```

The canonical `deckPlan` is the object to send back to `/jobs`. `planForUi` is a UI-friendly view of the same editable scenario fields.

## 3. Fields To Show

Show these basic fields in the first editor UI:

- `centralQuestion`
- `thesis`
- `presentationType`
- `slides[].slide`
- `slides[].slideType`
- `slides[].role`
- `slides[].titleIntent`
- `slides[].claim`
- `slides[].mustInclude`
- `slides[].mustAvoid`

Advanced fields:

- `slides[].requiredItems`
- `slides[].visualSuggestions`

`requiredItems` are technical enough that the first UI can hide them by default. They only apply to countable content slots such as `goals`, `plan`, `bullets`, `examples`, `questions`, `steps`, `keywords`, and `summary`.

## 4. Fields To Hide

Do not show these as editable plan fields:

- `selectedLayoutId`
- `resolvedLayoutSlideType`
- `fillKeys`
- `deckPlanRoute`
- `diagnostics`
- `layoutIds`
- `imageAt`

Those are runtime diagnostics or layout internals, not the teacher's scenario.

## 5. Sending Edited Plans To Jobs

When the user approves or edits the plan, send the whole canonical `deckPlan` back to `/jobs` and set `source` to `user_edited`.

```bash
curl -X POST "https://ORCHESTRATOR_HOST/jobs" \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $PRESENTONIKA_ORCHESTRATOR_KEY" \
  -d '{
    "presentationId": 123,
    "userId": 1,
    "topic": "Османская империя",
    "themeId": "teacher-dark",
    "language": "ru",
    "deckPlan": {
      "version": 1,
      "topic": "Османская империя",
      "language": "ru",
      "slideCount": 10,
      "presentationType": "historical_overview",
      "centralQuestion": "...",
      "thesis": "...",
      "slides": [],
      "globalRules": [],
      "source": "user_edited",
      "createdAt": "2026-05-05T00:00:00.000Z"
    },
    "save": {
      "endpoint": "https://SITE/wp-json/presentonika/v1/save-outzip-from-url",
      "presentationId": 123,
      "saveToken": "..."
    }
  }'
```

`/jobs` does not call the LLM planner. If `deckPlan` is missing, the worker builds a deterministic fallback DeckPlan and still uses Dynamic DeckPlan mode.

## 6. Minimal Site Validation

Before sending edited plans:

- keep `version = 1`;
- keep `slideCount` equal to `slides.length`;
- keep slide numbers unique and ordered;
- keep every `slideType` in the allowed list;
- keep `centralQuestion`, `thesis`, `titleIntent`, and `claim` non-empty;
- keep `source = "user_edited"` after user changes.

If `/jobs` rejects the edited plan, show the validation error and let the user fix the plan or request a new `/plans` result.

## 7. Fallbacks And Warnings

If the planner LLM is disabled or fails, `/plans` returns a deterministic fallback:

```json
{
  "diagnostics": {
    "source": "deterministic",
    "llmUsed": false,
    "fallbackReason": "PLAN_LLM_ENABLED!=true"
  }
}
```

Warnings from `diagnostics.planDiagnostics.warnings` are mirrored into `planForUi.uiWarnings`. They are not fatal; they help the UI highlight a vague or unusual plan.

Common warning codes:

- `quiz_before_core_content`
- `summary_not_last_or_near_last`
- `timeline_after_quiz`
- `missing_route_slide`
- `missing_summary_slide`
- `repeated_slide_type_too_often`
- `empty_must_include`
- `auto_presentation_type_not_resolved`
