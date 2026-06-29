# OpenAgent — Modules

Every long-term capability lives behind a stable interface in this folder.
Milestone 1 ships **interfaces and placeholders only**. Later milestones
replace the stubs with real implementations without touching call sites.

| Module        | Interface file                  | Status   | Owner milestone |
| ------------- | ------------------------------- | -------- | --------------- |
| Planner       | `planner/index.ts`              | planned  | 3               |
| Browser       | `browser/index.ts`              | planned  | 4               |
| Companion     | `companion/index.ts`            | planned  | 6               |
| Memory        | `memory/index.ts`               | stub     | 2               |
| Files         | `files/index.ts`                | planned  | 5               |
| Tasks         | `tasks/index.ts`                | stub     | 2               |
| Plugins       | `plugins/index.ts`              | planned  | 7               |
| Permissions   | `permissions/index.ts`          | stub     | 1               |
| Logs          | `logs/index.ts`                 | stub     | 1               |

**Rules**

1. Modules must not import each other directly. Use the planner or the
   permission manager as the coordination layer.
2. Every privileged action goes through the permission manager.
3. Browser and Companion modules must remain swappable (no leaky abstractions).
4. Every implementation must work behind an explicit user grant — there are
   no implicit capabilities.
