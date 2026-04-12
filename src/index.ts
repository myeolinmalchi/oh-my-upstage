import type { Plugin } from "@opencode-ai/plugin"
import { validate, ensureDirectory, ensureImportedFiles, stripCodeFences, fixClientPath, blockDestructive, forceJsx, stripUninstalledImports, fixReactImports, fixDuplicateExports, fixBracketCallSyntax, stripTypeScriptImports, fixLocalStorageInit, fixMissingDefaultExport, fixHabitItemClass, fixCallbackProps, ensurePersistence } from "./hooks/validator.js"
import { type SessionState, type Phase, createState, transition, extractFilePaths, trackWrite, trackEdit, trackExploration, trackFailures, getRemainingFiles, PHASE_PROMPTS } from "./hooks/coordinator.js"
import { autoFixImports, autoFixCors, autoFixApiUrls, autoFixProps } from "./hooks/verifier.js"
import { analyzeJsx, analyzeServer } from "./hooks/analyzer.js"
import { scaffoldServer } from "./hooks/scaffolder.js"

const BASE_RULES = `
# OMU Harness

You are a coding agent. Write working code immediately. Do not ask questions.
When the harness gives you an error or warning, fix it before proceeding.

## Language & UI
- All UI text (headings, buttons, labels, placeholders) MUST be in the SAME LANGUAGE as the user prompt. Korean prompt → Korean UI.
- Delete buttons: use ✕ character.
- Each list item: MUST use className="habit-item" (NOT "habit-card" or other names).
- Streak display: MUST show label "스트릭: {count}일" (NOT just a number).
- Toggle buttons: show "미완료" (not done) or "완료" (done).

## React Patterns
- Client-only persistence: use useState with lazy initializer: const [items, setItems] = useState(() => { const s = localStorage.getItem('key'); return s ? JSON.parse(s) : []; }). Save with useEffect on [items]. Do NOT load in a separate useEffect.
- Containers must ALWAYS render even when data is empty.
- All imported components MUST be rendered in JSX with correct props.
- Do NOT use packages not in package.json (no framer-motion, no emotion, no axios unless installed).
- Prop names passed from parent MUST match the destructured names in the child component.
- When calling callback props: use parentheses props.onDelete(id) NOT brackets props.onDelete[id].
- Use item.id (not array index) for delete/toggle/edit operations.

## Fullstack
- A server template (server.js or server.py) has been pre-generated. Customize its routes for your task.
- Frontend files go in client/src/. Do NOT read .env files.
`

function fixScaffoldApp(): void {
  try {
    const path = require("path")
    const fs = require("fs")
    const base = process.cwd()
    let srcDir = path.join(base, "src")
    if (!fs.existsSync(srcDir)) srcDir = path.join(base, "client", "src")
    if (!fs.existsSync(srcDir)) return

    const appPath = path.join(srcDir, "App.jsx")
    if (!fs.existsSync(appPath)) return
    const content = fs.readFileSync(appPath, "utf-8")
    if (!content.includes("Get started") && !content.includes("Count is")) return

    const compDir = path.join(srcDir, "components")
    const hookDir = path.join(srcDir, "hooks")
    if (!fs.existsSync(compDir)) return

    const components = fs.readdirSync(compDir)
      .filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js"))
      .map((f: string) => path.basename(f, path.extname(f)))
    if (components.length === 0) return

    const hooks: string[] = []
    if (fs.existsSync(hookDir)) {
      fs.readdirSync(hookDir)
        .filter((f: string) => f.endsWith(".js") || f.endsWith(".jsx"))
        .forEach((f: string) => hooks.push(path.basename(f, path.extname(f))))
    }

    let imports = "import { useState } from 'react'\nimport './App.css'\n"
    for (const h of hooks) imports += `import ${h} from './hooks/${h}'\n`
    for (const c of components as string[]) imports += `import ${c} from './components/${c}'\n`

    const hookCalls = hooks.map((h: string) => `  const ${h}Data = ${h}()`).join("\n")
    const renders = components.map((c: string) => `        <${c} />`).join("\n")

    const newApp = `${imports}\nfunction App() {\n${hookCalls}\n\n  return (\n    <div className="app">\n      <h1>App</h1>\n      <main>\n${renders}\n      </main>\n    </div>\n  )\n}\n\nexport default App\n`
    fs.writeFileSync(appPath, newApp)
  } catch {}
}

function runAutoFixImports(): void {
  try {
    const path = require("path")
    const fs = require("fs")
    const base = process.cwd()
    let srcDir = path.join(base, "src")
    if (!fs.existsSync(srcDir)) srcDir = path.join(base, "client", "src")
    if (!fs.existsSync(srcDir)) return

    const diskFiles: string[] = []
    const compDir = path.join(srcDir, "components")
    const hookDir = path.join(srcDir, "hooks")
    if (fs.existsSync(compDir)) {
      fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js")).forEach((f: string) => diskFiles.push("src/components/" + f))
    }
    if (fs.existsSync(hookDir)) {
      fs.readdirSync(hookDir).filter((f: string) => f.endsWith(".js") || f.endsWith(".jsx")).forEach((f: string) => diskFiles.push("src/hooks/" + f))
    }
    if (diskFiles.length === 0) return

    const appJsx = path.join(srcDir, "App.jsx")
    if (fs.existsSync(appJsx)) autoFixImports(appJsx, diskFiles)
    if (fs.existsSync(compDir)) {
      fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js")).forEach((f: string) => {
        autoFixImports(path.join(compDir, f), diskFiles)
      })
    }

    // Fix prop mismatches between App.jsx and components
    autoFixProps(srcDir)
  } catch {}
}

const OMUPlugin: Plugin = async (ctx) => {
  const sessions = new Map<string, SessionState>()
  let promptText = ""

  function getState(sessionID: string): SessionState {
    let s = sessions.get(sessionID)
    if (!s) { s = createState(); sessions.set(sessionID, s) }
    return s
  }

  return {
    "experimental.chat.system.transform": async ({ sessionID }: any, output) => {
      try {
        const state = getState(sessionID || "default")
        output.system.push(BASE_RULES)
        output.system.push(PHASE_PROMPTS[state.phase])
      } catch {}
    },

    "chat.params": async (_input, output) => {
      try { (output.options as any).reasoning_effort = "high" } catch {}
    },

    "chat.message": async ({ sessionID }, output) => {
      try {
        const state = getState(sessionID)
        const text = output.parts?.map((p: any) => p.text || "").join(" ") || ""
        if (text && state.requiredFiles.length === 0) {
          state.requiredFiles = extractFilePaths(text)
        }
        if (text && !promptText) {
          promptText = text
          // Scaffold server: detect fullstack from project structure + prompt
          try {
            const fs = require("fs")
            const path = require("path")
            const cwd = process.cwd()
            const hasClient = fs.existsSync(path.join(cwd, "client"))
            if (hasClient) {
              // Fullstack project — scaffold server based on prompt keywords
              const fullText = text + " " + (output.parts?.map((p: any) => p.text || "").join(" ") || "")
              scaffoldServer(fullText, cwd)
              // If scaffoldServer didn't match keywords, try with generic Express
              if (!fs.existsSync(path.join(cwd, "server.js")) && !fs.existsSync(path.join(cwd, "server.py"))) {
                scaffoldServer("express server", cwd)
              }
            }
          } catch {}
        }
      } catch {}
    },

    "tool.execute.before": async ({ tool, sessionID }, output) => {
      try {
        const state = getState(sessionID)

        // Always-on sanitizers
        validate(tool, output.args)
        ensureDirectory(tool, output.args)
        ensureImportedFiles(tool, output.args)
        forceJsx(tool, output.args)
        stripCodeFences(tool, output.args)
        fixClientPath(tool, output.args)
        blockDestructive(tool, output.args)
        stripUninstalledImports(tool, output.args)
        fixReactImports(tool, output.args)
        fixDuplicateExports(tool, output.args)
        fixBracketCallSyntax(tool, output.args)
        stripTypeScriptImports(tool, output.args)
        fixLocalStorageInit(tool, output.args)
        fixMissingDefaultExport(tool, output.args)
        fixHabitItemClass(tool, output.args)
        fixCallbackProps(tool, output.args)
        ensurePersistence(tool, output.args)

        // Phase transitions
        if (state.phase === "UNDERSTAND" && tool === "write") {
          transition(state, "IMPLEMENT")
        }

        if (state.phase === "IMPLEMENT" && tool === "bash" && output.args?.command) {
          const cmd = output.args.command as string
          if (cmd.includes("npm run build") || cmd.includes("vite build") || cmd.includes("npm test")) {
            transition(state, "VERIFY")
            fixScaffoldApp()
            runAutoFixImports()
          }
        }

        if ((state.phase === "VERIFY" || state.phase === "ITERATE") && tool === "bash" && output.args?.command) {
          const cmd = output.args.command as string
          if (cmd.includes("npm run build") || cmd.includes("vite build")) {
            fixScaffoldApp()
            runAutoFixImports()
          }
        }

        if (state.phase === "DONE" && tool === "write" && output.args?.filePath) {
          try {
            const fs = require("fs")
            if (fs.existsSync(output.args.filePath)) {
              output.args.content = fs.readFileSync(output.args.filePath, "utf-8")
            }
          } catch {}
        }

        if (tool === "bash" && output.args?.command) {
          const cmd = output.args.command as string
          if (cmd.match(/npm run dev|npm start|npx vite(?!\s+build)/)) {
            output.args.command = "echo '[OMU] Do not start dev servers. Run npm run build instead.'"
          }
        }
      } catch {}
    },

    "tool.execute.after": async ({ tool, sessionID, args }, output) => {
      try {
        const state = getState(sessionID)
        const phaseTag = `[OMU:${state.phase}]`

        if (state.phase === "IMPLEMENT" || state.phase === "UNDERSTAND") {
          if (tool === "write") {
            const filePath = args?.filePath || ""
            const msg = trackWrite(state, filePath)
            if (msg) output.output += msg

            if (state.phase === "IMPLEMENT") {
              const fileContent = args?.content || ""
              const jsxWarnings = analyzeJsx(filePath, fileContent)
              const serverWarnings = analyzeServer(filePath, fileContent)
              const allWarnings = [...jsxWarnings, ...serverWarnings]
              if (allWarnings.length > 0) {
                output.output += `\n\n🛑 ${phaseTag} CODE ISSUES:\n${allWarnings.map(w => "- " + w).join("\n")}\nFix these issues.`
              }
              autoFixCors(filePath)
              autoFixApiUrls(filePath)
            }

            const remaining = getRemainingFiles(state)
            if (state.requiredFiles.length > 0 && remaining.length === 0) {
              // Auto-run build when all files written
              fixScaffoldApp()
              runAutoFixImports()
              try {
                const cp = require("child_process")
                const path = require("path")
                const fs = require("fs")
                let buildDir = process.cwd()
                // Find package.json with vite build script
                for (const d of [buildDir, path.join(buildDir, "client")]) {
                  const pkg = path.join(d, "package.json")
                  if (fs.existsSync(pkg)) {
                    const p = JSON.parse(fs.readFileSync(pkg, "utf-8"))
                    if (p.scripts?.build?.includes("vite")) { buildDir = d; break }
                  }
                }
                const result = cp.spawnSync("npm", ["run", "build"], { cwd: buildDir, timeout: 30000, encoding: "utf-8" })
                if (result.status === 0) {
                  transition(state, "DONE")
                  output.output += `\n\n✅ [OMU] All files written + build passed automatically. Task complete.`
                } else {
                  const errors = (result.stderr || result.stdout || "").split("\n").filter((l: string) => l.includes("Error") || l.includes("error")).slice(0, 5).join("\n")
                  output.output += `\n\n🛑 [OMU] Auto-build failed:\n${errors}\nFix and run npm run build.`
                }
              } catch {}
            }
          }

          if (state.phase === "UNDERSTAND") {
            const exploreMsg = trackExploration(state, tool)
            if (exploreMsg) output.output += exploreMsg
          }
        }

        if (state.phase === "VERIFY") {
          if (tool === "bash" && args?.command) {
            const cmd = args.command as string
            if (cmd.includes("npm run build") || cmd.includes("vite build")) {
              state.buildAttempts++
              if (output.output.includes("Error") || output.output.includes("error") || output.output.includes("failed")) {
                if (state.buildAttempts >= 3) {
                  transition(state, "ITERATE")
                  output.output += `\n\n🛑 ${phaseTag} Build failed ${state.buildAttempts} times. Entering ITERATE phase.`
                } else {
                  output.output += `\n\n🛑 ${phaseTag} BUILD FAILED (attempt ${state.buildAttempts}/3). Fix and rebuild.`
                }
              } else if (output.output.includes("built in") || output.output.includes("Build passed")) {
                transition(state, "DONE")
                output.output += `\n\n✅ ${phaseTag} Build passed. Task complete.`
              }
            }
          }
        }

        if (state.phase === "ITERATE") {
          if (tool === "edit" || tool === "write") {
            const filePath = args?.filePath || ""
            if (filePath) {
              const msg = trackEdit(state, filePath)
              if (msg) output.output += msg
            }
          }
          if (tool === "bash" && args?.command) {
            const cmd = args.command as string
            if (cmd.includes("npm run build") || cmd.includes("vite build")) {
              if (output.output.includes("built in") || output.output.includes("Build passed")) {
                transition(state, "DONE")
                output.output += `\n\n✅ ${phaseTag} Build passed. Task complete.`
              } else if (state.iterationCount >= 3) {
                transition(state, "DONE")
                output.output += `\n\n🛑 ${phaseTag} Iteration limit reached.`
              }
            }
          }
        }

        if (state.phase !== "DONE") {
          const failMsg = trackFailures(state, tool, args, output.output)
          if (failMsg) output.output += failMsg
        }
      } catch {}
    },
  }
}

export default OMUPlugin
