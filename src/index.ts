import type { Plugin } from "@opencode-ai/plugin"
import { validate, ensureDirectory, ensureImportedFiles, enforceAppLast } from "./hooks/validator"
import { type SessionState, createState, extractFilePaths, trackWrite, trackEdit, trackExploration, trackFailures, getRemainingFiles } from "./hooks/coordinator"
import { runBuild, findBuildDir, runLint, autoFixImports, smokeTestServer } from "./hooks/verifier"

const SYSTEM_RULES = `
# OMU Harness

You must write code immediately. Do not ask questions. Do not explore unrelated files.
When the harness gives you an error or warning, fix it before proceeding.
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
        const blocked = validate(tool, output.args)
        if (blocked) return // tool will see the block message
        ensureDirectory(tool, output.args)
        ensureImportedFiles(tool, output.args)
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

          // Smoke test server files
          const serverMsg = smokeTestServer(filePath)
          if (serverMsg) output.output += serverMsg

          // If App.jsx was written before components, tell model to write components first then rewrite App.jsx
          if (filePath.endsWith("App.jsx")) {
            const componentFiles = state.requiredFiles.filter(f => f.includes("components/") || f.includes("hooks/"))
            const completedComponents = componentFiles.filter(f => state.completedFiles.includes(f))
            if (componentFiles.length > 0 && completedComponents.length < componentFiles.length) {
              const remaining = componentFiles.filter(f => !state.completedFiles.includes(f))
              output.output += `\n\n🛑 [OMU] You wrote App.jsx but component files are not done yet. Write these first: ${remaining.join(", ")}. Then REWRITE App.jsx with proper imports for all components.`
            }
          }

          const remaining = getRemainingFiles(state)
          if (state.requiredFiles.length > 0 && remaining.length === 0) {
            // All files written — auto-fix imports in ALL jsx files
            try {
              const path = require("path")
              const fs = require("fs")
              const srcDir = path.dirname(filePath).replace(/\/components$|\/hooks$/, "")
              // Fix App.jsx and all component files
              const allJsx = [path.join(srcDir, "App.jsx")]
              const compDir = path.join(srcDir, "components")
              if (fs.existsSync(compDir)) {
                fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx")).forEach((f: string) => allJsx.push(path.join(compDir, f)))
              }
              for (const jsxFile of allJsx) {
                if (fs.existsSync(jsxFile)) {
                  autoFixImports(jsxFile, state.completedFiles)
                }
              }
            } catch {}

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
