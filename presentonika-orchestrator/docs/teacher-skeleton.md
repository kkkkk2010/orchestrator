# Teacher Skeleton (10 slides)

This is the Stage 11 baseline skeleton for teacher-oriented themes.

## Slide intent and required keys

1. **Cover**: `s1_title`, `s1_subtitle`, `s1_meta` + image slot `s1_hero`
2. **Goals/Plan**: `s2_title`, `s2_goals`, `s2_plan`
3. **Hook (seed A/B)**:
   - A: `s3_title`, `s3_hook_question`, `s3_hook_hint`
   - B: `s3_title`, `s3_hook_fact`, `s3_hook_why`
4. **Definition**: `s4_title`, `s4_definition`, `s4_keywords`
5. **Bullets (fillLength oneCol/twoCol)**: `s5_title`, `s5_bullets`
6. **Two columns**: `s6_title`, `s6_left_title`, `s6_left_bullets`, `s6_right_title`, `s6_right_bullets`
7. **Timeline (seed A/B)**: `s7_title`, `s7_step1`, `s7_step2`, `s7_step3`, `s7_step4`
8. **Examples + image (fillLength oneCol/twoCol)**: `s8_title`, `s8_examples` + image slot `s8_image`
9. **Practice (seed A/B)**:
   - A quiz: `s9_title`, `s9_q1`, `s9_q2`, `s9_q3`
   - B task: `s9_title`, `s9_task`
10. **Summary/Homework (presence rule)**: `s10_title`, `s10_summary`, `s10_homework`, `s10_sources`

## Choose rules

- Slide 3: `choose.mode = "seed"` (`A` / `B`)
- Slide 5: `choose.mode = "fillLength"` by `s5_bullets` (`oneCol` / `twoCol`)
- Slide 7: `choose.mode = "seed"` (`A` / `B`)
- Slide 8: `choose.mode = "fillLength"` by `s8_examples` (`oneCol` / `twoCol`)
- Slide 9: `choose.mode = "seed"` (`A` / `B`)
- Slide 10: `choose.mode = "fillLength"` by `s10_homework` (`noHw` / `withHw`)

## Recommended thresholds

- `s5_bullets`: `320`
- `s8_examples`: `380`
- `s10_homework`: `2`

## Notes

- `map.json` keeps 1-based slide keys.
- `variants[*].dropAt` are placeholders until final template indices are known.
- Use `npm run theme:inspect -- <themeId>` to map real element indices once a true 10-slide template is prepared.
