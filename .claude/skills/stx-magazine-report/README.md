# stx-magazine-report — design notes

## What this skill is

A content-agnostic magazine-quality report generator. The skill turns any
analytical brief — a blood panel, a GTM deck, a 10-K, an interview corpus, a
renovation plan — into a single self-contained `.html` file in the visual
register of a printed magazine. Cover, chapters, pull quotes, action cards
with pill badges, severity meters, click-to-expand detail library, donut/bar
charts, closing prediction band. Print-friendly, mobile responsive, no
build step.

## Origin

Generalized from two production-tested deliverables in May 2026:

- The **Apurba Dev** health magazine (Crimson Sunday Supplement palette,
  DM Serif Display + Playfair Display + Bebas Neue + Inter).
- The **Veew** GTM + onboarding briefs (Navy Strategy Brief and Veew Teal
  Field Guide palettes, Fraunces + Inter + JetBrains Mono).

Both shipped to non-specialist readers. Both made the reader understand the
subject deeply and walk away with a concrete plan of action. The structure,
voice, and styling rules were factored out of those documents into a reusable
prompt template, and that template is the canonical content of
[`prompt.md`](./prompt.md).

## Why ship it as a skill

The reusable prompt works as a copy-paste artifact, but as a slash command it:

1. **Confirms inputs in an interview pass** instead of asking the user to fill
   `[BRACKETS]` correctly the first time.
2. **Enforces the locale rule** at the rendering step — generic placeholders
   are forbidden, and the assistant has a procedural checkpoint for that.
3. **Picks a sensible output location** under the working folder, with
   overwrite confirmation.
4. **Runs the sanity-check list** before writing (numerical splits sum, every
   Detail Library card has components + method, every action card has ≥2 pill
   badges, no hex outside `:root`, etc.).
5. **Returns the standard chat reply** — top 3 findings + the file link, no
   preamble or postamble — automatically.

## Where it sits in the skill model

`zone: any` — runs anywhere. The skill writes a single `.html` file and
never mutates source code or git state. Safe in main, safe in any worktree,
safe in a non-repo working folder.

It is **not** worktree-bound: the deliverable is a stand-alone artifact, not
a record of code changes. (If you want the latter, that's `/stx-worktree-report`.)

## Four style palettes

The skill ships with four palettes. Pick by topic register:

| Style | Register | Best for | Font stack |
|---|---|---|---|
| #1 Navy Strategy Brief | McKinsey-meets-Monocle | GTM, board reports, investment memos, audits | Fraunces + Inter + JetBrains Mono |
| #2 Veew Teal Field Guide | Warmer handbook, onboarding | Playbooks, onboarding, walkthroughs, customer-facing | Same as #1, warmer cream, teal accents |
| #3 Crimson Sunday Supplement | Lifestyle magazine (Vogue / Cereal / Kinfolk) | Health, wellness, travel, food | DM Serif Display + Playfair Display + Bebas Neue + Inter |
| #4 Surprise me | Claude picks | Anything that doesn't fit the others | Claude picks |

`#4` requires the assistant to **state the choice in 2 lines before
rendering** — so the user knows what they're getting before the file is
written.

## Customisation tips

- **New palette.** Add a new section to `prompt.md` with the same shape as
  the existing four: register one-liner, font stack, palette variables,
  cover treatment, accent uses.
- **New chapter.** The chapter list in step 4 is a default rhythm, not a
  hard schema. Adapt names to the topic but keep the rhythm.
- **Topic-specific estimators.** If the topic has a natural time/cost/effort
  estimator, include the small JS function that derives the badge value from
  keywords in the method text (examples in the prompt).
- **Second audience.** If the user wants a companion view (spouse, co-founder,
  parents), generate it as a second file with the same palette but adapted
  chapters — same disclaimer, different lens.

## Anti-patterns

- ❌ Generic placeholders ("local gym", "your nearest market"). The locale
  rule is non-negotiable.
- ❌ External JS / CSS beyond Google Fonts. The file must work offline once
  fonts are cached.
- ❌ Hardcoded hex outside `:root`. Every color reference goes through a
  CSS variable.
- ❌ Per-card click handlers. One delegated handler at the end of `<body>`.
- ❌ Numerical splits that don't sum to the stated target.
- ❌ Committing the report. Leave the file uncommitted.

## See also

- [`SKILL.md`](./SKILL.md) — procedural instructions for Claude.
- [`prompt.md`](./prompt.md) — copy-paste template for use outside the skill.
