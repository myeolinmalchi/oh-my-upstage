import type { Plugin } from "@opencode-ai/plugin"
import { validate, ensureDirectory, ensureImportedFiles, enforceAppLast } from "./hooks/validator"
import { type SessionState, createState, extractFilePaths, trackWrite, trackEdit, trackExploration, trackFailures, getRemainingFiles } from "./hooks/coordinator"
import { runBuild, findBuildDir, runLint, autoFixImports, smokeTestServer, autoFixCors, autoFixApiUrls } from "./hooks/verifier"
import { analyzeJsx, analyzeServer } from "./hooks/analyzer"

const SYSTEM_RULES = `
# OMU Harness

You are a coding agent. Write working code immediately. Do not ask questions. Do not explore unrelated files.
When the harness gives you an error or warning, fix it before proceeding.

## Workflow
1. Write utility hooks first (src/hooks/), then components (src/components/), then App.jsx, then App.css.
2. Each component must be in its own file. Do NOT put multiple components in one file.
3. After all files are written, run npm run build to verify. Fix errors if any.
4. Do NOT run npm run dev, npm start, or any dev server command.

## React Patterns
- Client-only persistence: write a useLocalStorage custom hook first, use it instead of useState for data.
- API apps: use useEffect(() => { fetchData(); }, []) in App.jsx. Use full backend URL (http://localhost:PORT/api/...) not relative paths.
- Containers (lists, columns, grids) must ALWAYS render even when data is empty. Never hide them with conditional rendering.
- dataTransfer.getData() returns a string — use parseInt() for numeric ID comparison.
- All imported components MUST be rendered in JSX. Pass all required callback props to child components.

## Fullstack
- Write server files FIRST, before frontend.
- Express: include express.json() and app.listen().
- FastAPI: use Optional from typing (not int | None), add CORSMiddleware.
`

const OMUPlugin: Plugin = async (ctx) => {
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let s = sessions.get(sessionID)
    if (!s) { s = createState(); sessions.set(sessionID, s) }
    return s
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      try { output.system.push(SYSTEM_RULES) } catch {}
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
      } catch {}
    },

    "tool.execute.before": async ({ tool, sessionID }, output) => {
      try {
        const state = getState(sessionID)
        validate(tool, output.args)
        ensureDirectory(tool, output.args)
        ensureImportedFiles(tool, output.args)

        // Scaffold protection: preserve original content for protected files
        // (validate() handles this via args mutation)
      } catch {}
    },

    "tool.execute.after": async ({ tool, sessionID, args }, output) => {
      try {
        const state = getState(sessionID)

        // Write: track progress, guide next file, verify build when done
        if (tool === "write") {
          const filePath = args?.filePath || ""
          const msg = trackWrite(state, filePath)
          if (msg) output.output += msg

          // Lint only after all files are complete (not per-file)
          // Per-file lint blocks progress on multi-file projects

          // Static analysis on written file
          const fileContent = args?.content || ""
          const jsxWarnings = analyzeJsx(filePath, fileContent)
          const serverWarnings = analyzeServer(filePath, fileContent)
          const allWarnings = [...jsxWarnings, ...serverWarnings]
          if (allWarnings.length > 0) {
            output.output += `\n\n🛑 [OMU] CODE ISSUES DETECTED:\n${allWarnings.map(w => "- " + w).join("\n")}\nFix these issues by rewriting the file with the write tool.`
          }

          // Auto-fix CORS for Express servers
          autoFixCors(filePath)

          // Auto-fix relative API URLs in frontend
          autoFixApiUrls(filePath)

          // Smoke test server files
          const serverMsg = smokeTestServer(filePath)
          if (serverMsg) output.output += serverMsg

          // Auto-fix imports on EVERY JSX write — scan disk for actual component files
          if (filePath.endsWith(".jsx") || filePath.endsWith(".js")) {
            try {
              const path = require("path")
              const fs = require("fs")
              const srcDir = path.dirname(filePath).replace(/\/components$|\/hooks$/, "")
              // Discover actual component/hook files on disk
              const diskFiles: string[] = []
              const compDir = path.join(srcDir, "components")
              const hookDir = path.join(srcDir, "hooks")
              if (fs.existsSync(compDir)) {
                fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js")).forEach((f: string) => diskFiles.push("src/components/" + f))
              }
              if (fs.existsSync(hookDir)) {
                fs.readdirSync(hookDir).filter((f: string) => f.endsWith(".js")).forEach((f: string) => diskFiles.push("src/hooks/" + f))
              }
              if (diskFiles.length > 0) {
                // Fix the written file + App.jsx
                autoFixImports(filePath, diskFiles)
                const appJsx = path.join(srcDir, "App.jsx")
                if (fs.existsSync(appJsx) && appJsx !== filePath) {
                  autoFixImports(appJsx, diskFiles)
                }
              }
            } catch {}
          }

          // Detect components on disk that App.jsx doesn't use
          if (filePath.includes("/components/") || filePath.includes("/hooks/")) {
            try {
              const path = require("path")
              const fs = require("fs")
              const srcDir = path.dirname(filePath).replace(/\/components$|\/hooks$/, "")
              const appJsx = path.join(srcDir, "App.jsx")
              if (fs.existsSync(appJsx)) {
                const appContent = fs.readFileSync(appJsx, "utf-8")
                const compDir = path.join(srcDir, "components")
                const unusedComps: string[] = []
                if (fs.existsSync(compDir)) {
                  for (const f of fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js"))) {
                    const name = path.basename(f, path.extname(f))
                    if (!appContent.includes(name)) unusedComps.push(name)
                  }
                }
                if (unusedComps.length > 0) {
                  output.output += `\n\n🛑 [OMU] App.jsx does not use these components: ${unusedComps.join(", ")}. Rewrite App.jsx with the write tool to import and render them.`
                }
              }
            } catch {}
          }

          const remaining = getRemainingFiles(state)
          if (state.requiredFiles.length > 0 && remaining.length === 0) {

            const buildDir = findBuildDir(filePath)
            if (buildDir) {
              const buildMsg = runBuild(buildDir)
              if (buildMsg) output.output += buildMsg
            }
          }
        }

        // Edit: track loops
        if (tool === "edit") {
          const filePath = args?.filePath || ""
          if (filePath) {
            const msg = trackEdit(state, filePath)
            if (msg) output.output += msg
          }
        }

        // Bash: detect build failures and force retry
        if (tool === "bash" && args?.command) {
          const cmd = args.command as string
          if ((cmd.includes("npm run build") || cmd.includes("npm build")) && output.output.includes("Error")) {
            output.output += `\n\n🛑 [OMU] BUILD FAILED. Fix the errors above (remove imports for files that don't exist, fix syntax errors) and run npm run build again. Do NOT skip this.`
          }
        }

        // Exploration detection
        const exploreMsg = trackExploration(state, tool)
        if (exploreMsg) output.output += exploreMsg

        // Failure tracking
        const failMsg = trackFailures(state, tool, args, output.output)
        if (failMsg) output.output += failMsg

      } catch {}
    },
  }
}

export default OMUPlugin
