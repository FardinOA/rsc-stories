# Design Territories — RSC Stories workshop UI

Exploration record for the workshop UI (sidebar, canvas, panels, in-canvas cards). Kept after
selection so later reviews can check the shipped UI against the directions that lost.

## 0. Inputs recap

| Input                 | Source                 | Summary                                                                                                                                                                                         |
| --------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product problem       | SRS.md §1 (1.2)        | Existing workshops cannot show which parts of a tree ran on the server, which shipped as client JS, and what crossed the serialization boundary.                                                |
| Differentiator        | SRS.md §3 (3.5) and §9 | The RSC Boundary Inspector is "the differentiating feature"; "Boundary Inspector and async-RSC support are the product".                                                                        |
| Audience              | SRS.md §2 (2.2)        | Frontend engineers, design-system maintainers, reviewers/PMs browsing a deployed static build, QA authors.                                                                                      |
| Surfaces              | SRS.md §3 (3.4)        | Sidebar tree with search (FR-4.1), resizable canvas (FR-4.2), Controls, Mocks, Inspector, Console panels (FR-4.3–4.6), theme + background switcher and dark mode (FR-4.7), deep links (FR-4.8). |
| Constraints           | SRS.md §4              | WCAG 2.2 AA and full keyboard operation (FR-4.9, NFR-6.1); workshop JS ≤150 kB min+gzip (NFR-1.5); story switch ≤300 ms (NFR-1.2).                                                              |
| Data shapes on screen | SRS.md §3 (3.5)        | Server/Client/Shared node kinds (FR-5.1), serialized props with byte sizes (FR-5.2), payload and client JS sizes (FR-5.4), render-phase timings (FR-5.6), Flight rows (FR-5.9).                 |

Category default analysis was done first (component workshops and framework devtools): three-pane
sidebar/canvas/addon-panel layout; one brand accent (Storybook magenta, devtools blue) on every
interactive element; near-black dark theme; monospace and code blocks; pill status chips; dense
11px low-contrast grey labels. Each territory below was checked against that list.

---

## 1. Territory A — "Two Rooms"

### Name

Two Rooms

### 1. Design thesis

Thesis: the product wins on making the server/client split legible. Every surface encodes where
something ran — the story tree, the sidebar, console origins, timeline lanes, the boundary list —
with one consistent environment code (a hue plus a letter glyph). The UI chrome itself carries no
chroma, so colour on screen always means "this ran on the server" or "this ran in the browser".

### 2. Emotional goal

Serious, quiet, precise. An engineer should feel oriented: one glance tells them which room a node
lives in.

### 3. Brand relationship

No brand assets exist yet; the environment code becomes the brand. The mark is two adjoining
squares (server, client) with a seam between them.

### 4. Color philosophy

Neutral ink on neutral ground for all chrome; two environment hues (server, client) and a neutral
"shared" treatment are the only non-status chroma. Status colours (error, warning, success) sit in
hue ranges that do not collide with the environment pair. Light and dark are both first-class and
follow the OS.

### 5. Typography philosophy

System UI sans for chrome, system monospace with tabular figures for every value (props, bytes,
milliseconds, payload rows). No web font: the workshop is a local dev server installed as a
dependency.

### 6. Composition philosophy

Three panes, kept because people migrating from Storybook expect them; the inspector is the first
panel tab, and the boundary seam is drawn inside the tree rather than hidden in a sub-view.

### 7. Spatial philosophy

Medium density: 28px rows, 13px base text. Dense enough to hold seven panels, open enough to keep
AA text sizes.

### 8. Shape language

Square-ish: 4px radius on controls, 2px on tags, 1px hairline rules between regions.

### 9. Surface / material language

Flat. Regions separated by hairlines and a one-step tonal shift; shadows only on floating layers
(menus, tooltips).

### 10. Image / art direction

None. Interface-led; inline SVG glyphs only.

### 11. Motion philosophy

Functional and short: expand/collapse and panel changes under 150ms; timeline bars are static
data, not animation. Reduced-motion removes all of it.

### 12. Interaction philosophy

Precise and keyboard-first: arrow-key tree, roving focus in tablists, visible 2px focus outline.

### 13. Strengths

The differentiating feature shapes the whole UI instead of one tab. The encoding is reusable by
addons and in exported reports.

### 14. Risks

Colour coding fails WCAG 1.4.1 if hue is the only channel, so every environment mark needs a glyph
and a text label. Two hues must stay distinguishable for common colour-vision deficiencies.

### 15. Why it fits the product

SRS §1.2 names exactly this gap, and §3.5 lists Server/Client/Shared marking, boundary bytes and
server-vs-client timing as must-haves. Engineers and QA (§2.2) need to scan many nodes quickly.

### 16. Why it does NOT fit the product

A reviewer/PM browsing a static build mostly wants to look at UI states; environment colour is
noise to them. Reserving chroma also makes the chrome feel austere next to colourful components.

---

## 2. Territory B — "Instrument"

### Name

Instrument

### 1. Design thesis

Thesis: the product wins on measurement — payload kilobytes, client JS per component, render
phases, budgets that fail CI. The UI is a bench instrument: dark field, numeric readouts first,
every panel led by a figure and a budget gauge, with the timeline as the centrepiece.

### 2. Emotional goal

Alert and exacting. The feeling of reading a meter.

### 3. Brand relationship

Replaces any brand with instrument conventions: readouts, gauges, scales.

### 4. Color philosophy

Dark-first monochrome with signal colours only: green within budget, amber near, red over.

### 5. Typography philosophy

Monospace-dominant, large tabular numerals for headline figures, small caps labels.

### 6. Composition philosophy

Inspector-first: the canvas shrinks to a preview pane, the right half of the screen is metrics.

### 7. Spatial philosophy

Very dense: 22px rows, 12px text, many simultaneous readouts.

### 8. Shape language

Sharp: 0–2px radius, rules and tick marks.

### 9. Surface / material language

Dark matte panels with inset readout wells.

### 10. Image / art direction

None; charts and gauges carry the visuals.

### 11. Motion philosophy

Values tick to new readings; gauges sweep.

### 12. Interaction philosophy

Precise; hover crosshairs on the timeline, scrubbing.

### 13. Strengths

Makes budgets (FR-7.4) and sizes (FR-5.4) impossible to miss.

### 14. Risks

Dark-first dense UI at 12px is the hardest place to hold AA contrast; reviewers find it hostile;
the instrument look is a common devtools trope.

### 15. Why it fits the product

FR-5.4, FR-5.6, FR-5.8 and FR-7.4 are all numbers, and CI budgets are a launch criterion (§6).

### 16. Why it does NOT fit the product

Most time in the workshop is spent developing and reviewing components (FR-4.2, FR-4.3), not
reading metrics; demoting the canvas fights the primary task. Several numbers are estimates
(§9: client JS attribution is imprecise), and gauge styling would overstate their precision.

---

## 3. Territory C — "Specimen Sheet"

### Name

Specimen Sheet

### 1. Design thesis

Thesis: the product wins on review — stories as exhibits for people who never run the app. The
canvas dominates on a warm paper field; story titles are set like catalogue entries with captions
(args, mocks) underneath; engineering panels fold away into a drawer.

### 2. Emotional goal

Calm and approachable; a printed specimen book.

### 3. Brand relationship

Extends toward documentation and design-system catalogues.

### 4. Color philosophy

Warm monochrome ink on paper; a single red marker colour for annotations.

### 5. Typography philosophy

Serif display for story titles, sans for captions, generous measure.

### 6. Composition philosophy

Canvas-first, asymmetric: wide margins, captions beside the exhibit, panels in a collapsed drawer.

### 7. Spatial philosophy

Spacious: large margins, 15px base text, one panel at a time.

### 8. Shape language

Soft: 8px radii, rounded tabs.

### 9. Surface / material language

Paper texture tone, slight shadow under the exhibit frame.

### 10. Image / art direction

None beyond the components themselves.

### 11. Motion philosophy

Slow crossfade between stories.

### 12. Interaction philosophy

Reserved, pointer-friendly, large targets.

### 13. Strengths

Best for the reviewer/PM persona and the static build (FR-6.3).

### 14. Risks

Beige-serif-whitespace is the documentation-site median; the drawer hides the inspector, which
is the product.

### 15. Why it fits the product

§2.2 lists reviewers/PMs, and FR-6.3 ships a static workshop for them.

### 16. Why it does NOT fit the product

Seven panels (FR-4.3–4.6, §3.5) do not fit a one-panel-at-a-time drawer; crossfades cost time
against the 300 ms story-switch target (NFR-1.2); hiding the inspector contradicts §9.

---

## 4. Fake-Diversity Check (Decision Tree 6.1)

| Axis                                              | A — Two Rooms                 | B — Instrument             | C — Specimen Sheet  |
| ------------------------------------------------- | ----------------------------- | -------------------------- | ------------------- |
| Light vs. Dark                                    | follows OS, both first-class  | dark-first                 | light-first (paper) |
| Warm vs. Cool                                     | neutral                       | cool                       | warm                |
| Editorial vs. Technical                           | technical                     | technical                  | editorial           |
| Dense vs. Spacious                                | medium                        | very dense                 | spacious            |
| Geometric vs. Organic                             | geometric                     | geometric                  | soft/organic        |
| Photographic vs. Interface-led                    | interface-led                 | interface-led              | interface-led       |
| Human vs. Technological                           | technological                 | technological              | human               |
| Architectural vs. Expressive                      | architectural                 | architectural              | expressive          |
| Tactile vs. Digital                               | digital                       | digital (instrument wells) | tactile (paper)     |
| Monochrome vs. Chromatic                          | chromatic-coded (environment) | monochrome + signal        | monochrome + marker |
| Canvas-first vs. Inspector-first _(product axis)_ | balanced                      | inspector-first            | canvas-first        |

**Pairs checked, axes differing:** A ↔ B: 4 (lightness, temperature, monochrome/chromatic,
product axis). A ↔ C: 9. B ↔ C: 10.

**Theses:** A argues legibility of the server/client split; B argues measurement; C argues
review. No two share a thesis.

**Lightness strategy:** one OS-following, one dark-first, one light-first — the set does not
converge on a single lightness strategy.

## 5. Structural Default Audit

| Element                              | Present in which territory           | Stated product-specific reason |
| ------------------------------------ | ------------------------------------ | ------------------------------ |
| Floating dashboard/product mockup    | none                                 | —                              |
| Giant centered hero                  | none                                 | —                              |
| Pill-shaped badges                   | none (A uses 2px-radius letter tags) | —                              |
| Fade-up-on-scroll as the only motion | none                                 | —                              |
| Generic 3-card feature grid          | none                                 | —                              |
| Testimonial carousel + logo strip    | none                                 | —                              |

## 5.1 Expressive/Material Execution Audit

| Technique               | Present in which territory | Defined role                          | Coherent with palette/system?                           |
| ----------------------- | -------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Dark background         | B (default); A (dark mode) | B: instrument field; A: OS preference | Yes in both; A maps every token, not a separate palette |
| Gradient accent         | none                       | —                                     | —                                                       |
| Glassmorphism           | none                       | —                                     | —                                                       |
| Glow                    | none                       | —                                     | —                                                       |
| Heavily rounded corners | C (8px)                    | softness for reviewers                | Coherent within C                                       |
| Oversized display type  | B (readout figures)        | headline numbers                      | Coherent within B                                       |

## 6. Selection Scoring (Decision Tree 6.3)

Scale 1–5.

| Criterion                                                          | A — Two Rooms | B — Instrument | C — Specimen Sheet |
| ------------------------------------------------------------------ | ------------- | -------------- | ------------------ |
| Fits audience's actual context                                     | 4             | 3              | 3                  |
| Communicates positioning vs. Storybook                             | 5             | 4              | 2                  |
| Resolves the primary anxiety ("what ran where, and what crossed?") | 5             | 3              | 2                  |
| Usability — serves hierarchy                                       | 4             | 3              | 3                  |
| Narrative capacity                                                 | 4             | 3              | 3                  |
| Distinctiveness (Swapped-Product Test)                             | 5             | 2              | 2                  |
| Execution risk (AA, 150 kB)                                        | 4             | 2              | 4                  |
| **Total**                                                          | **31**        | **20**         | **19**             |

**Weighting statement:** positioning weighted highest, because SRS §9 says the Boundary Inspector
and async-RSC support "are the product". A is the only territory where that feature shapes every
surface; B treats it as numbers, C hides it.

**Anti-Bias Check:** the winner is not dark-first. B was not marked down for being dark; it lost on
execution risk (AA at 12px on a dark dense field), on demoting the canvas, and on presenting
estimated client-JS figures as gauge readings. C was not marked down for being light; it lost on
hiding the inspector. No bias found in either direction.
