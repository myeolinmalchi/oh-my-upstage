/**
 * Post-write static analysis for JSX/JS files.
 * Catches common React anti-patterns that build but fail at runtime.
 */

export function analyzeJsx(filePath: string, content: string): string[] {
  const warnings: string[] = []
  if (!filePath.endsWith(".jsx") && !filePath.endsWith(".js")) return warnings

  const isAppFile = filePath.includes("App.jsx") || filePath.includes("App.js")
  const isComponent = filePath.includes("components/")

  // 1. App.jsx: fetch defined but no useEffect
  if (isAppFile) {
    const hasFetch = content.includes("fetch(") || content.includes("axios.")
    const hasUseEffect = content.includes("useEffect")
    if (hasFetch && !hasUseEffect) {
      warnings.push("App.jsx has fetch() but no useEffect to call it on mount. Add: useEffect(() => { fetchData(); }, []);")
    }

    // Check useEffect is imported
    if (hasUseEffect && !content.includes("useEffect") && !content.match(/import.*useEffect/)) {
      warnings.push("useEffect is used but not imported. Add it to your React import.")
    }
  }

  // 2. Conditional rendering hiding empty state UI
  // Pattern: {array.length > 0 && <Component />} or {array.some(...) && <Component />}
  const conditionalRender = content.match(/\{[\w.]+\.(length|some|filter)\b[^}]*&&\s*[\(<]/g)
  if (conditionalRender && isComponent) {
    warnings.push(`Conditional rendering detected (${conditionalRender.length} instance(s)). Columns/lists should ALWAYS render, even when empty, so users can add items. Use the array for mapping items, not for hiding the container.`)
  }

  // 3. Board/List components: columns should always render
  if (filePath.includes("Board") || filePath.includes("List")) {
    const someAndPattern = content.match(/\.some\([^)]+\)\s*&&/g)
    if (someAndPattern) {
      warnings.push("Board uses .some() && to conditionally render columns. Columns must ALWAYS be visible. Remove the .some() guard — render all 3 columns unconditionally and use .filter() only for the items inside each column.")
    }
  }

  // 4. useState but no persistence — custom hook not used
  if (isAppFile || filePath.includes("Board")) {
    const hasUseState = content.includes("useState([])") || content.includes("useState([])")
    const hasLocalStorage = content.includes("localStorage") || content.includes("useLocalStorage")
    const hasFetch = content.includes("fetch(")
    if (hasUseState && !hasLocalStorage && !hasFetch) {
      warnings.push("Data initialized with useState([]) but no persistence (localStorage or API fetch). Data will be lost on reload. Use useLocalStorage hook or fetch from API.")
    }
  }

  // 5. Drag-and-drop: getData returns string, but IDs created with Date.now() are numbers
  if (content.includes("getData") && content.includes("Date.now()")) {
    warnings.push("Drag-drop bug: dataTransfer.getData() returns a string, but Date.now() creates a number ID. Use parseInt() when comparing: parseInt(e.dataTransfer.getData('text/plain'))")
  }
  if (content.includes("getData") && content.includes("=== ")) {
    // Check if there's a strict equality comparison that might fail due to type mismatch
    const getDataUsage = content.match(/getData\([^)]+\)[\s\S]{0,50}===/)
    if (getDataUsage) {
      warnings.push("Potential type mismatch: getData() returns string but === requires exact type match. Use parseInt() or == for ID comparison.")
    }
  }

  // 6. AddCardForm/TransactionForm defined but not rendered
  if (isAppFile || filePath.includes("Board")) {
    const imports = content.match(/import\s+(\w+)\s+from/g) || []
    for (const imp of imports) {
      const name = imp.match(/import\s+(\w+)/)?.[1]
      if (name && name !== "React" && name !== "useState" && name !== "useEffect") {
        // Check if the imported component is actually used in JSX
        const usedInJsx = content.includes(`<${name}`) || content.includes(`<${name} `)
        const usedAsFunction = content.includes(`${name}(`) || content.includes(`${name}.`)
        if (!usedInJsx && !usedAsFunction && !name.startsWith("use")) {
          warnings.push(`Imported '${name}' but never used in JSX. Either render <${name} /> or remove the import.`)
        }
      }
    }
  }

  // 7. Monolith detection: App.jsx with inline component definitions
  if (isAppFile) {
    const funcDefs = content.match(/(?:function|const)\s+([A-Z][a-zA-Z]+)\s*(?:=|\()/g) || []
    const componentDefs = funcDefs.filter((d: string) => {
      const name = d.match(/(?:function|const)\s+([A-Z][a-zA-Z]+)/)?.[1]
      return name && name !== "App"
    })
    if (componentDefs.length >= 2) {
      const names = componentDefs.map((d: string) => d.match(/(?:function|const)\s+([A-Z][a-zA-Z]+)/)?.[1]).filter(Boolean)
      warnings.push(`App.jsx contains ${componentDefs.length} inline component definitions (${names.join(", ")}). Move each component to its own file under src/components/ and import them in App.jsx.`)
    }
    // Also check if file is too long without component separation
    const lines = content.split("\n").length
    if (lines > 80 && !content.includes("from './components/")) {
      warnings.push(`App.jsx is ${lines} lines long with no component imports. Split UI sections into separate component files under src/components/.`)
    }
  }

  return warnings
}

/**
 * Check if a server file (server.js/server.py) handles all CRUD operations.
 */
export function analyzeServer(filePath: string, content: string): string[] {
  const warnings: string[] = []
  if (!filePath.endsWith("server.js") && !filePath.endsWith("server.py")) return warnings

  const hasGet = content.includes("GET") || content.includes(".get(") || content.includes("@app.get")
  const hasPost = content.includes("POST") || content.includes(".post(") || content.includes("@app.post")
  const hasPut = content.includes("PUT") || content.includes(".put(") || content.includes("@app.put")
  const hasDelete = content.includes("DELETE") || content.includes(".delete(") || content.includes("@app.delete")

  if (!hasGet) warnings.push("Server missing GET endpoint for listing records.")
  if (!hasPost) warnings.push("Server missing POST endpoint for creating records.")
  if (!hasPut) warnings.push("Server missing PUT endpoint for updating records.")
  if (!hasDelete) warnings.push("Server missing DELETE endpoint for deleting records.")

  // Express: check json middleware
  if (filePath.endsWith("server.js")) {
    if (!content.includes("express.json") && !content.includes("bodyParser")) {
      warnings.push("Express server missing JSON body parser. Add: app.use(express.json())")
    }
    if (!content.includes("listen")) {
      warnings.push("Express server missing .listen() call. The server won't start.")
    }
  }

  // FastAPI: check CORS
  if (filePath.endsWith("server.py")) {
    if (!content.includes("CORSMiddleware") && !content.includes("cors")) {
      warnings.push("FastAPI server missing CORS middleware. Frontend won't be able to connect.")
    }
  }

  return warnings
}
