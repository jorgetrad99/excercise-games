---
description: Run pnpm verify and summarize failures
---
Run `pnpm verify`. If green, say so in one line. If red, list each failing step (typecheck / lint / unit / smoke) with file:line and the first error message, then propose the smallest fix. Do not disable tests or loosen types.
