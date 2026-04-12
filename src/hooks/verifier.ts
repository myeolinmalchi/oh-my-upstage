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

    // Also detect hook usage: useXxx( calls without import
    const hookCalls = [...new Set((content.match(/\buse[A-Z]\w+\s*\(/g) || []).map((m: string) => m.replace(/\s*\($/, "")))]
    const reactHooks = new Set(["useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext", "useReducer", "useId", "useLayoutEffect"])
    for (const hook of hookCalls as string[]) {
      if (reactHooks.has(hook)) continue
      if (hook === selfName) continue  // Don't self-import
      if (content.includes(`import ${hook}`) || content.includes(`import { ${hook}`)) continue
      const hookFile = componentFiles.find(f => path.basename(f, path.extname(f)) === hook)
      if (hookFile) {
        const fromDir = path.dirname(appJsxPath).replace(/^.*?src/, "src")
        const toFile = hookFile.replace(/^.*?src\//, "src/").replace(path.extname(hookFile), "")
        let rel = "./" + path.relative(fromDir, toFile)
        if (!rel.startsWith("./") && !rel.startsWith("../")) rel = "./" + rel
        const importLine = `import ${hook} from '${rel}';\n`
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

/**
 * After writing a Python server file (FastAPI/Express), start it and test CRUD endpoints.
 */
export function smokeTestServer(filePath: string): string | null {
  if (!filePath.endsWith("server.py") && !filePath.endsWith("server.js")) return null
  try {
    const cp = require("child_process")
    const isFastAPI = filePath.endsWith(".py")
    const port = isFastAPI ? 19980 : 19981

    // Start server
    const cmd = isFastAPI
      ? ["python3", "-c", `import uvicorn; import importlib.util; spec=importlib.util.spec_from_file_location('s','${filePath}'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); uvicorn.run(m.app,port=${port})`]
      : ["node", filePath]

    const proc = cp.spawn(cmd[0], cmd.slice(1), { stdio: "ignore", detached: true, env: { ...process.env, PORT: String(port) } })
    cp.spawnSync("sleep", ["2"])

    const errors: string[] = []
    // Test POST
    const postRes = cp.spawnSync("curl", ["-s", "-w", "%{http_code}", "-X", "POST", `http://localhost:${port}/api/transactions/`, "-H", "Content-Type: application/json", "-d", '{"amount":100,"type":"income","category":"test","description":"test","date":"2026-01-01"}'], { timeout: 5000, encoding: "utf-8" })
    if (!postRes.stdout?.includes("200") && !postRes.stdout?.includes("201")) {
      errors.push(`POST /api/transactions/ returned: ${postRes.stdout?.slice(-3)}`)
    }

    // Test GET
    const getRes = cp.spawnSync("curl", ["-s", "-w", "%{http_code}", `http://localhost:${port}/api/transactions/`], { timeout: 5000, encoding: "utf-8" })
    if (!getRes.stdout?.includes("200")) {
      errors.push(`GET /api/transactions/ returned: ${getRes.stdout?.slice(-3)}`)
    }

    try { process.kill(-proc.pid!) } catch {}

    if (errors.length > 0) {
      return `\n\n🛑 [OMU] API SMOKE TEST FAILED:\n${errors.join("\n")}\nFix the server endpoints and ensure CRUD works.`
    }
  } catch {}
  return null
}

/**
 * Auto-add CORS middleware to Express server.js files.
 */
export function autoFixCors(filePath: string): void {
  if (!filePath.endsWith("server.js")) return
  try {
    const fs = require("fs")
    if (!fs.existsSync(filePath)) return
    let content = fs.readFileSync(filePath, "utf-8")
    if (content.includes("cors")) return // already has cors

    // Add require('cors') after last require
    const corsRequire = "const cors = require('cors');\n"
    const corsUse = "app.use(cors());\n"

    // Insert require after last require() line
    const lastRequire = content.lastIndexOf("require(")
    if (lastRequire >= 0) {
      const lineEnd = content.indexOf("\n", lastRequire)
      content = content.slice(0, lineEnd + 1) + corsRequire + content.slice(lineEnd + 1)
    } else {
      content = corsRequire + content
    }

    // Insert app.use(cors()) after app.use(express.json()) or after app creation
    const jsonMiddleware = content.indexOf("express.json()")
    if (jsonMiddleware >= 0) {
      const lineEnd = content.indexOf("\n", jsonMiddleware)
      content = content.slice(0, lineEnd + 1) + corsUse + content.slice(lineEnd + 1)
    } else {
      const appCreate = content.indexOf("express()")
      if (appCreate >= 0) {
        const lineEnd = content.indexOf("\n", appCreate)
        content = content.slice(0, lineEnd + 1) + "\n" + corsUse + content.slice(lineEnd + 1)
      }
    }

    fs.writeFileSync(filePath, content)

    // Install cors package if needed
    const path = require("path")
    const cp = require("child_process")
    const dir = path.dirname(filePath)
    cp.spawnSync("npm", ["install", "cors"], { cwd: dir, timeout: 15000, encoding: "utf-8" })
  } catch {}
}

/**
 * Auto-fix relative API URLs in frontend files.
 * Rewrites fetch('/api/...') to fetch('http://localhost:PORT/api/...')
 * by detecting the backend server port from server.js or server.py.
 */
export function autoFixApiUrls(filePath: string): void {
  if (!filePath.endsWith(".jsx") && !filePath.endsWith(".js")) return
  try {
    const fs = require("fs")
    const path = require("path")
    if (!fs.existsSync(filePath)) return

    let content = fs.readFileSync(filePath, "utf-8")
    // Only fix if there are relative /api/ fetches
    if (!content.match(/fetch\s*\(\s*['"`]\/api\//)) return

    // Find backend server file by walking up directories
    let searchDir = path.dirname(filePath)
    // Go up from client/src to project root
    for (let i = 0; i < 5; i++) {
      const serverJs = path.join(searchDir, "server.js")
      const serverPy = path.join(searchDir, "server.py")
      if (fs.existsSync(serverJs)) {
        const serverContent = fs.readFileSync(serverJs, "utf-8")
        const portMatch = serverContent.match(/(?:PORT|port)\s*[=:]\s*(\d+)/) || serverContent.match(/listen\s*\(\s*(\d+)/)
        const port = portMatch ? portMatch[1] : "3001"
        content = content.replace(/fetch\s*\(\s*(['"`])\/api\//g, `fetch($1http://localhost:${port}/api/`)
        fs.writeFileSync(filePath, content)
        return
      }
      if (fs.existsSync(serverPy)) {
        const serverContent = fs.readFileSync(serverPy, "utf-8")
        const portMatch = serverContent.match(/port\s*[=:]\s*(\d+)/)
        const port = portMatch ? portMatch[1] : "8000"
        content = content.replace(/fetch\s*\(\s*(['"`])\/api\//g, `fetch($1http://localhost:${port}/api/`)
        fs.writeFileSync(filePath, content)
        return
      }
      searchDir = path.dirname(searchDir)
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

/**
 * Auto-fix prop name mismatches between App.jsx and component files.
 * Runs before build. Reads App.jsx to find passed props, reads each component
 * to find destructured props, and renames mismatched props in the component.
 */
export function autoFixProps(srcDir: string): void {
  try {
    const fs = require("fs")
    const path = require("path")

    const appPath = path.join(srcDir, "App.jsx")
    if (!fs.existsSync(appPath)) return

    const appContent = fs.readFileSync(appPath, "utf-8")
    const compDir = path.join(srcDir, "components")
    if (!fs.existsSync(compDir)) return

    const components = fs.readdirSync(compDir).filter((f: string) => f.endsWith(".jsx") || f.endsWith(".js"))

    for (const compFile of components) {
      const compName = path.basename(compFile, path.extname(compFile))

      // Find <CompName prop1={...} prop2={...} /> in App.jsx
      const compRegex = new RegExp(`<${compName}\\s+([^>]+?)\\s*(?:/>|>)`, "s")
      const match = appContent.match(compRegex)
      if (!match) continue

      // Extract prop names passed from App.jsx
      const propsStr = match[1]
      const passedProps = [...propsStr.matchAll(/(\w+)\s*[={]/g)].map((m: any) => m[1])
        .filter((p: string) => p !== "key" && p !== "ref" && p !== "className")

      // Read component file
      const compPath = path.join(compDir, compFile)
      let compContent = fs.readFileSync(compPath, "utf-8")

      // Find destructured props: ({ prop1, prop2 }) or ({ prop1, prop2, ...rest })
      const destructuredMatch = compContent.match(/(?:function\s+\w+|const\s+\w+\s*=)\s*\(\s*\{([^}]+)\}\s*\)/)
      if (!destructuredMatch) continue

      const destructuredStr = destructuredMatch[1]
      const destructuredProps = destructuredStr.split(",")
        .map((p: string) => p.trim().split("=")[0].split(":")[0].trim())
        .filter((p: string) => p && !p.startsWith("..."))

      // Find exact matches
      const matched = new Set(destructuredProps.filter((p: string) => passedProps.includes(p)))
      const missingInPassed = destructuredProps.filter((p: string) => !matched.has(p))
      const extraInPassed = passedProps.filter((p: string) => !matched.has(p))

      if (missingInPassed.length === 0 || extraInPassed.length === 0) continue

      // Match unmatched props by similarity (shared lowercase substring)
      let changed = false
      for (const missing of missingInPassed) {
        const missingLower = missing.toLowerCase()
        let bestMatch = ""
        let bestScore = 0
        for (const extra of extraInPassed) {
          const extraLower = extra.toLowerCase()
          // Check for shared meaningful substring (3+ chars)
          let score = 0
          for (let len = 3; len <= Math.min(missingLower.length, extraLower.length); len++) {
            for (let i = 0; i <= missingLower.length - len; i++) {
              const sub = missingLower.slice(i, i + len)
              if (extraLower.includes(sub) && len > score) score = len
            }
          }
          if (score > bestScore) { bestScore = score; bestMatch = extra }
        }
        if (bestMatch && bestScore >= 3) {
          // Rename: missing → bestMatch in the component file
          compContent = compContent.replace(new RegExp(`\\b${missing}\\b`, "g"), bestMatch)
          changed = true
          // Remove from extraInPassed to avoid double matching
          const idx = extraInPassed.indexOf(bestMatch)
          if (idx >= 0) extraInPassed.splice(idx, 1)
        }
      }

      if (changed) {
        fs.writeFileSync(compPath, compContent)
      }
    }
  } catch {}
}
