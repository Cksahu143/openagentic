# OpenAgent — Module Contracts

Each module lives at `src/modules/<id>/index.ts` and exports an interface plus
a default implementation (stub today). Components and server functions import
from `@/modules/<id>` only — never reach inside.

| id            | Interface           | Status   | First real milestone |
| ------------- | ------------------- | -------- | -------------------- |
| `planner`     | `Planner`           | planned  | 3                    |
| `browser`     | `BrowserController` | planned  | 4                    |
| `companion`   | `CompanionBridge`   | planned  | 6                    |
| `memory`      | `MemoryStore`       | stub     | 2                    |
| `files`       | `FileManager`       | planned  | 5                    |
| `tasks`       | `TaskManager`       | stub     | 2                    |
| `plugins`     | `PluginRuntime`     | planned  | 7                    |
| `permissions` | `PermissionManager` | stub     | 1                    |
| `logs`        | `Logger`            | stub     | 1                    |

## Adding a module

1. Add the entry to `src/lib/modules.ts` (`MODULE_REGISTRY`).
2. Create `src/modules/<id>/index.ts` with the interface and a stub
   implementation that throws or returns empty data.
3. Declare required scopes — they show up automatically on the Permissions page.
4. Document the contract in this file.
