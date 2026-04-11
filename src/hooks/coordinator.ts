/**
 * Session coordination: file tracking, progress guidance, exploration blocking.
 */

export interface SessionState {
  requiredFiles: string[]
  completedFiles: string[]
  readsWithoutWrite: number
  editCounts: Map<string, number>
  failureStreaks: Map<string, number>
  lastCallHash: string | null
}

export function createState(): SessionState {
  return {
    requiredFiles: [],
    completedFiles: [],
    readsWithoutWrite: 0,
    editCounts: new Map(),
    failureStreaks: new Map(),
    lastCallHash: null,
  }
}

export function extractFilePaths(text: string): string[] {
  // Match file paths that contain at least one slash (directory separator)
  // This avoids false positives like "express.json()" → "express.js"
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

function hashCall(tool: string, args: any): string {
  try { return `${tool}::${JSON.stringify(args)}` }
  catch { return `${tool}::unknown` }
}

/**
 * After a write: track completion, return remaining file guidance.
 */
export function trackWrite(state: SessionState, filePath: string): string | null {
  for (const req of state.requiredFiles) {
    if (filePath.endsWith(req) && !state.completedFiles.includes(req)) {
      state.completedFiles.push(req)
    }
  }
  state.readsWithoutWrite = 0

  const remaining = getRemainingFiles(state)
  if (remaining.length > 0) {
    return `\n\n[OMU] File written. Remaining: ${remaining.join(", ")}. Write the next one now.`
  }
  return null
}

/**
 * After an edit: track loop patterns.
 */
export function trackEdit(state: SessionState, filePath: string): string | null {
  const count = (state.editCounts.get(filePath) || 0) + 1
  state.editCounts.set(filePath, count)

  if (count >= 5) {
    return `\n\n🛑 [OMU] This file edited ${count} times. Use Write to rewrite it completely instead.`
  }
  return null
}

/**
 * After any tool: detect exploration without creation.
 */
export function trackExploration(state: SessionState, tool: string): string | null {
  if (tool !== "write" && tool !== "bash") {
    state.readsWithoutWrite++
    if (state.readsWithoutWrite >= 3) {
      const next = getNextFile(state)
      if (next) return `\n\n🛑 [OMU] ${state.readsWithoutWrite} calls without writing. Write ${next} now.`
      return `\n\n🛑 [OMU] ${state.readsWithoutWrite} calls without writing. Start writing code now.`
    }
  }
  if (tool === "write") state.readsWithoutWrite = 0
  return null
}

/**
 * After any tool: detect consecutive failures on same operation.
 */
export function trackFailures(state: SessionState, tool: string, args: any, output: string): string | null {
  const hash = hashCall(tool, args)
  const isError = output.includes("Error:") || output.includes("Could not find oldString") || output.includes("invalid_type")

  if (isError) {
    const streak = (state.failureStreaks.get(hash) || 0) + 1
    state.failureStreaks.set(hash, streak)
    if (streak >= 3) {
      return `\n\n🛑 [OMU] Failed ${streak} times. Try a completely different approach.`
    }
  } else {
    state.failureStreaks.delete(hash)
  }
  return null
}
