# School-edition journeys

Specs here run ONLY against a server booted with `VIDYA_EDITION=school`:

```
VIDYA_EDITION=school pnpm test:e2e
```

Empty until #14 (school assessments, report cards, terms) lands.

## Known gap — read before running the school suite

The 76 journeys one level up in `tests/e2e/` are in the SHARED position, so a
school run picks them up too. They have **never been run against a school
server**, and some of them exercise the department level that the school
edition does not have (it keeps exactly one implicit department, which the
school UI never renders — see `IMPLICIT_DEPARTMENT_CODE`). So "shared" is
currently an assumption, not a verified fact.

They are left shared deliberately: moving them would change the college
regression net, and keeping it byte-identical is what lets #14 and #15 prove
"zero behavioural change" for college. Triaging which of the 76 are genuinely
edition-independent — and moving the rest into `../college/` — is work for #14,
when there is a school server to run them against.
