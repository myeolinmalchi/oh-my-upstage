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

  // Protect scaffold files — preserve original content by replacing args
  if (tool === "write" && args?.filePath) {
    const protectedFiles = ["main.jsx", "main.tsx", "index.html", "vite.config.js"]
    const basename = require("path").basename(args.filePath)
    if (protectedFiles.includes(basename)) {
      try {
        const fs = require("fs")
        if (fs.existsSync(args.filePath)) {
          // Replace content with original — write proceeds but file stays unchanged
          args.content = fs.readFileSync(args.filePath, "utf-8")
        }
      } catch {}
    }
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

/**
 * Remove duplicate export default statements — keep only the last one.
 */
export function fixDuplicateExports(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  const content = args.content as string
  const matches = content.match(/export\s+default\s+/g)
  if (matches && matches.length > 1) {
    // Keep only the last export default
    const lines = content.split("\n")
    let lastExportIdx = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].match(/export\s+default\s+/)) { lastExportIdx = i; break }
    }
    const filtered = lines.filter((line, i) => i === lastExportIdx || !line.match(/export\s+default\s+/))
    args.content = filtered.join("\n")
  }
}

/**
 * Auto-fix missing React API imports (useState, useEffect, etc.)
 * Runs on every write to .jsx/.js files.
 */
export function fixReactImports(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  // Handle React.xxx pattern — replace with direct import
  let c = args.content as string
  const reactDotPattern = /React\.(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer)\(/g
  if (reactDotPattern.test(c)) {
    c = c.replace(/React\.(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer)\(/g, "$1(")
    args.content = c
  }
  const fixedContent = args.content as string
  const reactApis = ["useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext", "useReducer"]
  const used = reactApis.filter(api => fixedContent.includes(api + "("))
  if (used.length === 0) return

  // Check if already imported — also match: import React, { useState } from 'react'
  const importMatch = fixedContent.match(/import\s+(?:React\s*,\s*)?\{([^}]+)\}\s+from\s+['"]react['"]/)
  const imported = importMatch ? importMatch[1].split(",").map((s: string) => s.trim()) : []
  const missing = used.filter(api => !imported.includes(api))
  if (missing.length === 0) return

  // Add or update React import
  if (importMatch) {
    const hasReactDefault = importMatch[0].includes("React")
    const prefix = hasReactDefault ? "import React, " : "import "
    const newImport = `${prefix}{ ${[...new Set([...imported, ...missing])].join(", ")} } from 'react'`
    args.content = fixedContent.replace(importMatch[0], newImport)
  } else if (fixedContent.includes("import React from 'react'")) {
    args.content = fixedContent.replace("import React from 'react'", `import React, { ${missing.join(", ")} } from 'react'`)
  } else {
    args.content = `import { ${missing.join(", ")} } from 'react'\n` + fixedContent
  }

  // Deduplicate: merge multiple react imports into one
  const lines = (args.content as string).split("\n")
  const reactImportLines: number[] = []
  const allImported = new Set<string>()
  let hasReact = false
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*import\s+(React\s*,\s*)?\{([^}]+)\}\s+from\s+['"]react['"]/)
    if (m) {
      reactImportLines.push(i)
      if (m[1]) hasReact = true
      m[2].split(",").map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => allImported.add(s))
    } else if (lines[i].match(/^\s*import\s+React\s+from\s+['"]react['"]/)) {
      reactImportLines.push(i)
      hasReact = true
    }
  }
  if (reactImportLines.length > 1) {
    // Remove all react import lines except the first, replace the first with merged
    const prefix = hasReact ? "import React, " : "import "
    const merged = `${prefix}{ ${[...allImported].join(", ")} } from 'react'`
    for (let i = reactImportLines.length - 1; i >= 0; i--) {
      if (i === 0) {
        lines[reactImportLines[i]] = merged
      } else {
        lines.splice(reactImportLines[i], 1)
      }
    }
    args.content = lines.join("\n")
  }
}

/**
 * Strip imports of packages not in package.json (framer-motion, emotion, axios, etc.)
 */
export function stripUninstalledImports(tool: string, args: any): void {
  if (tool !== "write" || !args?.filePath || !args?.content) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  try {
    const path = require("path")
    const fs = require("fs")
    // Find nearest package.json
    let pkgDir = path.dirname(args.filePath)
    let pkgJson: any = null
    for (let d = pkgDir; d !== "/"; d = path.dirname(d)) {
      const p = path.join(d, "package.json")
      if (fs.existsSync(p)) { pkgJson = JSON.parse(fs.readFileSync(p, "utf-8")); break }
    }
    if (!pkgJson) return
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies }
    const content = args.content as string
    const lines = content.split("\n")
    const filtered = lines.filter(line => {
      const m = line.match(/^\s*import\s+.*from\s+['"]([^'"./][^'"]*)['"]\s*;?\s*$/)
      if (!m) return true
      const pkg = m[1].split("/")[0] // handle @scope/pkg
      const fullPkg = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : pkg
      if (fullPkg === "react" || fullPkg === "react-dom") return true
      return !!allDeps[fullPkg]
    })
    if (filtered.length < lines.length) {
      args.content = filtered.join("\n")
    }
  } catch {}
}

/**
 * Block .tsx/.ts files in JavaScript projects — redirect to .jsx/.js
 */
export function forceJsx(tool: string, args: any): void {
  if (tool !== "write" || !args?.filePath) return
  const fp = args.filePath as string
  if (fp.endsWith(".tsx")) {
    args.filePath = fp.replace(/\.tsx$/, ".jsx")
    // Strip TypeScript syntax from content
    if (args.content) {
      args.content = (args.content as string)
        .replace(/:\s*(React\.FC|FC|string|number|boolean|any|void|Props|HabitProps|RecipeProps|WorkoutProps|\{[^}]*\})\s*(?=[,\)\=\n;])/g, "")
        .replace(/<[A-Z]\w+>/g, "")  // remove generic type params like <T>
        .replace(/interface\s+\w+\s*\{[^}]*\}/g, "")  // remove interfaces
        .replace(/type\s+\w+\s*=\s*[^;]+;/g, "")  // remove type aliases
    }
  }
  if (fp.endsWith(".ts") && !fp.endsWith(".d.ts")) {
    args.filePath = fp.replace(/\.ts$/, ".js")
    if (args.content) {
      args.content = (args.content as string)
        .replace(/:\s*(string|number|boolean|any|void|\{[^}]*\})\s*(?=[,\)\=\n;])/g, "")
    }
  }

  // Also strip TypeScript syntax from .js/.jsx files (Solar sometimes writes TS in JS)
  if ((fp.endsWith(".jsx") || fp.endsWith(".js")) && args.content) {
    let c = args.content as string
    // Strip return type annotations: (): Type => or (): Type[] =>
    c = c.replace(/\)\s*:\s*[A-Z]\w+(?:\[\])?\s*(?:=>)/g, ") =>")
    // Strip parameter type annotations: (param: Type) but not destructuring
    c = c.replace(/(\w)\s*:\s*(?:string|number|boolean|any|void|[A-Z]\w+(?:\[\])?)\s*(?=[,\)\=\n;])/g, "$1")
    // Strip interface/type blocks
    c = c.replace(/interface\s+\w+\s*\{[^}]*\}/g, "")
    c = c.replace(/type\s+\w+\s*=\s*[^;]+;/g, "")
    if (c !== args.content) args.content = c
  }
}

/**
 * Strip markdown code fences from file content.
 * Solar Pro 3 wraps code in ```js ... ``` which causes parse errors.
 */
export function stripCodeFences(tool: string, args: any): void {
  if (tool !== "write" || !args?.content) return
  const content = args.content as string
  if (content.startsWith("```")) {
    // Remove opening fence (```js, ```typescript, etc.)
    const firstNewline = content.indexOf("\n")
    const withoutOpen = content.slice(firstNewline + 1)
    // Remove closing fence
    const lastFence = withoutOpen.lastIndexOf("```")
    if (lastFence >= 0) {
      args.content = withoutOpen.slice(0, lastFence).trimEnd() + "\n"
    } else {
      args.content = withoutOpen
    }
  }
}

/**
 * Redirect writes from root src/ to client/src/ for fullstack projects.
 */
export function fixClientPath(tool: string, args: any): void {
  if (tool !== "write" || !args?.filePath) return
  try {
    const path = require("path")
    const fs = require("fs")
    const fp = args.filePath as string
    // If writing to /src/ but /client/src/ exists, redirect
    if (fp.includes("/src/") && !fp.includes("/client/")) {
      const parts = fp.split("/src/")
      const projectRoot = parts[0]
      const clientSrc = path.join(projectRoot, "client", "src")
      if (fs.existsSync(clientSrc)) {
        args.filePath = path.join(clientSrc, parts[1])
        ensureDirectory(tool, args)
      }
    }
  } catch {}
}

/**
 * Block destructive bash commands that delete .opencode or .env
 */
export function blockDestructive(tool: string, args: any): void {
  if (tool !== "bash" || !args?.command) return
  const cmd = args.command as string
  if (cmd.match(/rm\s.*\.(opencode|env)/)) {
    args.command = "echo '[OMU] BLOCKED: Cannot delete .opencode or .env'"
  }
}

/**
 * Ensure localStorage persistence for main state arrays in App.jsx.
 * If App.jsx has useState([]) but no localStorage, auto-add:
 * 1. Lazy initializer to load from localStorage
 * 2. useEffect to save on state changes
 */
export function ensurePersistence(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  if (!args.filePath.includes("App.")) return

  let c = args.content as string
  if (c.includes("localStorage")) return

  // Find first useState([]) — this is typically the main data array
  const stateMatch = c.match(/const\s+\[(\w+),\s*(set\w+)\]\s*=\s*useState\((\[\]|\{\})\)/)
  if (!stateMatch) return

  const [fullMatch, varName, setter, defaultVal] = stateMatch
  const key = varName

  // Replace with lazy initializer
  const lazyInit = `const [${varName}, ${setter}] = useState(() => { const s = localStorage.getItem('${key}'); return s ? JSON.parse(s) : ${defaultVal}; })`
  c = c.replace(fullMatch, lazyInit)

  // Add save useEffect right after the line
  const insertPos = c.indexOf(lazyInit) + lazyInit.length
  const nextNewline = c.indexOf("\n", insertPos)
  const saveEffect = `\n  useEffect(() => { localStorage.setItem('${key}', JSON.stringify(${varName})); }, [${varName}]);`
  if (nextNewline >= 0) {
    c = c.slice(0, nextNewline) + saveEffect + c.slice(nextNewline)
  }

  // Ensure useEffect is imported
  if (!c.includes("useEffect")) {
    c = c.replace(
      /import\s+(React\s*,\s*)?\{([^}]+)\}\s+from\s+['"]react['"]/,
      (match, reactPrefix, imports) => {
        const prefix = reactPrefix || ""
        return `import ${prefix}{ ${imports}, useEffect } from 'react'`
      }
    )
  }

  args.content = c
}

/**
 * Ensure list items rendered in .map() have a semantic CSS class: {itemName}-item.
 * Generic: works for any data type (habit, recipe, workout, task, etc.)
 */
export function ensureListItemClass(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  let content = args.content as string
  if (!content.includes(".map(")) return

  // Extract the map callback variable name: items.map((item) => ...)
  const mapMatch = content.match(/(\w+)\.map\(\s*\(?(\w+)/)
  if (!mapMatch) return
  const itemVar = mapMatch[2]  // e.g., "habit", "recipe", "task"
  const itemClass = `${itemVar}-item`

  if (content.includes(itemClass)) return  // already has it

  // Add itemClass to the first element inside .map()
  // Case 1: element has className already — prepend
  const classNameInMap = new RegExp(
    `\\.map\\([^)]*\\)\\s*=>\\s*\\(?\\s*<(\\w+)\\s+([^>]*className=)(["'{])([^"'}]*)\\3`,
    "s"
  )
  const m1 = content.match(classNameInMap)
  if (m1 && !m1[4].includes(itemClass)) {
    content = content.replace(m1[0], m1[0].replace(m1[4], `${itemClass} ${m1[4]}`))
  } else if (!m1) {
    // Case 2: element has no className — add it
    content = content.replace(
      /\.map\(\s*\(?\w+(?:\s*,\s*\w+)?\)?\s*=>\s*\(?\s*<(\w+)\b(?!\s+className)/,
      (match, tag) => match.replace(`<${tag}`, `<${tag} className="${itemClass}"`)
    )
  }

  if (content !== args.content) args.content = content
}

/**
 * Wrap bare callback prop handlers in list components.
 * onClick={onDelete} → onClick={() => onDelete(habit.id || item.id)}
 * This prevents passing the click event instead of the item id.
 */
export function fixCallbackProps(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  if (!args.filePath.includes("/components/")) return
  let content = args.content as string

  // Detect: this component receives a destructured prop like { habit, ... } or { item, ... }
  // Skip on-prefixed props to find the data variable (habit, item, etc.)
  const propsMatch = content.match(/\(\s*\{\s*([^}]+)\}/)
  if (!propsMatch) return
  const allProps = propsMatch[1].split(",").map((p: string) => p.trim().split("=")[0].split(":")[0].trim()).filter(Boolean)
  const itemVar = allProps.find((p: string) => !p.startsWith("on") && p !== "children" && p !== "className" && p !== "key")
  if (!itemVar) return

  // Fix onClick={onXxx} → onClick={() => onXxx(habit.id)}
  // Only for on-prefixed callback props (onDelete, onToggle, onUpdate, etc.)
  content = content.replace(
    /onClick\s*=\s*\{(on[A-Z]\w+)\}/g,
    `onClick={() => $1(${itemVar}.id)}`
  )

  if (content !== args.content) {
    args.content = content
  }
}

/**
 * Auto-add missing export default to component files.
 * Solar Pro 3 sometimes writes `function Component()` without `export default`.
 */
export function fixMissingDefaultExport(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  if (args.filePath.includes("main.") || args.filePath.includes("config.") || args.filePath.includes("index.")) return

  const content = args.content as string
  if (content.includes("export default")) return

  // Find component function: function Xxx or const Xxx
  const funcMatch = content.match(/^(?:export\s+)?(?:function|const)\s+([A-Z]\w+)/m)
  if (funcMatch) {
    const name = funcMatch[1]
    // Check it's not already exported as named
    if (!content.includes(`export { ${name}`)) {
      args.content = content.trimEnd() + `\n\nexport default ${name}\n`
    }
  }
}

/**
 * Fix bracket call syntax: props.onXxx[idx] → props.onXxx(idx)
 * Solar Pro 3 confuses array access with function calls on callback props.
 */
export function fixBracketCallSyntax(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  let content = args.content as string
  // Fix: props.onXxx[yyy] → props.onXxx(yyy)  (callback prop with bracket notation)
  // Also fix: () => props.onXxx[yyy] → () => props.onXxx(yyy)
  const fixed = content.replace(/(\w+\.on[A-Z]\w*)\[(\w+)\]/g, "$1($2)")
  if (fixed !== content) {
    args.content = fixed
  }
}

/**
 * Strip TypeScript-only type imports from .jsx/.js files.
 * Solar Pro 3 sometimes imports TS types (ReactNode, FC, etc.) in JSX.
 */
export function stripTypeScriptImports(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  let content = args.content as string
  const tsTypes = ["ReactNode", "FC", "ReactElement", "CSSProperties", "ChangeEvent", "FormEvent", "MouseEvent", "KeyboardEvent", "HTMLAttributes", "PropsWithChildren"]
  for (const t of tsTypes) {
    // Standalone: import { ReactNode } from 'react'
    content = content.replace(new RegExp(`\\s*import\\s+\\{\\s*${t}\\s*\\}\\s+from\\s+['"]react['"]\\s*;?\\s*\\n?`, "g"), "\n")
    // In destructured list: , ReactNode or ReactNode,
    content = content.replace(new RegExp(`,\\s*${t}\\b`, "g"), "")
    content = content.replace(new RegExp(`${t}\\s*,\\s*`, "g"), "")
  }
  // Also strip type annotations that survived forceJsx: (x: string) → (x)
  content = content.replace(/:\s*(React\.FC|FC)<[^>]*>/g, "")
  if (content !== args.content) {
    args.content = content
  }
}

/**
 * Fix localStorage race condition: convert separate load useEffect + useState([])
 * into lazy initializer pattern.
 *
 * Before: const [x, setX] = useState([]) + useEffect(() => { load from LS }, [])
 * After:  const [x, setX] = useState(() => { load from LS or default })
 */
export function fixLocalStorageInit(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  let c = args.content as string
  if (!c.includes("localStorage.getItem") || !c.includes("useState")) return

  // Find useState with empty default
  const stateMatch = c.match(/const\s+\[(\w+),\s*(set\w+)\]\s*=\s*useState\((\[\]|\{\})\)/)
  if (!stateMatch) return
  const [fullStateDecl, varName, setter, defaultVal] = stateMatch

  // Find the localStorage key used
  const keyMatch = c.match(/localStorage\.getItem\(['"]([^'"]+)['"]\)/)
  if (!keyMatch) return
  const storageKey = keyMatch[1]

  // Check for load useEffect: useEffect(() => { ... localStorage ... setter ... }, [])
  const lines = c.split("\n")
  let loadStart = -1
  let loadEnd = -1
  let braceDepth = 0
  let inLoadEffect = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inLoadEffect && line.match(/useEffect\s*\(\s*\(\)\s*=>/) && !line.includes("[" + varName + "]")) {
      // Check if this useEffect block contains localStorage.getItem and the setter
      const remaining = lines.slice(i, Math.min(i + 10, lines.length)).join("\n")
      if (remaining.includes("localStorage.getItem") && remaining.includes(setter)) {
        loadStart = i
        inLoadEffect = true
        braceDepth = 0
      }
    }
    if (inLoadEffect) {
      for (const ch of line) {
        if (ch === "(") braceDepth++
        if (ch === ")") braceDepth--
      }
      if (braceDepth <= 0 && i > loadStart) {
        loadEnd = i
        break
      }
    }
  }

  if (loadStart === -1 || loadEnd === -1) return

  // Replace useState with lazy initializer
  const lazyInit = `const [${varName}, ${setter}] = useState(() => { const s = localStorage.getItem('${storageKey}'); return s ? JSON.parse(s) : ${defaultVal}; })`
  c = c.replace(fullStateDecl, lazyInit)

  // Remove the load useEffect lines
  const newLines = c.split("\n")
  // Recalculate positions after the replacement (which may shift lines)
  let newLoadStart = -1
  let newLoadEnd = -1
  braceDepth = 0
  inLoadEffect = false

  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i]
    if (!inLoadEffect && line.match(/useEffect\s*\(\s*\(\)\s*=>/) && line.indexOf("[" + varName + "]") === -1) {
      const remaining = newLines.slice(i, Math.min(i + 10, newLines.length)).join("\n")
      if (remaining.includes("localStorage.getItem") && remaining.includes(setter)) {
        newLoadStart = i
        inLoadEffect = true
        braceDepth = 0
      }
    }
    if (inLoadEffect) {
      for (const ch of line) {
        if (ch === "(") braceDepth++
        if (ch === ")") braceDepth--
      }
      if (braceDepth <= 0 && i > newLoadStart) {
        newLoadEnd = i
        break
      }
    }
  }

  if (newLoadStart >= 0 && newLoadEnd >= 0) {
    newLines.splice(newLoadStart, newLoadEnd - newLoadStart + 1)
    c = newLines.join("\n").replace(/\n{3,}/g, "\n\n")
  }

  args.content = c
}

/**
 * Fix useEffect infinite loops: useEffect(() => { setX(...) }, [x])
 * where setX sets the same state variable that's in the dependency array.
 * This always causes an infinite re-render loop.
 */
export function fixInfiniteUseEffect(tool: string, args: any): void {
  if (tool !== "write" || !args?.content || !args?.filePath) return
  if (!args.filePath.endsWith(".jsx") && !args.filePath.endsWith(".js")) return
  let c = args.content as string
  if (!c.includes("useEffect")) return

  const lines = c.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.match(/useEffect\s*\(\s*\(\)\s*=>/)) { i++; continue }

    let depth = 0
    let start = i
    let end = -1
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "(") depth++
        if (ch === ")") depth--
      }
      if (depth <= 0 && j > i) { end = j; break }
    }
    if (end === -1) { i++; continue }

    const block = lines.slice(start, end + 1).join("\n")
    const setterMatch = block.match(/\bset([A-Z]\w*)\s*\(/)
    const depMatch = block.match(/\]\s*,\s*\[(\w+)\]\s*\)/)
    if (setterMatch && depMatch) {
      const setterTarget = setterMatch[1].toLowerCase()
      const depVar = depMatch[1].toLowerCase()
      if (setterTarget === depVar) {
        lines.splice(start, end - start + 1)
        continue
      }
    }
    i = end + 1
  }

  const result = lines.join("\n")
  if (result !== c) args.content = result
}
