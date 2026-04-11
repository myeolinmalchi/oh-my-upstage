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

  // Protect scaffold files that shouldn't be overwritten
  if (tool === "write" && args?.filePath) {
    const protectedFiles = ["main.jsx", "main.tsx", "index.html", "vite.config.js"]
    const basename = require("path").basename(args.filePath)
    if (protectedFiles.includes(basename)) {
      return `BLOCKED: Do not overwrite ${basename} — it is part of the project scaffold and already correct.`
    }
  }

  // Block empty edits
  if (tool === "edit" && args.oldString && args.newString && args.oldString === args.newString) {
    return "BLOCKED: oldString and newString are identical. Re-read the file first."
  }

  return null
}

/**
 * Auto-create missing CSS files referenced by imports.
 * Solar Pro 3 consistently imports './Component.css' without creating the file.
 */
export function ensureImportedFiles(tool: string, args: any): void {
  if (tool !== "write" || !args?.filePath || !args?.content) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".tsx")) return
  try {
    const path = require("path")
    const fs = require("fs")
    const dir = path.dirname(args.filePath)
    const imports = (args.content as string).match(/import\s+['"]\.\/(\S+\.css)['"]/g) || []
    for (const imp of imports) {
      const cssFile = imp.match(/['"]\.\/(\S+\.css)['"]/)?.[1]
      if (cssFile) {
        const cssPath = path.join(dir, cssFile)
        if (!fs.existsSync(cssPath)) {
          fs.writeFileSync(cssPath, "/* auto-created by OMU */\n")
        }
      }
    }
  } catch {}
}

/**
 * Enforce App.jsx is written last — after all component files.
 * Returns guidance message if App.jsx is being written too early.
 */
export function enforceAppLast(tool: string, args: any, requiredFiles: string[], completedFiles: string[]): string | null {
  if (tool !== "write" || !args?.filePath) return null
  if (!args.filePath.endsWith("App.jsx")) return null

  const componentFiles = requiredFiles.filter(f => f.includes("components/") || f.includes("hooks/"))
  const completedComponents = componentFiles.filter(f => completedFiles.includes(f))

  if (componentFiles.length > 0 && completedComponents.length < componentFiles.length) {
    const remaining = componentFiles.filter(f => !completedFiles.includes(f))
    return `[OMU] Write component files first before App.jsx. Remaining: ${remaining.join(", ")}`
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
