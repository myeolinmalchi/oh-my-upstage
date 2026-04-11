/**
 * Pre-execution validation: fix arguments, create directories, block tools.
 */

const DENIED_TOOLS = new Set(["task", "question", "webfetch", "websearch", "todowrite", "skill"])

export function validate(tool: string, args: any): string | null {
  // Block denied tools with guidance
  if (DENIED_TOOLS.has(tool)) {
    return `BLOCKED: Do not use ${tool}. Write code directly using the write tool.`
  }

  if (!args) return null

  // Auto-fill missing required args
  if (tool === "bash" && !args.description) {
    args.description = "Execute command"
  }
  if (tool === "read" && args.offset !== undefined && args.offset < 1) {
    args.offset = 1
  }

  // Block empty edits
  if (tool === "edit" && args.oldString && args.newString && args.oldString === args.newString) {
    return "BLOCKED: oldString and newString are identical. Re-read the file first."
  }

  return null
}

export function ensureDirectory(tool: string, args: any): void {
  if (tool !== "write" || !args?.filePath) return
  try {
    const dir = require("path").dirname(args.filePath)
    if (!require("fs").existsSync(dir)) {
      require("fs").mkdirSync(dir, { recursive: true })
    }
  } catch {}
}
