import type { Plugin } from "@opencode-ai/plugin"
declare var Bun: any
declare var require: any

function debugLog(msg: string) {
  try {
    if (typeof Bun !== "undefined") {
      const file = Bun.file("/tmp/omu-debug.log")
      Bun.write("/tmp/omu-debug.log", (file.size > 0 ? new TextDecoder().decode(Bun.readableStreamToBytes(file.stream())) : "") + `${new Date().toISOString()} ${msg}\n`)
    }
  } catch {
    try {
      const fs = require("fs")
      fs.appendFileSync("/tmp/omu-debug.log", `${new Date().toISOString()} ${msg}\n`)
    } catch {}
  }
}

/**
 * Session state — tracks tool usage patterns per session for hook logic.
 * Minimal: only what hooks need to make decisions.
 */
interface SessionState {
  readFiles: Map<string, number>
  editCounts: Map<string, number>
  /** Tracks file sizes at read time for integrity guard */
  fileSizes: Map<string, number>
  /** key = hash of (toolName + JSON(args)), value = consecutive failure count */
  failureStreaks: Map<string, number>
  /** key = hash of (toolName + JSON(args)), value = consecutive call count */
  callStreaks: Map<string, number>
  lastCallHash: string | null
  /** Tracks whether model ran python/tests after last write */
  lastWriteFile: string | null
  ranTestAfterWrite: boolean
  /** Tracks reads vs writes to detect exploration without creation */
  readsWithoutWrite: number
  hasWrittenAnyFile: boolean
}

function createSessionState(): SessionState {
  return {
    readFiles: new Map(),
    editCounts: new Map(),
    fileSizes: new Map(),
    failureStreaks: new Map(),
    callStreaks: new Map(),
    lastCallHash: null,
    lastWriteFile: null,
    ranTestAfterWrite: true,
    readsWithoutWrite: 0,
    hasWrittenAnyFile: false,
  }
}

function hashCall(tool: string, args: any): string {
  try {
    return `${tool}::${JSON.stringify(args)}`
  } catch {
    return `${tool}::unknown`
  }
}

/**
 * P0 Hook 1: Argument Validator (tool.execute.before)
 *
 * Solar Pro 3 frequently omits required fields (description for bash,
 * filePath for write, offset sending 0 instead of >= 1).
 * This hook injects sensible defaults before the tool executes.
 */
function argumentValidator(tool: string, args: any): string | null {
  if (!args) return null

  // bash: description is required
  if (tool === "bash" && !args.description) {
    args.description = "Execute command"
  }

  // read: offset must be >= 1
  if (tool === "read" && args.offset !== undefined && args.offset < 1) {
    args.offset = 1
  }

  // edit: block empty edits (oldString === newString)
  if (tool === "edit" && args.oldString && args.newString && args.oldString === args.newString) {
    return "BLOCKED: oldString and newString are identical. Re-read the file first to get the exact current content, then make a different change."
  }

  return null
}

/**
 * P0 Hook 2: Loop Detection (tool.execute.after)
 *
 * Solar Pro 3 repeatedly edits the same file or calls the same tool
 * with identical args. Detect and inject warning into output.
 */
function loopDetector(
  state: SessionState,
  tool: string,
  args: any,
  output: { output: string },
): void {
  // Track file edits
  if (tool === "edit" || tool === "write") {
    const filePath = args?.file_path || args?.filePath || ""
    if (filePath) {
      const count = (state.editCounts.get(filePath) || 0) + 1
      state.editCounts.set(filePath, count)

      if (count >= 5) {
        output.output += `\n\n🛑 [OMU Harness] This file has been edited ${count} times. STOP using Edit on this file. Instead: re-read the entire file, then use Write to create the complete updated version with ALL your changes applied at once.`
      } else if (count >= 3) {
        output.output += `\n\n⚠️ [OMU Harness] This file has been edited ${count} times. If you are stuck, consider using Write to rewrite the complete file instead of editing piece by piece.`
      }
    }
  }

  // Track file reads
  if (tool === "read") {
    const filePath = args?.file_path || args?.filePath || ""
    if (filePath) {
      const count = (state.readFiles.get(filePath) || 0) + 1
      state.readFiles.set(filePath, count)

      if (count >= 4) {
        output.output += `\n\n⚠️ [OMU Harness] You have read this file ${count} times. Use the information you already have instead of re-reading.`
      }
    }
  }

  // Track identical consecutive calls
  const callHash = hashCall(tool, args)
  if (callHash === state.lastCallHash) {
    const streak = (state.callStreaks.get(callHash) || 1) + 1
    state.callStreaks.set(callHash, streak)

    if (streak >= 3) {
      output.output += `\n\n🛑 [OMU Harness] You have made the exact same tool call ${streak} times in a row. STOP and try a completely different approach.`
    }
  } else {
    state.callStreaks.set(callHash, 1)
  }
  state.lastCallHash = callHash
}

/**
 * P0 Hook 3: Retry Escape (tool.execute.after)
 *
 * When a tool call fails (edit oldString mismatch, write errors, etc.),
 * Solar Pro 3 retries the identical call. Detect consecutive failures
 * on the same operation and force a strategy change.
 */
function retryEscaper(
  state: SessionState,
  tool: string,
  args: any,
  output: { output: string },
): void {
  const callHash = hashCall(tool, args)
  const isError =
    output.output.includes("Error:") ||
    output.output.includes("Could not find oldString") ||
    output.output.includes("invalid_type") ||
    output.output.includes("failed")

  if (isError) {
    const streak = (state.failureStreaks.get(callHash) || 0) + 1
    state.failureStreaks.set(callHash, streak)

    if (streak >= 3) {
      output.output += `\n\n🛑 [OMU Harness] This exact operation has failed ${streak} times. DO NOT retry it again. Instead:\n- For Edit failures: re-read the file to get the current content, then try with the exact text\n- For Write failures: check that all required arguments (filePath, content) are provided\n- For Bash failures: verify the command exists and arguments are correct\n- Consider breaking the task into smaller steps`
    } else if (streak >= 2) {
      output.output += `\n\n⚠️ [OMU Harness] This operation has failed ${streak} times. Consider re-reading the file or trying a different approach before retrying.`
    }
  } else {
    // Success — reset failure streak for this call pattern
    state.failureStreaks.delete(callHash)
  }
}

/**
 * Solar Pro 3 system prompt rules — injected via experimental.chat.system.transform.
 * Adapted from oh-my-upstage AGENTS.md for OpenCode context.
 */
const SOLAR_SYSTEM_RULES = `
# OMU Harness — Solar Pro 3 Rules

You are powered by Solar Pro 3. Follow these rules strictly.

## Focus
- ONLY do what the user asked. Do NOT perform unrelated actions.
- Do NOT search the web, install packages, run git commands, or explore unrelated files unless explicitly requested.
- Do NOT use the task/subagent tool for simple tasks. Do the work directly.
- When asked to CREATE a new file: do NOT explore the project first. Start writing the file IMMEDIATELY.
- Do NOT read existing files unless the task specifically asks you to modify them.
- Do NOT use glob, ls, or read on unrelated directories before creating files.

## File Editing
- For SMALL changes (1-2 lines): use Edit.
- For LARGE changes (implementing many TODOs, rewriting most of a file): use Write to rewrite the complete file. Include ALL existing code plus your changes.
- When a file has multiple TODO stubs, do NOT try to Edit them one by one. Instead, Write the complete file with all TODOs implemented at once.
- After an Edit fails, re-read the file to get the current content before retrying.
- After 3 Edit failures on the same file: STOP editing. Re-read the file, then use Write to rewrite it completely.

## Efficiency
- NEVER read the same file more than twice.
- NEVER re-read a file you just created or wrote — you already know its content.
- After creating/editing files, verify by running the code once, then respond.

## Multi-Step Tasks
- Work on ONE file at a time. Finish it completely before starting the next.
- After creating or editing a file, run the code to verify IMMEDIATELY.
- If a test fails, read the EXACT error message. Fix ONLY the failing part.
- Do NOT rewrite entire files to fix small bugs. Use Edit on the specific lines.
- For Python imports: use absolute imports (e.g., "from models import Todo"), NOT relative imports (e.g., "from .models import Todo") unless inside a package with __init__.py.
- Always import what you use: List from typing, datetime from datetime, etc.

## Tool Arguments
- bash: always include the "description" field.
- read: offset must be >= 1 if provided.
- write: always include "filePath" and "content".
- edit: oldString MUST match the file exactly. If Edit fails, re-read the file first.
- edit: NEVER submit an edit where oldString and newString are the same.

## Code Quality — CRITICAL
- Your code must ACTUALLY WORK, not just look correct.
- After implementing, you MUST run the code and verify it works with edge cases.
- Test these edge cases BEFORE saying you are done:
  - Empty input / empty collections
  - None values for Optional parameters (ensure no TypeError/AttributeError)
  - Boundary conditions: first item, last item, single item
  - Delete then add: verify IDs/indices remain unique (use max(existing)+1, NOT len(list)+1)
  - Duplicate inputs: what happens if the same item is added twice?
- If ANY test fails or crashes, FIX IT before completing.
- You are NOT done until the code runs without errors on normal AND edge cases.

## Error Recovery
- When a tool call fails, do NOT retry the exact same call. Change your approach.
- When Edit fails with "Could not find oldString": re-read the file, copy the EXACT text, try again.
- When tests partially pass: focus on the FAILING test only, do not rewrite passing code.
- Maximum 2 retries per operation. After that, try a completely different approach.

## LSP Errors
- When you see "LSP errors detected" after Write/Edit, you MUST fix them immediately.
- Do NOT ignore type errors, undefined variables, or import errors.
- Fix ALL diagnostics before moving to the next step.
`

/**
 * File Integrity Guard — detects when Write would destroy existing file content.
 * Runs in tool.execute.after for "read" (to record sizes)
 * and tool.execute.before for "write" (to check against known size).
 */
function fileIntegrityRecordSize(state: SessionState, tool: string, args: any, output: { output: string }): void {
  if (tool === "read") {
    const filePath = args?.filePath || ""
    if (filePath && output.output) {
      state.fileSizes.set(filePath, output.output.length)
    }
  }
}

function fileIntegrityGuard(state: SessionState, tool: string, args: any): string | null {
  if (tool !== "write") return null
  const filePath = args?.filePath || ""
  const newContent = args?.content || ""
  const knownSize = state.fileSizes.get(filePath)

  if (knownSize && knownSize > 100 && newContent.length < knownSize * 0.5) {
    return `\n⚠️ [OMU Harness] WARNING: You are about to overwrite "${filePath}" with content that is ${Math.round((1 - newContent.length / knownSize) * 100)}% smaller than the original. This may delete existing code. Use Edit instead of Write to modify existing files.`
  }
  return null
}

/**
 * OMU Plugin — Oh My Upstage harness for Solar Pro 3
 */
const OMUPlugin: Plugin = async (ctx) => {
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = createSessionState()
      sessions.set(sessionID, state)
    }
    return state
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        output.system.push(SOLAR_SYSTEM_RULES)
      } catch {}
    },

    "tool.execute.before": async ({ tool, sessionID }, output) => {
      debugLog(`[BEFORE] tool=${tool} args=${JSON.stringify(output.args).slice(0, 200)}`)
      try {
        const blocked = argumentValidator(tool, output.args)
        if (blocked) {
          debugLog(`[BLOCKED] ${blocked}`)
        }
        // File integrity guard — warn before destructive writes
        const state = getState(sessionID)
        const warning = fileIntegrityGuard(state, tool, output.args)
        if (warning) {
          debugLog(`[INTEGRITY] ${warning}`)
        }
        // Write-to-existing guard — if file was already read, suggest Edit
        if (tool === "write" && output.args?.filePath && state.fileSizes.has(output.args.filePath)) {
          debugLog(`[WRITE-GUARD] File ${output.args.filePath} already exists — should use Edit`)
        }
      } catch (e: any) {
        debugLog(`[BEFORE ERROR] ${e?.message}`)
      }
    },

    "tool.execute.after": async ({ tool, sessionID, args }, output) => {
      debugLog(`[AFTER] tool=${tool} output_len=${output.output?.length ?? 0}`)
      try {
        const state = getState(sessionID)
        // Record file sizes for integrity guard
        fileIntegrityRecordSize(state, tool, args, output)
        loopDetector(state, tool, args, output)
        retryEscaper(state, tool, args, output)

        // Exploration detection — nudge creation if too many reads without writes
        if (tool === "read" || tool === "glob" || tool === "grep") {
          if (!state.hasWrittenAnyFile) {
            state.readsWithoutWrite++
            if (state.readsWithoutWrite >= 5) {
              output.output += `\n\n🛑 [OMU Harness] You have read/explored ${state.readsWithoutWrite} times without creating any file. STOP exploring and START writing the requested file NOW.`
            }
          }
        }
        if (tool === "write") {
          state.hasWrittenAnyFile = true
          state.readsWithoutWrite = 0
        }

        // Track write → test sequence
        if (tool === "write" || tool === "edit") {
          const filePath = args?.filePath || ""
          if (filePath.endsWith(".py")) {
            state.lastWriteFile = filePath
            state.ranTestAfterWrite = false
          }
        }

        // Detect test execution after write
        if (tool === "bash" && args?.command) {
          const cmd = args.command as string
          if (cmd.includes("python3") || cmd.includes("python") || cmd.includes("pytest")) {
            state.ranTestAfterWrite = true
          }
        }

        // LSP error enforcement — if output contains LSP errors, amplify the warning
        if ((tool === "write" || tool === "edit") && output.output.includes("LSP errors detected")) {
          output.output += `\n\n🛑 [OMU Harness] LSP errors found. You MUST fix these errors before proceeding. Do NOT ignore them.`
        }

        // Code quality patterns — detect common Solar Pro 3 bugs in written Python code
        if ((tool === "write" || tool === "edit") && args?.filePath?.endsWith(".py") && args?.content) {
          const content = (args.content || "") as string
          // Detect len(list)+1 ID pattern — always wrong for IDs after deletions
          if (content.includes("len(self.") && content.includes("+ 1") && content.includes('"id"')) {
            output.output += `\n\n🛑 [OMU Harness] BUG DETECTED: You are using len()+1 for ID assignment. This causes duplicate IDs after deletions. Use max(id for existing items)+1 instead, or track a separate next_id counter that only increments.`
          }
        }

        // Nudge testing if model wrote code but hasn't tested
        if (tool === "read" && !state.ranTestAfterWrite && state.lastWriteFile) {
          output.output += `\n\n⚠️ [OMU Harness] You modified ${state.lastWriteFile} but haven't run it yet. Run the code with python3 to verify it works before continuing.`
        }
      } catch (e: any) {
        debugLog(`[AFTER ERROR] ${e?.message}`)
      }
    },
  }
}

export default OMUPlugin
