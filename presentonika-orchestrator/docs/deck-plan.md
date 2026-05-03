# DeckPlan API

DeckPlan is the scenario contract for a generated presentation. It is separate from layouts and theme design: it describes the central question, thesis, slide roles, claims, required counts, expected evidence, and global coherence rules.

## 1. Generate a Plan

```bash
curl -X POST "https://YOUR_ORCHESTRATOR/plans" \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: YOUR_KEY" \
  -d '{
    "topic": "Османская империя",
    "subject": "history",
    "grade": "7",
    "language": "ru",
    "slideCount": 10,
    "presentationType": "auto",
    "themeId": "teacher-dark",
    "constraints": {
      "depth": "school",
      "tone": "clear",
      "includeQuiz": true,
      "includeHomework": true
    }
  }'
```

Response:

```json
{
  "ok": true,
  "deckPlan": {
    "version": 1,
    "topic": "Османская империя",
    "subject": "history",
    "grade": "7",
    "language": "ru",
    "slideCount": 10,
    "presentationType": "causes_consequences",
    "centralQuestion": "...",
    "thesis": "...",
    "slides": [
      {
        "slide": 1,
        "role": "frame",
        "titleIntent": "Set the central question and lesson frame.",
        "claim": "...",
        "mustInclude": ["..."],
        "mustAvoid": ["..."],
        "requiredItems": [],
        "expectedEvidence": []
      }
    ],
    "globalRules": [
      "Treat the deck as one coherent lesson, not independent slides.",
      "Each slide must advance the central question.",
      "Do not repeat the thesis on every slide."
    ],
    "source": "llm",
    "createdAt": "2026-05-03T00:00:00.000Z"
  },
  "diagnostics": {
    "source": "llm",
    "llmUsed": true,
    "model": "deepseek-chat",
    "timingMs": 1200
  }
}
```

If planner LLM is disabled or unavailable, `/plans` returns a valid deterministic fallback DeckPlan:

```json
{
  "ok": true,
  "diagnostics": {
    "source": "deterministic",
    "llmUsed": false,
    "fallbackReason": "PLAN_LLM_ENABLED!=true"
  }
}
```

## 2. Send a Plan to Jobs

After the site shows or edits the plan, send it in the existing `/jobs` payload:

```bash
curl -X POST "https://YOUR_ORCHESTRATOR/jobs" \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: YOUR_KEY" \
  -d '{
    "presentationId": 123,
    "userId": 1,
    "topic": "Османская империя",
    "themeId": "teacher-dark",
    "language": "ru",
    "deckPlan": { "...": "DeckPlan from /plans or user-edited DeckPlan" },
    "save": {
      "endpoint": "https://example.com/wp-json/presentonika/v1/save",
      "presentationId": 123,
      "saveToken": "TOKEN"
    }
  }'
```

`deckPlan.source = "user_edited"` is accepted if the object passes schema validation.

## 3. Behavior Without DeckPlan

Existing `/jobs` requests still work. If `deckPlan` is absent, the worker builds a deterministic fallback plan and uses it for prompt context and diagnostics. It does not make a hidden planner LLM call inside `/jobs`.

## 4. Cost Controls

Planner cost is controlled by API service environment variables:

```bash
PLAN_GENERATION_ENABLED=true
PLAN_LLM_ENABLED=false
PLAN_MODEL=deepseek-chat
PLAN_MAX_OUTPUT_TOKENS=1200
PLAN_TIMEOUT_MS=30000
PLAN_FAIL_ON_ERROR=false
PLAN_API_KEY=
PLAN_BASE_URL=https://api.deepseek.com
```

`/plans` is the only explicit planner entry point. Fill generation in `/jobs` does not call the planner.
