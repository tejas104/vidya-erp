# ADR-0019: Frontend architecture — "The Register" dashboards

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

#5 is the platform's first heavy UI. The Constitution locks Next.js; the
assignment adds a distinctive, accessible, permission-reflective bar. The
UI must never expose a privileged path or leak data the API wouldn't.

## Decisions

- **The UI is a pure API consumer.** Pages are client components that
  `fetch` same-origin `/api/v1/...` with the HttpOnly, SameSite=Strict
  session cookie riding along automatically. The browser holds no token,
  no service key, and no composition-root access. Permission-reflection is
  automatic: the dashboard API returns only in-scope tiles (ADR-0018), so
  a teacher's screen simply has no department tile to hide.
- **No component or chart library.** Design tokens are hand-authored CSS
  custom properties; charts are hand-rolled SVG per the dataviz method
  (thin marks, one axis, direct labels, a legend only for ≥2 series,
  recessive grid). This keeps the bundle CDN-free and every mark
  intentional.
- **Self-hosted fonts via `next/font`.** Bricolage Grotesque (display),
  Atkinson Hyperlegible (body — literally designed for low-vision reading),
  IBM Plex Mono (every figure) are fetched at BUILD time and served from
  the app's own origin — zero runtime CDN, which on-prem requires.
- **Two designed modes, not an inversion.** Light is ruled ledger paper;
  dark is the blackboard (deep slate-green, chalk ivory), built as its own
  mode from the same ramps. A pre-paint inline script applies the saved
  theme so there is no flash.
- **The signature is the register strip** — per-section rows of day-cells
  inked by attendance density, a data-bearing miniature of the paper
  register. Boldness is spent there; everything else stays quiet.
- **Designed empty/withheld states.** insufficient-cohort, no-data,
  out-of-scope and "nothing assigned" are real UI states with directive
  copy, not blank space or spinners left hanging.

## Accessibility floor (built, not announced)

Responsive to mobile; visible keyboard focus (`:focus-visible` outline);
`prefers-reduced-motion` respected (the only motion is a single strip
reveal); WCAG AA contrast (the categorical subject palette was validated
with the dataviz script in both modes, and ships with direct labels so
identity is never colour-alone); a skip link; status conveyed with an icon
+ label, never colour alone (the at-risk red underline always accompanies a
reason chip).

## Palette validation

The six categorical subject hues were run through
`dataviz/scripts/validate_palette.js` in light and dark. Dark passes all
checks; light passes with two adjacent hues in the 8–12 CVD band and just
under the 3:1 relief threshold — legal because every bar is direct-labelled
with its subject name (the required secondary encoding). See
docs/frontend-design.md.

## Consequences

- Build needs network for `next/font` (CI has it); a fully offline build
  would switch to `next/font/local` with committed font files (recorded
  debt, not needed today).
- The three surfaces (login, dashboard, student) cover the assignment's
  roles; deeper drill-downs and an admin recompute button are API-complete
  and can be added as pages without backend change.
