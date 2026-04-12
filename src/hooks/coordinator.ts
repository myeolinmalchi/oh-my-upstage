/**
 * Session coordination: state machine for coding workflow.
 * Phases: UNDERSTAND → IMPLEMENT → VERIFY → ITERATE → DONE
 */

export type Phase = "UNDERSTAND" | "IMPLEMENT" | "VERIFY" | "ITERATE" | "DONE"

export interface SessionState {
  phase: Phase
  requiredFiles: string[]
  completedFiles: string[]
  editCounts: Map<string, number>
  failureStreaks: Map<string, number>
  buildAttempts: number
  iterationCount: number
  autoFixRan: boolean
}

export function createState(): SessionState {
  return {
    phase: "UNDERSTAND",
    requiredFiles: [],
    completedFiles: [],
    editCounts: new Map(),
    failureStreaks: new Map(),
    buildAttempts: 0,
    iterationCount: 0,
    autoFixRan: false,
  }
}

export function transition(state: SessionState, newPhase: Phase): void {
  if (state.phase === newPhase) return
  state.phase = newPhase
  if (newPhase === "VERIFY") {
    state.autoFixRan = false
    state.buildAttempts = 0
  }
  if (newPhase === "ITERATE") {
    state.iterationCount++
  }
}

// --- File tracking ---

export function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:[\w.-]+\/)+[\w.-]+\.(?:jsx?|tsx?|py|css|html)/gi) || []
  const excluded = new Set(["package.json", "opencode.json", "vite.config.js", "eslint.config.js", "tsconfig.json", "index.html"])
  return [...new Set(matches)].filter(f => !excluded.has(f) && !f.includes("node_modules"))
}

export function getNextFile(state: SessionState): string | null {
  for (const f of state.requiredFiles) {
    if (!state.completedFiles.includes(f)) return f
  }
  return null
}

export function getRemainingFiles(state: SessionState): string[] {
  return state.requiredFiles.filter(f => !state.completedFiles.includes(f))
}

// --- Phase-aware tracking ---

export function trackWrite(state: SessionState, filePath: string): string | null {
  for (const req of state.requiredFiles) {
    if (filePath.endsWith(req) && !state.completedFiles.includes(req)) {
      state.completedFiles.push(req)
    }
  }

  // Detect write loops: same file written 3+ times
  const writeCount = (state.editCounts.get(filePath) || 0) + 1
  state.editCounts.set(filePath, writeCount)
  if (writeCount >= 3) {
    const next = getNextFile(state)
    if (next) {
      return `\n\n🛑 [OMU] You wrote ${filePath} ${writeCount} times. STOP. Move on to: ${next}`
    }
    return `\n\n🛑 [OMU] You wrote ${filePath} ${writeCount} times. STOP. Run npm run build now.`
  }

  const remaining = getRemainingFiles(state)
  if (remaining.length > 0) {
    return `\n\n[OMU] ✓ File written. Remaining: ${remaining.join(", ")}.`
  }
  return `\n\n[OMU] ✓ All planned files written. Run npm run build now.`
}

export function trackEdit(state: SessionState, filePath: string): string | null {
  const count = (state.editCounts.get(filePath) || 0) + 1
  state.editCounts.set(filePath, count)
  if (count >= 5) {
    return `\n\n🛑 [OMU] File edited ${count} times. Rewrite it completely with write tool.`
  }
  return null
}

export function trackExploration(state: SessionState, tool: string): string | null {
  // Only active in UNDERSTAND phase
  if (state.phase !== "UNDERSTAND") return null
  // Not applicable to write/bash
  if (tool === "write" || tool === "bash") return null
  // Count non-write calls (using editCounts with a special key)
  const key = "__exploration__"
  const count = (state.editCounts.get(key) || 0) + 1
  state.editCounts.set(key, count)
  if (count >= 5) {
    return `\n\n[OMU] You've explored ${count} times. Start writing code now.`
  }
  return null
}

export function trackFailures(state: SessionState, tool: string, args: any, output: string): string | null {
  const isError = output.includes("Error:") || output.includes("Could not find oldString") || output.includes("No changes to apply")

  // Fix #18: Track edit failures per-file and force write-tool after 2 failures
  if (isError && tool === "edit" && args?.filePath) {
    const editKey = `edit::${args.filePath}`
    const streak = (state.failureStreaks.get(editKey) || 0) + 1
    state.failureStreaks.set(editKey, streak)
    if (streak >= 2) {
      return `\n\n🛑 [OMU] Edit failed ${streak} times on ${args.filePath}. STOP using edit. Read the file first, then use the write tool to rewrite it completely.`
    }
  }

  // General failure tracking for non-edit tools
  const hash = `${tool}::${JSON.stringify(args).slice(0, 100)}`
  if (isError) {
    const streak = (state.failureStreaks.get(hash) || 0) + 1
    state.failureStreaks.set(hash, streak)
    if (streak >= 3) {
      return `\n\n🛑 [OMU] Failed ${streak} times on same operation. Try a different approach.`
    }
  } else {
    state.failureStreaks.delete(hash)
  }
  return null
}

// --- Phase prompts ---

export const PHASE_PROMPTS: Record<Phase, string> = {
  UNDERSTAND: `[Phase: UNDERSTAND] Read the project structure and plan your approach. Then start writing files.`,
  IMPLEMENT: `[Phase: IMPLEMENT] Write files now. Hooks first (src/hooks/), then components (src/components/), then App.jsx, then App.css. One component per file. Do NOT use packages not already in package.json. Do NOT run npm run dev.`,
  VERIFY: `[Phase: VERIFY] Run npm run build. If it fails, fix the specific error. Do NOT rewrite files from scratch.`,
  ITERATE: `[Phase: ITERATE] Fix the remaining issues. Focus on the specific errors reported. Do NOT restructure or add new features.`,
  DONE: `[Phase: DONE] Task complete.`,
}
