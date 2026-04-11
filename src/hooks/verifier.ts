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
      // Auto-install missing npm packages
      const missingPkg = output.match(/failed to resolve import "([^"]+)"/)?.[1]
      if (missingPkg && !missingPkg.startsWith(".") && !missingPkg.startsWith("/")) {
        try {
          cp.spawnSync("npm", ["install", missingPkg], { cwd: buildDir, timeout: 30000, encoding: "utf-8" })
          // Retry build
          const retry = cp.spawnSync("npm", ["run", "build"], { cwd: buildDir, timeout: 30000, encoding: "utf-8" })
          if (retry.status === 0) return `\n\n✅ [OMU] Installed ${missingPkg} and build passed.`
        } catch {}
      }
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
 * Run the appropriate linter for the written file.
 * Detects available linters and runs them generically.
 */
export function runLint(filePath: string): string | null {
  try {
    const cp = require("child_process")
    const path = require("path")
    const fs = require("fs")
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)

    // Find project root (nearest package.json or pyproject.toml)
    let projectDir = dir
    for (let d = dir; d !== "/"; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, "package.json")) || fs.existsSync(path.join(d, "pyproject.toml"))) {
        projectDir = d; break
      }
    }

    let result: any = null

    // JS/JSX/TS/TSX: try eslint, then tsc
    if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
      result = cp.spawnSync("npx", ["eslint", "--no-warn-ignored", filePath], {
        cwd: projectDir, timeout: 15000, encoding: "utf-8"
      })
    }
    // Python: try ruff, then flake8, then python -m py_compile
    else if (ext === ".py") {
      for (const cmd of [["ruff", "check", filePath], ["flake8", filePath], ["python3", "-m", "py_compile", filePath]]) {
        result = cp.spawnSync(cmd[0], cmd.slice(1), {
          cwd: projectDir, timeout: 10000, encoding: "utf-8"
        })
        if (result.status === 0 || result.error?.code !== "ENOENT") break
      }
    }

    if (result && result.status !== 0 && !result.error) {
      const errors = (result.stdout || result.stderr || "").trim().split("\n").slice(0, 8).join("\n")
      if (errors.length > 0) {
        return `\n\n🛑 [OMU] LINT ERRORS:\n${errors}\nFix these errors now.`
      }
    }
  } catch {}
  return null
}

/**
 * Auto-inject missing imports into App.jsx.
 * When all files are complete, reads App.jsx, finds <Component> references
 * without imports, and adds import statements automatically.
 */
export function autoFixImports(appJsxPath: string, componentFiles: string[]): void {
  try {
    const fs = require("fs")
    const path = require("path")
    if (!fs.existsSync(appJsxPath)) return

    let content = fs.readFileSync(appJsxPath, "utf-8")
    const used = [...new Set((content.match(/<([A-Z][a-zA-Z]+)/g) || []).map((m: string) => m.slice(1)))]
    const builtins = new Set(["React", "Fragment", "Suspense", "StrictMode"])
    let added = false

    // This file's own component name — skip self-imports
    const selfName = path.basename(appJsxPath, path.extname(appJsxPath))

    for (const comp of used as string[]) {
      if (builtins.has(comp)) continue
      if (comp === selfName) continue  // Don't self-import
      if (content.includes(`import ${comp}`) || content.includes(`import { ${comp}`)) continue

      // Find matching component file
      const match = componentFiles.find(f => path.basename(f, path.extname(f)) === comp)
      if (match) {
        // Build relative import path from THIS file to the target
        const fromDir = path.dirname(appJsxPath).replace(/^.*?src/, "src")
        const toFile = match.replace(/^.*?src\//, "src/").replace(path.extname(match), "")
        let rel = "./" + path.relative(fromDir, toFile)
        if (!rel.startsWith("./") && !rel.startsWith("../")) rel = "./" + rel
        const importLine = `import ${comp} from '${rel}';\n`
        // Add after last import or at top
        const lastImport = content.lastIndexOf("import ")
        if (lastImport >= 0) {
          const lineEnd = content.indexOf("\n", lastImport)
          content = content.slice(0, lineEnd + 1) + importLine + content.slice(lineEnd + 1)
        } else {
          content = importLine + content
        }
        added = true
      }
    }

    // Also fix wrong import paths for existing imports
    const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
    let match2
    while ((match2 = importRegex.exec(content)) !== null) {
      const [full, name, importPath] = match2
      if (importPath.startsWith(".")) {
        const resolved = path.resolve(path.dirname(appJsxPath), importPath)
        const extensions = ["", ".jsx", ".js", ".tsx", ".ts"]
        const exists = extensions.some(ext => fs.existsSync(resolved + ext))
        if (!exists) {
          // Try to find the correct path
          const compFile = componentFiles.find(f => path.basename(f, path.extname(f)) === name)
          if (compFile) {
            const correctRel = "./" + compFile.replace(/^.*?src\//, "").replace(path.extname(compFile), "")
            content = content.replace(importPath, correctRel)
            added = true
          }
        }
      }
    }

    if (added) {
      fs.writeFileSync(appJsxPath, content)
    }
  } catch {}
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
