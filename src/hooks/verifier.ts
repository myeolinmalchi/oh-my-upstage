/**
 * Post-completion verification: run build and feed errors back.
 * This single hook replaces all narrow pattern checks (missing imports,
 * ID patterns, LSP errors, etc.) — the build catches them all.
 */

export function runBuild(buildDir: string): string | null {
  try {
    const cp = require("child_process")
    const result = cp.spawnSync("npm", ["run", "build"], {
      cwd: buildDir,
      timeout: 30000,
      encoding: "utf-8",
    })
    if (result.status !== 0) {
      const output = (result.stderr || result.stdout || "").trim()
      const errorLines = output.split("\n").filter((l: string) =>
        l.includes("Error") || l.includes("error") || l.includes("Cannot") || l.includes("not found")
      ).slice(0, 5).join("\n")
      return `\n\n🛑 [OMU] BUILD FAILED:\n${errorLines}\nFix these errors now.`
    }
    return `\n\n✅ [OMU] Build passed.`
  } catch {
    return null
  }
}

/**
 * Check if a JSX file uses components without importing them.
 * General rule: <CapitalizedName> in JSX requires a matching import.
 */
export function checkMissingImports(filePath: string, content: string): string | null {
  if (!filePath.endsWith(".jsx") && !filePath.endsWith(".tsx")) return null
  const used = [...new Set((content.match(/<([A-Z][a-zA-Z]+)/g) || []).map(m => m.slice(1)))]
  const imported = (content.match(/import\s+(\w+)|import\s*\{([^}]+)\}/g) || [])
    .flatMap(m => m.replace(/import\s*\{?\s*/, "").replace(/\s*\}?\s*$/, "").split(",").map(n => n.trim()))
  const builtins = new Set(["React", "Fragment", "Suspense", "StrictMode"])
  const missing = used.filter(c => !builtins.has(c) && !imported.includes(c))
  if (missing.length > 0) {
    return `\n\n🛑 [OMU] MISSING IMPORTS in ${filePath}: You use <${missing.join(">, <")}> but did not import them. Add import statements for each component.`
  }
  return null
}

export function findBuildDir(filePath: string): string | null {
  try {
    const path = require("path")
    const fs = require("fs")
    for (let d = path.dirname(filePath); d !== "/"; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, "package.json"))) return d
    }
  } catch {}
  return null
}
