# College-edition journeys

Specs here run ONLY against a server booted with `VIDYA_EDITION=college`
(the default):

```
pnpm test:e2e
```

Empty on purpose: the existing 76 journeys live one level up in `tests/e2e/`
and are SHARED, which keeps the college regression net byte-identical while
the school suite grows. Move a spec down here only when it becomes genuinely
college-specific.
