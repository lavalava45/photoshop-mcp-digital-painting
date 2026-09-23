# Retired Core/controller workflow

Last updated: 2026-09-21

This file is intentionally no longer a runnable workflow. The old
`Chat_On_Steroids_Core → photoshop-session.mjs → persistent daemon → dist/index.js`
route may still exist in the current source tree while its remaining tests and utilities
are migrated, but it is not a supported production or agent path.

Use the canonical route:

```text
Chat_On_Steroids_Plugins
  → dist/cos-plugin.js
  → embedded Guard
  → internal ToolRegistry
  → UXP-first Photoshop backend
```

For normal visual work use `photoshop_guard_cycle_auto` with compact `next_pass`.
Continue with `previous_operation_id + previous_observation + next_pass`; finalize with
`previous_operation_id + previous_observation` and no dummy mutation. Do not recreate
the former full `next_operation`, explicit report/ack/verdict, controller-daemon, or
legacy replay workflow from older examples.

Removal is governed by [PAINTING-ROADMAP.md](PAINTING-ROADMAP.md), tasks 13a–13c:

1. define the compact-only public contract;
2. audit every real dependency and state transition;
3. migrate required test/recovery consumers;
4. delete obsolete providers, aliases, handshake paths, and documentation;
5. prove that legacy paths fail closed and cannot reactivate.

Current implementation order and acceptance are tracked in
[PAINTING-ROADMAP.md](PAINTING-ROADMAP.md). Current UXP transport coverage is tracked
in [uxp-migration-inventory.md](uxp-migration-inventory.md).
