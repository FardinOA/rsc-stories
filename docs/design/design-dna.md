# Design DNA — RSC Stories workshop UI

Binding visual contract for the workshop UI (`src/ui`), the in-canvas error and navigation cards
(`src/runtime/client`), and the static build. Selected territory: **Two Rooms**
(`design-territories.md`, memo in `design-direction.md`). Changes go through the Amendment Log.

## Evidence Binding

| Decision                                                                                         | Evidence                                                                                                                                                        | Source    | Mechanism                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Chroma is reserved for runtime meaning (environment + status); chrome is neutral ink             | Inspector must mark nodes Server/Client/Shared (FR-5.1); console logs labelled by origin (FR-4.6); timeline splits server phases from client hydration (FR-5.6) | SRS.md §3 | The same environment code repeats on four surfaces; a brand accent on buttons and selection would compete with it and dilute what a hue means |
| Two environment hues (server violet ≈ OKLCH h300, client teal ≈ h190) plus a neutral Shared mark | Three node kinds must be distinguishable (FR-5.1); errors, warnings and budget failures also need colour (FR-5.3, FR-3.6, FR-6.4)                               | SRS.md §3 | Hue space is partitioned so environment hues never collide with status hues (error h25, warning h75, success h145)                            |
| Every environment mark pairs hue with a letter glyph (S / C / ⇄) and a text label                | Workshop must meet WCAG 2.2 AA (FR-4.9, NFR-6.1)                                                                                                                | SRS.md §4 | WCAG 1.4.1 forbids colour as the only channel; glyph + label survive colour-vision deficiency and greyscale                                   |
| Lightness strategy: follow the OS, light and dark both first-class, every token mapped in both   | Theme switcher and dark mode for the workshop itself are required (FR-4.7)                                                                                      | SRS.md §3 | Neither mode is a derived afterthought, so contrast is verified in both                                                                       |
| Canvas background is independent of chrome theme                                                 | Background switcher is a separate requirement from workshop dark mode (FR-4.7)                                                                                  | SRS.md §3 | A dark workshop must still show a component on a white canvas, and vice versa                                                                 |
| System UI sans for chrome, system monospace with tabular figures for values; no web fonts        | The tool is a dev dependency running a local dev server (§2.1); bytes, timings and Flight rows are core data (FR-5.2, FR-5.4, FR-5.6, FR-5.9)                   | SRS.md §2 | No font download or network dependency for a localhost tool; tabular figures keep byte/ms columns aligned for comparison                      |
| Three-pane layout: sidebar, canvas, bottom panel with tabs                                       | Required surfaces are a story tree (FR-4.1), a canvas (FR-4.2) and several panels (FR-4.3–4.6); migrating Storybook users is an explicit goal (FR-8.3, NFR-8.1) | SRS.md §3 | Familiar placement lowers migration cost; the differentiation lives in what the panels show, not in rearranging them                          |
| Inspector is the first panel tab and the boundary is drawn as a seam in the tree                 | The Boundary Inspector is the differentiating feature and "the product"                                                                                         | SRS.md §9 | The feature is visible on first use instead of behind a tab users must discover                                                               |
| Medium density: 28px rows, 13px base text, nothing below 12px                                    | Seven panel types must fit (FR-4.3–4.6, §3.5) and text must meet AA (NFR-6.1)                                                                                   | SRS.md §4 | Holds the panel set on a laptop while keeping text at sizes where AA contrast and legibility hold                                             |
| No imagery; inline SVG glyphs only                                                               | Workshop UI JS budget ≤150 kB (NFR-1.5); content is the user's own components                                                                                   | SRS.md §4 | Images would compete with the canvas, which is where the user's visuals are                                                                   |
| Motion limited to state changes under 150 ms; none under reduced motion                          | Story switch ≤300 ms to first paint (NFR-1.2); hot reload ≤1 s (NFR-1.3)                                                                                        | SRS.md §4 | UI motion must never add to the latency budget a developer feels on every story switch                                                        |
| Keyboard-first interaction: arrow-key tree, roving tablists, visible 2px focus outline           | Sidebar keyboard navigation (FR-4.1); fully keyboard-operable workshop (FR-4.9)                                                                                 | SRS.md §3 | Every control is reachable and its focus visible without a pointer                                                                            |
| Static build hides editing affordances and says so                                               | Reviewers/PMs browse a deployed static workshop without running the app (§2.2, FR-6.3)                                                                          | SRS.md §2 | Controls that cannot re-render on a static host would mislead; a notice replaces them                                                         |

## Category Default Analysis

**Category:** component workshops and framework devtools (Storybook, Ladle, Histoire, React
DevTools, the Next.js dev overlay).

| Common strategy in this category                              | Used here?                             | If used, evidence row                                      |
| ------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Three-pane sidebar / canvas / addon panel                     | Yes                                    | "Three-pane layout" row                                    |
| One brand accent on every interactive element (magenta, blue) | No — interactive chrome is neutral ink | "Chroma is reserved for runtime meaning" row               |
| Near-black dark theme as the default                          | No — follows the OS, both first-class  | "Lightness strategy" row                                   |
| Monospace and code blocks                                     | Yes, for values only                   | "System UI sans … monospace" row                           |
| Pill status chips                                             | No — 2px-radius letter tags            | "Every environment mark pairs hue with a letter glyph" row |
| 11px low-contrast grey labels                                 | No — 12px minimum, AA contrast         | "Medium density" row                                       |

## Design Thesis

Colour tells you where code ran. The server colour, the client colour and the shared mark appear
wherever a node, log line, timing bar or boundary is shown, always with a letter glyph and a text
label. All other UI is neutral ink on a neutral field, so the encoding is never diluted by
decoration.

## Desired Perception

Orientation and trust in the data: an engineer should be able to answer "did this run on the
server, and what crossed into the client?" from a single glance at the tree, because that is the
question the product exists to answer (SRS §1.2).

## Audience

Frontend engineers and design-system maintainers developing components, QA authors reading
render reports, and reviewers/PMs browsing a static build (SRS §2.2).

## Emotional Register

Serious over playful; quiet over loud; precise over expressive; neutral temperature — warmth or
coolness is carried only by the two environment hues.

## Visual Territory

Two Rooms — a neutral, flat workshop in which two environment hues encode the server/client split.
Full record and the alternatives that lost: `design-territories.md`.

## Color Philosophy

- **Dominant field:** neutral grey ramp, very slightly cool, in both light and dark modes.
- **Tonal range:** three surface steps (app background, panel, raised layer) plus hairline
  borders; text at two strengths (primary, secondary), both AA against every surface.
- **Temperature:** neutral; the environment hues carry the only temperature.
- **Chromatic structure:** environment pair (server violet, client teal) and status set (error
  red, warning amber, success green) at matched lightness so neither family shouts over the other.
- **Accent strategy:** there is no brand accent. Primary actions, selection and focus use the ink
  colour (inverted in dark mode).
- **Focal colour:** none on chrome; the canvas is the focal region.
- **Atmospheric effects:** none — no gradients, glows or blur, because no surface in this
  territory has an atmospheric role.

## Typography Philosophy

System UI sans for labels and prose; system monospace for prop names, values, sizes, timings and
payload rows, always with tabular figures so columns compare. Hierarchy comes from weight (400/600)
and colour strength, not from many sizes: 12, 13 and 15 px only. Breaking this — a display face, a
fourth size — would signal emphasis the data does not have.

## Composition Philosophy

Fixed three-pane frame: a resizable sidebar on the left, the canvas in the centre as the largest
region, a resizable bottom panel with tabs. The canvas toolbar sits directly above the frame it
controls. Panels use full-width tables and trees, aligned to a 4px grid.

## Spatial Philosophy

Medium density with 28px rows; whitespace separates regions, hairlines separate rows. Empty
panels explain what would appear and how to get it, so blank space is never unexplained.

## Shape Language

Square-ish and consistent: 4px radius on inputs and buttons, 2px on tags, 0 on panels and the
canvas frame. No variation beyond these three values.

## Surface / Material Language

Flat. Regions are separated by 1px hairlines and one tonal step; shadow appears only on floating
layers (menus, tooltips, popovers) to show they are above the page.

## Image Direction

No photography or illustration. Glyphs are 16px inline SVG strokes in the current text colour;
environment glyphs are letters in tags.

## Interaction Philosophy

Precise and keyboard-first. Every interactive element has a 2px focus outline with offset in the
ink colour; targets are at least 24×24px (WCAG 2.5.8). Hover adds a tonal step, never motion.
Shortcuts are opt-out and never fire while typing.

## Motion Philosophy

Motion only confirms a state change (panel switch, tree expand, toast) and finishes within 150 ms
with a standard ease-out. No looping or ambient motion. `prefers-reduced-motion` removes all of it.

## Signature Moments

1. **The seam.** In the inspector tree, the point where a server component renders a client
   component is drawn as a seam row carrying the serialized props size — the boundary from SRS
   §3.5 made into a visible object.
2. **Environment lanes.** The timeline splits into a server lane and a client lane coloured with
   the same environment code as the tree, so phase timings read as "where", not only "how long".
3. **Origin-labelled console.** Server and client log lines carry the same S/C tags, so a log
   line can be matched to the tree without reading its text.

## Anti-Patterns

- A brand accent colour on buttons, tabs or selection (it would compete with the environment code).
- Hue as the only signal for environment or status.
- Atmospheric effects (gradients, glows, blur) — no surface here has a role for them.
- Pill-shaped chips, large rounded cards, or a dashboard of gauges (Instrument's direction).
- Hiding the inspector in a drawer (Specimen Sheet's direction).
- Text below 12px or secondary text below AA contrast.

## Responsive Philosophy

Below 900px the sidebar becomes an overlay toggled from the toolbar and the panel stacks under the
canvas; below 600px the toolbar wraps. The environment code, type sizes and shape values never
change across widths.

---

## Amendment Log

| Date       | What changed    | Why                 | Approved by |
| ---------- | --------------- | ------------------- | ----------- |
| 2026-10-26 | Initial version | Territory selection | —           |
