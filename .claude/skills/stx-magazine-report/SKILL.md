---
name: stx-magazine-report
description: Produce a magazine-style single-file HTML deliverable from any analytical source — health reports, GTM strategy, investment memos, portfolio reviews, technical audits, renovation plans. Drives an interview → analysis → render flow against the embedded reusable prompt template, lets the user pick one of four editorial style palettes (Navy Strategy Brief, Veew Teal Field Guide, Crimson Sunday Supplement, or Surprise-me), and writes a self-contained `*.html` to the working folder with a cover, chapters, pull quotes, action cards, severity meters, click-to-expand detail library, donut/bar charts, and closing prediction band.
version: 1.11.0
author: STX
zone: any
---

# /stx-magazine-report

A content-agnostic magazine-quality report generator. Given any source material (PDF, doc, deck, data file, interview notes, financial filing) and a few inputs about the subject, the skill renders a single self-contained HTML file in the visual register of a printed magazine — cover, chapters, pull quotes, action cards with pill badges, expand-on-tap detail sections, severity meters, donut/bar charts where useful, and a closing prediction band.

The same flow works for:

- Health reports / wellness plans
- GTM strategies and onboarding playbooks
- Investment memos and 10-K teardowns
- Portfolio reviews and quarterly updates
- Product / competitor / technical audits
- Renovation plans, travel itineraries, syllabi

## When to use it

- The deliverable benefits from editorial polish, not just a bulleted summary.
- A non-specialist reader needs to deeply understand the subject and walk away with a concrete plan of action.
- A printable, shareable artifact is wanted (PDFable, print-friendly).

Skip it for:

- Short answers, code review notes, or one-page summaries — markdown is enough.
- Operational dashboards (numbers that move every day) — magazine output is point-in-time.
- Anything where the visual register would feel out of place (terse internal status updates).

## Zone

`zone: any` — runs anywhere. It writes a single `.html` file under the working folder (or a topic-named subfolder) and never mutates source code or git state.

## Inputs the skill collects

Before rendering, the skill confirms these variables. If the user supplied them on the command line or in the opening message, don't re-ask. Otherwise ask **only 1–2** essential clarifying questions and proceed with reasonable assumptions for the rest.

| Field | Example |
|---|---|
| Source material | Blood report PDF · GTM deck · 10-K filing · customer interview transcripts |
| Subject name | Apurba Dev · Acme Robotics · Q3 portfolio · The Henderson kitchen reno |
| Subject context | 59 / Male / Kolkata / sedentary · Pre-seed B2B SaaS · 2 founders · $400k raised |
| Topic / domain | Cardiometabolic health · GTM for a vertical SaaS · 12-month founder onboarding |
| Locale / region | Kolkata, India · London, UK · NYC, US · Berlin, DE |
| Constraints | 1200 kcal/day · $250k budget · 3-person team · ship by Q1 |
| Style | #1 Navy Blue · #2 Veew Teal · #3 Crimson Magazine · #4 Surprise me |

## Procedure (when invoked as `/stx-magazine-report`)

### Step 1 — Confirm scope

1. If the user attached a source file (PDF / doc / deck / spreadsheet / transcripts), read it. If they pasted text inline, use that.
2. If essential inputs are missing (subject, topic, style, locale), ask **1–2** clarifying questions. Do not over-clarify. Proceed with reasonable assumptions for the rest and state them inline in the deliverable.
3. Resolve output path. Default: `<cwd>/<subject-slug>-magazine.html`. If a topic-named subfolder makes sense (e.g., `docs/<subject-slug>/index.html`), prefer that.
4. If the resolved file exists, **ask before overwriting.**

### Step 2 — Analyze the source

1. **Read the entire source** and identify what's strong, weak, missing, or risky.
2. **Cross-correlate findings.** Tell the connected story, not isolated facts. Show how one issue cascades into others.
3. **Compare to a relevant benchmark.** Peers, prior-year, industry-typical, age/stage-appropriate. Call out where the subject sits on the distribution.
4. **Rank the top 3–5 issues or opportunities** in order of urgency or leverage.

### Step 3 — Pick the style

The skill ships with four palettes (full spec in `prompt.md`):

1. **#1 Navy Blue — "The Strategy Brief"** — serious, editorial, McKinsey-meets-Monocle. Best for GTM plans, board reports, investment memos, strategic audits. `Fraunces` + `Inter` + `JetBrains Mono`.
2. **#2 Veew Teal — "The Founder's Field Guide"** — warmer, more handbook in feel. Best for product playbooks, onboarding guides, technical walkthroughs, customer-facing reports. Same font stack as #1, warmer cream, teal-dominant accents.
3. **#3 Crimson Magazine — "The Sunday Supplement"** — lifestyle magazine register (Vogue / Cereal / Kinfolk). Best for health magazines, wellness plans, travel itineraries, food/recipe-driven reports. `DM Serif Display` + `Playfair Display` + `Bebas Neue` + `Inter`.
4. **#4 Surprise me** — pick a palette and font stack that fits the topic. State the choice in 2 lines before rendering ("I went with forest-green + ochre in `Fraunces` + `Inter` because the subject is a sustainable-agriculture audit and the register should feel grounded, not corporate."). Then render the whole document in that system. Follow the same structural rules as #1–#3.

Use the variables for the chosen style — every chapter, card, badge, severity meter, and footer references CSS variables defined once at `:root`. **No hardcoded hex values outside `:root`.**

### Step 4 — Render the deliverable

Render a single self-contained HTML file with these chapter sections, in this order. Adapt the names to the topic but keep the rhythm:

1. **Cover** — masthead, hero headline, deck (subtitle), subject meta block (name, key attributes, date), 2–4 risk/theme tags, one dramatic hero stat in a circular "pulse" art element.
2. **The 60-Second Read (TL;DR)** — dark card with subject block + 5–6 score cards highlighting top findings with status flags (`CRITICAL` / `STRONG` / `WATCH` / `OK`).
3. **Chapter 02 · Analysis** — finding cards in a 2-column grid. Each card: icon (emoji or SVG), name, status badge, key number(s) with reference range or benchmark, colored severity meter with pin, "plain English" explainer (italic, with **one metaphor**), subject-specific implication, "what this affects" pill tags. Include one reassuring **"What's actually fine"** card at the end.
4. **Chapter 03 · Targets** — table with columns: *Metric · Where You Are · Reasonable Goal · Stretch Goal · Realistic Timeline*. Cover every important out-of-range metric.
5. **Constraints Panel** — dark callout reminding the reader what stays outside this document's scope (legal, medical, financial advice; specific specialist input; regulator sign-off; etc.). This magazine is supporting cast.
6. **Chapter 04 · [Action Domain A]** — e.g. Food, Channels, Hiring, Capital Allocation. Include any quantitative split as an SVG donut or bar (macros, budget %, time allocation), broken into ~5 buckets with concrete numbers, plus three traffic-light zones (🟢 Lean Into / 🟡 Use Sparingly / 🔴 Avoid) populated with **locally / contextually specific** items.
7. **Pull quote** — a magazine-style large italic quote in a band across the page. Short, declarative, quotable.
8. **Chapter 05 · [Action Domain B]** — 6 action cards. Each: icon, name, dose (frequency / duration / cadence), 2–3 line detail with **specific, locally-grounded references** (real places, real tools, real vendors), and **pill-shaped badges** showing which top-level issues this addresses.
9. **Weekly Schedule (or Quarterly Roadmap)** — grid showing the time horizon × ~4 slots per row with color-coded activity blocks.
10. **Chapter 06 · [Action Domain C]** — 6–8 action cards in the same format with pill badges.
11. **Chapter 07 · [The Detail Library]** — a deep, click-to-expand section. Group into ~4 categories. Each category has a header with a quantitative target badge and 8–10 detail cards.
12. **Chapter 08 · [The Resource List]** — 5–6 shopping/tool/vendor cards with **specific local links**. Each item gets a direct "Open" link with a real working search query for the right local provider.
13. **Outcome quote** — bold prediction band at the end ("If you give this 12 weeks…" / "If you ship this in Q1…").
14. **Footer** — magazine title, edition info, full appropriate disclaimer for the topic.

### Step 5 — The click-to-expand detail library

Cards in the **Detail Library** chapter must be **click-to-expand**. Default state shows only icon, name, key metric tag, time/cost tag, and a "Tap to view details" hint with a chevron. On click, the card expands smoothly to reveal:

- **Components as chip-style tags** (parsed from a comma-separated list)
- **Method / steps** in italic prose
- **"Why this works"** — a category-specific tip (different for each of the ~4 categories)

The chevron rotates, the icon does a tiny tilt, and the card border shifts to a warm accent color when open. Use **a single JavaScript handler at the bottom of `<body>`** that wires up every card by class — do **not** write per-card handlers.

If the topic has a natural time/cost/effort estimator, include a small JS function that derives the badge value from keywords in the method text (e.g. "marinate" → +20min, "pressure-cook" → 22min, "raw" → 5min; or for GTM: "outbound" → 6 weeks, "PLG motion" → 12 weeks).

### Step 6 — Localization & specificity rules

- **Reference the subject's actual locale.** Real cities, neighborhoods, parks, markets, clubs, schools, tools, vendors. Generic placeholders are forbidden.
- **All external links must be real working search-query URLs** for locally popular providers (e.g. `https://blinkit.com/s/?q=palak`, `https://www.tesco.com/groceries/en-GB/search?query=spinach`, `https://www.amazon.com/s?k=resistance+bands`).
- **Mix 1–2 cross-cultural pivots per category** for variety, but keep the spine local.
- **Numerical targets must add up** to whatever budget / calorie / time / capital constraint the brief specified.

### Step 7 — Sanity checks before writing the file

- Confirm any numerical splits (budget %, calories, time allocation, capital allocation) sum to the target.
- Confirm every Detail Library card has both the components list and the method prose.
- Confirm every action card has at least 2 pill badges.
- Confirm the click-to-expand JS is at the end of `<body>` and the CSS hides the `.detail-*` content by default.
- Confirm every external link is a valid search-query URL for the locally relevant provider.
- Confirm the chosen style's CSS variables are defined once at `:root` and every color in the document references them — no hardcoded hex outside `:root`.

### Step 8 — Write and report back

1. Write the filled-in HTML to the resolved output path. Create the parent folder if needed.
2. Tell the user the absolute path and one open command: `open <abs-path>`.
3. Reply in chat with **top 3 findings + the link**. No long preamble or postamble.
4. **Do not commit.** Per global CLAUDE.md, every commit needs explicit approval — this skill never commits.

## Layout & responsiveness (all styles)

- **Max-width:** 1100px, generous padding (48–72px vertical between chapters).
- **Two-column grids** collapse to single column under 900px.
- **Print-friendly:** include `@media print` rules so cards don't break across pages, and severity meters print legibly in grayscale.
- **Mobile responsive:** cover, donut, schedule grid, and detail library all reflow.
- **Self-contained.** No external CSS or JS dependencies except Google Fonts.

## Voice and tone

- Editorial voice, not clinical or corporate. Warm, direct, occasionally cheeky.
- **Bold** for key takeaways, *italic* for technical or quoted terms.
- Every finding card explainer should include **one plain-English metaphor**. (Examples from past work: HDL = "the garbage truck", hs-CRP = "smoke alarm", churn rate = "the bucket's leak rate", CAC payback = "how many months until the well refills".)
- Be honest about urgency without being alarmist. Phrases like *"the clock has started"*, *"the chassis is sound — it's the engine tuning"*, *"the foundation holds — what's missing is the roof"* work well.
- Pull-quote band lines should feel **quotable**: short, declarative, italic.

## Optional follow-ups the user may request

- A printable A4 PDF version
- A printable one-page checklist or "fridge magnet" summary
- A tracking sheet (xlsx) with the right metric columns for the topic
- Specific deep-dive research on one finding (drug interactions, competitor teardown, tax treatment, etc.)
- Translation to a regional language
- A companion view for a second audience (the spouse cooking the meals · the co-founder running ops · the parents of the student)

## Usage

```
/stx-magazine-report                                       # fully interactive
/stx-magazine-report --style 2 --locale "Kolkata, India"   # pre-supply choices
/stx-magazine-report --output ./reports/q3-portfolio.html  # explicit output
```

Suggested flags (the assistant accepts any of these, but the canonical interview always confirms the rest):

| Flag | Meaning |
|---|---|
| `--style <1|2|3|4>` | Choose the palette (Navy / Veew Teal / Crimson / Surprise me) |
| `--subject "<name>"` | Subject name |
| `--topic "<domain>"` | Topic / domain |
| `--locale "<city>"` | Locale for localized vendor links |
| `--source <path>` | Path to a source file to read |
| `--output <path>` | Override the output `.html` location |

## Anti-patterns

- ❌ Generic placeholders ("local gym", "your nearest market"). The locale rule is non-negotiable.
- ❌ External JS / CSS beyond Google Fonts. The file must work offline once fonts are cached.
- ❌ Hardcoded hex outside `:root`. Every color reference goes through a CSS variable.
- ❌ Per-card click handlers. One delegated handler at the end of `<body>`.
- ❌ Numerical splits that don't sum to the stated target.
- ❌ Committing the report. Leave the file uncommitted.

## See also

- [`prompt.md`](./prompt.md) — the canonical reusable prompt the user can paste into a fresh conversation. Same content as this SKILL.md, formatted as a copy-paste template.
- [`README.md`](./README.md) — design notes, origins (Apurba Dev health magazine + Veew GTM/onboarding briefs · May 2026), customisation tips.
