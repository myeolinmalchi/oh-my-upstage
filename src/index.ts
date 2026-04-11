import type { Plugin } from "@opencode-ai/plugin"
import { validate, ensureDirectory } from "./hooks/validator"
import { type SessionState, createState, extractFilePaths, trackWrite, trackEdit, trackExploration, trackFailures, getRemainingFiles } from "./hooks/coordinator"
import { runBuild, findBuildDir } from "./hooks/verifier"

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
