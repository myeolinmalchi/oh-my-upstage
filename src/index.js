import WorkoutForm from './components/WorkoutForm'
import WorkoutList from './components/WorkoutList'

function fixScaffoldApp(cwd?): void {
  let srcDir = cwd || process.cwd()
  if (!fs.existsSync(srcDir)) srcDir = path.join(cwd || process.cwd(), "client", "src")
  if (!fs.existsSync(srcDir)) return
  const appPath = path.join(srcDir, "App.jsx")
  if (!fs.existsSync(appPath)) return
  const content = fs.readFileSync(appPath, "utf-8")
  // Check if still scaffold
  if (!content.includes("Get started") && !content.includes("Count is")) return
  const compDir = path.join(srcDir, "components")
  const hookDir = path.join(srcDir, "hooks")
  if (!fs.existsSync(compDir)) return
  const components = fs.readdirSync(compDir)
  if (components.length === 0) return
  const hooks: string[] = []
  if (fs.existsSync(hookDir)) {
    fs.readdirSync(hookDir)
      .forEach((f) => hooks.push(path.basename(f, path.extname(f))))
  }
  const diskFiles: string[] = []
  if (fs.existsSync(compDir)) {
    fs.readdirSync(compDir).filter((f) => f.endsWith(".jsx") || f.endsWith(".js")).forEach((f) => diskFiles.push("src/components/" + f))
  }
  if (fs.existsSync(hookDir)) {
    fs.readdirSync(hookDir).filter((f) => f.endsWith(".js") || f.endsWith(".jsx")).forEach((f) => diskFiles.push("src/hooks/" + f))
  }
  if (diskFiles.length > 0) {
    const appJsx = path.join(srcDir, "App.jsx")
    if (fs.existsSync(appJsx)) autoFixImports(appJsx, diskFiles)
    if (fs.existsSync(compDir)) {
      fs.readdirSync(compDir).filter((f) => f.endsWith(".jsx") || f.endsWith(".js")).forEach((f) => {
        autoFixImports(path.join(compDir, f), diskFiles)
      })
    }
  }
}

export default fixScaffoldApp