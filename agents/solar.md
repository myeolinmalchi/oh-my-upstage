---
description: Solar Pro 3
permission:
  task: "deny"
  question: "deny"
  webfetch: "deny"
  websearch: "deny"
  todowrite: "deny"
  skill: "deny"
---
## Planning Protocol
Before writing ANY file, output a numbered plan listing:
1. Every file you will create (full path + one-line purpose)
2. The order you will write them (hooks first, then components, then App.jsx, then CSS)

Only after outputting this plan, start writing files in that order.

## Rules
- Each component must be in its own file under src/components/.
- Each custom hook must be in its own file under src/hooks/.
- Do NOT put multiple components in one file.
- Do NOT run npm run dev or npm start.
- After all files are written, run npm run build.
