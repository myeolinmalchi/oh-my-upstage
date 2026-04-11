import type { Plugin } from "@opencode-ai/plugin"
declare var Bun: any
declare var require: any

function debugLog(msg: string) {
  try {
    if (typeof Bun !== "undefined") {
      const file = Bun.file("/tmp/omu-debug.log")
      Bun.write("/tmp/omu-debug.log", (file.size > 0 ? new TextDecoder().decode(Bun.readableStreamToBytes(file.stream())) : "") + `${new Date().toISOString()} ${msg}\n`)
    }
  } catch {
    try {
      const fs = require("fs")
      fs.appendFileSync("/tmp/omu-debug.log", `${new Date().toISOString()} ${msg}\n`)
    } catch {}
  }
}

/**
 * Session state — tracks tool usage patterns per session for hook logic.
 * Minimal: only what hooks need to make decisions.
 */
interface SessionState {
  readFiles: Map<string, number>
  editCounts: Map<string, number>
  fileSizes: Map<string, number>
  failureStreaks: Map<string, number>
  callStreaks: Map<string, number>
  lastCallHash: string | null
  lastWriteFile: string | null
  ranTestAfterWrite: boolean
  readsWithoutWrite: number
  hasWrittenAnyFile: boolean
  /** Multi-file coordination: files extracted from prompt */
  requiredFiles: string[]
  completedFiles: string[]
}

function createSessionState(): SessionState {
  return {
    readFiles: new Map(),
    editCounts: new Map(),
    fileSizes: new Map(),
    failureStreaks: new Map(),
    callStreaks: new Map(),
    lastCallHash: null,
    lastWriteFile: null,
    ranTestAfterWrite: true,
    readsWithoutWrite: 0,
    hasWrittenAnyFile: false,
    requiredFiles: [],
    completedFiles: [],
  }
}

function hashCall(tool: string, args: any): string {
  try {
    return `${tool}::${JSON.stringify(args)}`
  } catch {
    return `${tool}::unknown`
  }
}

/**
 * P0 Hook 1: Argument Validator (tool.execute.before)
 *
 * Solar Pro 3 frequently omits required fields (description for bash,
 * filePath for write, offset sending 0 instead of >= 1).
 * This hook injects sensible defaults before the tool executes.
 */
function argumentValidator(tool: string, args: any): string | null {
  if (!args) return null

  // Redirect tools Solar Pro 3 misuses — guide to next action
  if (tool === "task" || tool === "question" || tool === "webfetch") {
    return `BLOCKED: Do not use ${tool}. Write code directly using the write tool.`
  }

  // bash: description is required
  if (tool === "bash" && !args.description) {
    args.description = "Execute command"
  }

  // read: offset must be >= 1
  if (tool === "read" && args.offset !== undefined && args.offset < 1) {
    args.offset = 1
  }

  // edit: block empty edits (oldString === newString)
  if (tool === "edit" && args.oldString && args.newString && args.oldString === args.newString) {
    return "BLOCKED: oldString and newString are identical. Re-read the file first."
  }

  return null
}

/**
 * P0 Hook 2: Loop Detection (tool.execute.after)
 *
 * Solar Pro 3 repeatedly edits the same file or calls the same tool
 * with identical args. Detect and inject warning into output.
 */
function loopDetector(
  state: SessionState,
  tool: string,
  args: any,
  output: { output: string },
): void {
  // Track file edits
  if (tool === "edit" || tool === "write") {
    const filePath = args?.file_path || args?.filePath || ""
    if (filePath) {
      const count = (state.editCounts.get(filePath) || 0) + 1
      state.editCounts.set(filePath, count)

      if (count >= 5) {
        output.output += `\n\n🛑 [OMU Harness] This file has been edited ${count} times. STOP using Edit on this file. Instead: re-read the entire file, then use Write to create the complete updated version with ALL your changes applied at once.`
      } else if (count >= 3) {
        output.output += `\n\n⚠️ [OMU Harness] This file has been edited ${count} times. If you are stuck, consider using Write to rewrite the complete file instead of editing piece by piece.`
      }
    }
  }

  // Track file reads
  if (tool === "read") {
    const filePath = args?.file_path || args?.filePath || ""
    if (filePath) {
      const count = (state.readFiles.get(filePath) || 0) + 1
      state.readFiles.set(filePath, count)

      if (count >= 4) {
        output.output += `\n\n⚠️ [OMU Harness] You have read this file ${count} times. Use the information you already have instead of re-reading.`
      }
    }
  }

  // Track identical consecutive calls
  const callHash = hashCall(tool, args)
  if (callHash === state.lastCallHash) {
    const streak = (state.callStreaks.get(callHash) || 1) + 1
    state.callStreaks.set(callHash, streak)

    if (streak >= 3) {
      output.output += `\n\n🛑 [OMU Harness] You have made the exact same tool call ${streak} times in a row. STOP and try a completely different approach.`
    }
  } else {
    state.callStreaks.set(callHash, 1)
  }
  state.lastCallHash = callHash
}

/**
 * P0 Hook 3: Retry Escape (tool.execute.after)
 *
 * When a tool call fails (edit oldString mismatch, write errors, etc.),
 * Solar Pro 3 retries the identical call. Detect consecutive failures
 * on the same operation and force a strategy change.
 */
function retryEscaper(
  state: SessionState,
  tool: string,
  args: any,
  output: { output: string },
): void {
  const callHash = hashCall(tool, args)
  const isError =
    output.output.includes("Error:") ||
    output.output.includes("Could not find oldString") ||
    output.output.includes("invalid_type") ||
    output.output.includes("failed")

  if (isError) {
    const streak = (state.failureStreaks.get(callHash) || 0) + 1
    state.failureStreaks.set(callHash, streak)

    if (streak >= 3) {
      output.output += `\n\n🛑 [OMU Harness] This exact operation has failed ${streak} times. DO NOT retry it again. Instead:\n- For Edit failures: re-read the file to get the current content, then try with the exact text\n- For Write failures: check that all required arguments (filePath, content) are provided\n- For Bash failures: verify the command exists and arguments are correct\n- Consider breaking the task into smaller steps`
    } else if (streak >= 2) {
      output.output += `\n\n⚠️ [OMU Harness] This operation has failed ${streak} times. Consider re-reading the file or trying a different approach before retrying.`
    }
  } else {
    // Success — reset failure streak for this call pattern
    state.failureStreaks.delete(callHash)
  }
}

/**
 * Solar Pro 3 system prompt rules — injected via experimental.chat.system.transform.
 * Adapted from oh-my-upstage AGENTS.md for OpenCode context.
 */
const SOLAR_SYSTEM_RULES = `
# OMU Harness

You must write code immediately. Do not ask questions. Do not explore unrelated files.
When the harness gives you an error or warning, fix it before proceeding.
`

/**
 * Extract file paths from a prompt string.
 * Looks for patterns like src/components/Board.jsx, server.js, server.py, etc.
 */
function extractFilePaths(text: string): string[] {
  const patterns = /(?:[\w.-]+\/)*[\w.-]+\.(?:jsx?|tsx?|py|css|json|html)/gi
  const matches = text.match(patterns) || []
  // Deduplicate and filter out common non-file patterns
  const excluded = new Set(["package.json", "opencode.json", "vite.config.js", "eslint.config.js", "tsconfig.json", "index.html"])
  return [...new Set(matches)].filter(f => !excluded.has(f) && !f.includes("node_modules"))
}

/**
 * Get the next file the model should write.
 */
function getNextFile(state: SessionState): string | null {
  for (const f of state.requiredFiles) {
    if (!state.completedFiles.includes(f)) return f
  }
  return null
}

function getRemainingFiles(state: SessionState): string[] {
  return state.requiredFiles.filter(f => !state.completedFiles.includes(f))
}

/**
 * Auto-verify: run written Python files and feed errors back.
 * This is the core Phase 2 mechanism — don't tell the model how to code,
 * just run the code and show it what broke.
 */
function autoVerifyPython(filePath: string): string | null {
  if (!filePath.endsWith(".py") && !filePath.endsWith(".js")) return null
  try {
    const cp = require("child_process")

    // Node.js syntax check
    if (filePath.endsWith(".js")) {
      const result = cp.spawnSync("node", ["--check", filePath], {
        timeout: 5000,
        encoding: "utf-8",
      })
      if (result.status !== 0) {
        const err = (result.stderr || "unknown error").trim().split("\n").slice(-3).join("\n")
        return `\n\n🛑 [OMU] SYNTAX ERROR in ${filePath}:\n${err}\nFix this error now.`
      }
      return null
    }
    // Step 1: syntax + import check
    const result = cp.spawnSync("python3", ["-c", `
import ast, sys, subprocess, time, json, urllib.request

code = open("${filePath}").read()

# Step 1: syntax check
try:
    ast.parse(code)
except SyntaxError as e:
    print(f"SyntaxError: {e}", file=sys.stderr)
    sys.exit(1)

# Step 2: if FastAPI app, start server and smoke-test endpoints
if "FastAPI" in code and "uvicorn" in code:
    # Find port
    port = 8001
    for line in code.splitlines():
        if "port=" in line and "run" in line:
            try:
                port = int(''.join(c for c in line.split("port=")[1].split(")")[0].split(",")[0] if c.isdigit()))
            except: pass

    proc = subprocess.Popen([sys.executable, "${filePath}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)

    errors = []
    try:
        # Test POST with JSON body
        req = urllib.request.Request(
            f"http://localhost:{port}/todos",
            data=json.dumps({"title": "test"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=3)
            body = json.loads(resp.read())
            if resp.status != 200 and resp.status != 201:
                errors.append(f"POST /todos returned {resp.status}")
            elif "id" not in body:
                errors.append(f"POST /todos response missing 'id' field: {body}")
        except urllib.error.HTTPError as e:
            errors.append(f"POST /todos failed ({e.code}): {e.read().decode()[:200]}")
        except Exception as e:
            errors.append(f"POST /todos error: {e}")

        # Test GET
        try:
            resp = urllib.request.urlopen(f"http://localhost:{port}/todos", timeout=3)
            body = json.loads(resp.read())
            if not isinstance(body, list):
                errors.append(f"GET /todos should return a list, got: {type(body).__name__}")
        except Exception as e:
            errors.append(f"GET /todos error: {e}")

        # Test GET / (HTML)
        try:
            resp = urllib.request.urlopen(f"http://localhost:{port}/", timeout=3)
            html = resp.read().decode()
            if len(html) < 50:
                errors.append(f"GET / returned only {len(html)} bytes — HTML seems incomplete")
        except Exception as e:
            errors.append(f"GET / error: {e}")
    finally:
        proc.terminate()
        proc.wait()

    if errors:
        print("ENDPOINT ERRORS:\\n" + "\\n".join(errors), file=sys.stderr)
        sys.exit(1)
`], {
      timeout: 5000,
      encoding: "utf-8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })
    if (result.status !== 0) {
      const err = (result.stderr || result.stdout || "unknown error").trim().split("\n").slice(-3).join("\n")
      return `\n\n🛑 [OMU Harness] AUTO-VERIFY FAILED — your code has errors:\n${err}\nFix these errors now.`
    }
  } catch {
    // Can't run verification — skip silently
  }
  return null
}

/**
 * File Integrity Guard — detects when Write would destroy existing file content.
 * Runs in tool.execute.after for "read" (to record sizes)
 * and tool.execute.before for "write" (to check against known size).
 */
function fileIntegrityRecordSize(state: SessionState, tool: string, args: any, output: { output: string }): void {
  if (tool === "read") {
    const filePath = args?.filePath || ""
    if (filePath && output.output) {
      state.fileSizes.set(filePath, output.output.length)
    }
  }
}

function fileIntegrityGuard(state: SessionState, tool: string, args: any): string | null {
  if (tool !== "write") return null
  const filePath = args?.filePath || ""
  const newContent = args?.content || ""
  const knownSize = state.fileSizes.get(filePath)

  if (knownSize && knownSize > 100 && newContent.length < knownSize * 0.5) {
    return `\n⚠️ [OMU Harness] WARNING: You are about to overwrite "${filePath}" with content that is ${Math.round((1 - newContent.length / knownSize) * 100)}% smaller than the original. This may delete existing code. Use Edit instead of Write to modify existing files.`
  }
  return null
}

/**
 * OMU Plugin — Oh My Upstage harness for Solar Pro 3
 */
const OMUPlugin: Plugin = async (ctx) => {
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = createSessionState()
      sessions.set(sessionID, state)
    }
    return state
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        output.system.push(SOLAR_SYSTEM_RULES)
      } catch {}
    },

    "chat.message": async ({ sessionID }, output) => {
      try {
        // Extract required file paths from user prompt
        const state = getState(sessionID)
        const text = output.parts?.map((p: any) => p.text || "").join(" ") || ""
        if (text && state.requiredFiles.length === 0) {
          state.requiredFiles = extractFilePaths(text)
          debugLog(`[FILES] Required: ${JSON.stringify(state.requiredFiles)}`)
        }
      } catch {}
    },

    "chat.params": async (_input, output) => {
      try {
        // Enable reasoning mode for better code quality
        (output.options as any).reasoning_effort = "high"
      } catch {}
    },

    "tool.execute.before": async ({ tool, sessionID }, output) => {
      debugLog(`[BEFORE] tool=${tool} args=${JSON.stringify(output.args).slice(0, 200)}`)
      try {
        const state = getState(sessionID)
        const blocked = argumentValidator(tool, output.args)
        if (blocked) {
          const next = getNextFile(state)
          const guidance = next ? ` Write ${next} now.` : ""
          debugLog(`[BLOCKED] ${blocked}${guidance}`)
        }
        // File integrity guard — warn before destructive writes
        const warning = fileIntegrityGuard(state, tool, output.args)
        if (warning) {
          debugLog(`[INTEGRITY] ${warning}`)
        }
        // Write-to-existing guard — if file was already read, suggest Edit
        if (tool === "write" && output.args?.filePath && state.fileSizes.has(output.args.filePath)) {
          debugLog(`[WRITE-GUARD] File ${output.args.filePath} already exists — should use Edit`)
        }
      } catch (e: any) {
        debugLog(`[BEFORE ERROR] ${e?.message}`)
      }
    },

    "tool.execute.after": async ({ tool, sessionID, args }, output) => {
      debugLog(`[AFTER] tool=${tool} output_len=${output.output?.length ?? 0}`)
      try {
        const state = getState(sessionID)
        // Record file sizes for integrity guard
        fileIntegrityRecordSize(state, tool, args, output)
        loopDetector(state, tool, args, output)
        retryEscaper(state, tool, args, output)

        // Exploration detection — guide toward writing
        if (tool !== "write" && tool !== "bash") {
          state.readsWithoutWrite++
          const next = getNextFile(state)
          if (state.readsWithoutWrite >= 3 && next) {
            output.output += `\n\n🛑 [OMU] You have made ${state.readsWithoutWrite} non-write calls. Write ${next} now.`
          } else if (state.readsWithoutWrite >= 3) {
            output.output += `\n\n🛑 [OMU] You have made ${state.readsWithoutWrite} non-write calls. Start writing code now.`
          }
        }
        if (tool === "write") {
          state.readsWithoutWrite = 0
        }
        if (tool === "write") {
          state.hasWrittenAnyFile = true
          state.readsWithoutWrite = 0
          const filePath = args?.filePath || ""

          // Track completed files
          if (filePath) {
            const basename = filePath.split("/").slice(-2).join("/")
            if (!state.completedFiles.includes(basename)) {
              state.completedFiles.push(basename)
            }
            // File progress guidance
            const remaining = getRemainingFiles(state)
            if (remaining.length > 0) {
              output.output += `\n\n[OMU] File written. Remaining files: ${remaining.join(", ")}. Write the next one now.`
            }
          }

          // Auto-verify individual files
          const verifyResult = autoVerifyPython(filePath)
          if (verifyResult) {
            output.output += verifyResult
          }

          // When all required files are written, run npm run build
          const remainingAfter = getRemainingFiles(state)
          if (state.requiredFiles.length > 0 && remainingAfter.length === 0) {
            try {
              const cp = require("child_process")
              // Find the nearest directory with package.json
              const dir = require("path").dirname(filePath)
              let buildDir = dir
              for (let d = dir; d !== "/"; d = require("path").dirname(d)) {
                if (require("fs").existsSync(require("path").join(d, "package.json"))) {
                  buildDir = d; break
                }
              }
              const buildResult = cp.spawnSync("npm", ["run", "build"], {
                cwd: buildDir, timeout: 30000, encoding: "utf-8"
              })
              if (buildResult.status !== 0) {
                const err = (buildResult.stderr || buildResult.stdout || "").trim().split("\n").slice(-5).join("\n")
                output.output += `\n\n🛑 [OMU] BUILD FAILED:\n${err}\nFix the errors and rebuild.`
              } else {
                output.output += `\n\n✅ [OMU] Build succeeded.`
              }
            } catch {}
          }
        }

        // Scaffold detection — npm create is NOT implementation
        if (tool === "bash" && args?.command) {
          const cmd = args.command as string
          if (cmd.includes("create vite") || cmd.includes("create-react") || cmd.includes("create-next") || cmd.includes("express-generator")) {
            output.output += `\n\n🛑 [OMU] Scaffolding is NOT implementation. You created a template. Now implement the actual application code — write the components, routes, and logic. Do NOT stop here.`
          }
        }

        // Track write → test sequence
        if (tool === "write" || tool === "edit") {
          const filePath = args?.filePath || ""
          if (filePath.endsWith(".py")) {
            state.lastWriteFile = filePath
            state.ranTestAfterWrite = false
          }
        }

        // Detect test execution after write
        if (tool === "bash" && args?.command) {
          const cmd = args.command as string
          if (cmd.includes("python3") || cmd.includes("python") || cmd.includes("pytest")) {
            state.ranTestAfterWrite = true
          }
        }

        // LSP error enforcement — if output contains LSP errors, amplify the warning
        if ((tool === "write" || tool === "edit") && output.output.includes("LSP errors detected")) {
          output.output += `\n\n🛑 [OMU Harness] LSP errors found. You MUST fix these errors before proceeding. Do NOT ignore them.`
        }


        // Nudge testing if model wrote code but hasn't tested
        if (tool === "read" && !state.ranTestAfterWrite && state.lastWriteFile) {
          output.output += `\n\n⚠️ [OMU Harness] You modified ${state.lastWriteFile} but haven't run it yet. Run the code with python3 to verify it works before continuing.`
        }
      } catch (e: any) {
        debugLog(`[AFTER ERROR] ${e?.message}`)
      }
    },
  }
}

export default OMUPlugin
