# Layout Engine v0

Layout engine v0 is a minimal foundation layer to separate **theme** (visual style) from **layout selection** (where placeholders are placed).

## Current capabilities

- Build layout catalog from `map.layouts` (if defined).
- Fallback catalog generation from existing `doc.json` placeholders.
- Deterministic per-slide layout selection by seed.
- Compile selected layout back into `doc` by ensuring all required placeholders exist.

## Runtime integration

Worker integration is feature-flagged:

- `LAYOUT_ENGINE_ENABLED=true` enables layout compilation.
- default is disabled to keep backward compatibility.

Diagnostics are exposed in:

- `diagnostics.json.layout`
- `returnValue.assemble.layoutSelectedCount`
- `returnValue.assemble.layoutInsertedTextPlaceholders`
- `returnValue.assemble.layoutInsertedImagePlaceholders`
