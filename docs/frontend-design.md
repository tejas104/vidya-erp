# Frontend design notes — "The Register"

The dashboards are anchored in one place: the staff room of an Indian
college — the attendance register and the blackboard — used by teachers,
HoDs and principals on shared desktops and phones. The page's single job is
*"is my class okay today, and who needs help?"*

## Design tokens

Two modes, each designed (not an inversion), from the same ramps. Full
values in `apps/web/app/globals.css`.

| Role | Light — ruled ledger paper | Dark — the blackboard |
|---|---|---|
| surface | `#faf9f4` paper / `#fffefb` raised | `#18211d` slate-green / `#1f2a25` raised |
| rules | `#e6e1d3` | `#2c3a33` |
| ink | `#1a2233` navy | `#ece8da` chalk ivory |
| accent (at-risk, reserved) | `#b23a2e` examiner's red | `#e8837a` chalk red |
| present / healthy | `#1e7a4e` | `#6fcf97` |
| strip density (sequential, 1 hue) | `#edeade → #1e7a4e` | `#23302a → #6fcf97` |

**Type.** Display **Bricolage Grotesque** (used with restraint on titles,
wordmark, tile names); body **Atkinson Hyperlegible** (chosen because it is
designed for low-vision readers — the accessibility floor made visible);
data/figures **IBM Plex Mono** with tabular numerals. All self-hosted via
`next/font` (zero runtime CDN).

**Structure encodes truth.** Ledger rules divide every list the way a paper
register rules its rows; the mono eyebrow carries the caller's roles; no
decorative numbering (the content isn't a sequence).

## The signature — the register strip

Each class/section tile carries a row of day-cells inked by that day's
attendance density (a validated sequential green ramp, 5 buckets). It is a
real, data-bearing miniature of the paper register — the one bold element;
everything around it stays quiet. Cohort-gated per cell (a small session is
omitted, never shown as a raw number). Capped to the most recent 12
sessions so it never overflows a tile.

## Charts (dataviz method)

Hand-rolled SVG, no library. Sparklines for trends (single series → no
legend, the title names it; 2px line, rounded end-dot, faint area). Thin
categorical bars for subject averages, **each direct-labelled with its
subject name** — the secondary encoding that lets the validated palette
ship. Stat tiles for headline figures (big mono number + label + sub). One
axis everywhere; recessive grid; text always wears ink tokens, never a
series colour.

### Palette validation (run, not eyeballed)

Six categorical subject hues in fixed order
(`#2a78d6,#1baf7a,#4a3aa7,#eb6834,#008300,#e87ba4` light; the ramp's dark
steps in dark) were run through `dataviz/scripts/validate_palette.js`:

- **Dark:** all checks PASS (worst adjacent ΔE 17.9, contrast ≥ 3:1).
- **Light:** PASS with two adjacent hues in the 8–12 CVD floor band and
  just under the 3:1 relief threshold — **legal because every bar is
  direct-labelled** (required secondary encoding). Attendance/marks
  sparklines are single-series (`--line`), so no categorical collision.

Status (at-risk) uses a reserved red distinct from the categorical set,
always paired with an icon-dot + reason chip — never colour alone.

## Permission-reflective UI

Tiles come from the grants-derived `/analytics/dashboard` endpoint, so a
user never sees a control or tile for data outside their scope — there is
nothing to hide client-side. Withheld aggregates render as designed states
("cohort too small to summarise (under 5)", "outside your scope", "no data
yet"), so the minimum-cohort and closure rules are visible, honest UI —
not blank space.

## Accessibility floor (built, unannounced)

Responsive to mobile (grid reflows, strip caps); visible keyboard focus
(`:focus-visible` ring); `prefers-reduced-motion` respected (only motion: a
single staggered strip reveal); WCAG AA contrast in both modes; a skip
link; `role="img"` + `aria-label` summaries on every SVG so trends are
readable by assistive tech; `aria-live` on the login error.

## Copy

Plain, active, from the user's side of the screen. Errors explain and
direct ("That username and password don't match." / "Your password needs
to be reset before you can sign in. Ask your administrator."). Empty states
invite action ("No sessions recorded yet — the register fills in after the
first entry."). The at-risk section is "Needs attention", not "At-risk
cohort".

## Verified

Screenshotted during authoring (login light; dashboard + at-risk list in
light and dark) — fonts load, both modes read as intended, the strip and
the withheld-cohort state render correctly. The student page reuses the
same, verified primitives.
