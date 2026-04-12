#!/bin/bash
# Claude Code PostToolUse:Bash hook
# Detects opencode run completion → analyzes trajectory → triggers iteration

INPUT=$(cat /dev/stdin 2>/dev/null || echo "{}")
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

# Only trigger on opencode run commands
echo "$COMMAND" | grep -q "opencode run" || exit 0

# Extract log file from tee command
LOG=$(echo "$COMMAND" | sed -n 's/.*tee \([^ ]*\).*/\1/p')
[ -z "$LOG" ] && exit 0
[ ! -f "$LOG" ] && exit 0

# Analyze trajectory
LINES=$(wc -l < "$LOG")
WRITES=$(grep -c "Wrote file successfully" "$LOG" 2>/dev/null || echo 0)
UNIQUE_FILES=$(grep "← .*Write " "$LOG" | sed 's/.*Write //' | sed 's/\x1b\[[0-9;]*m//g' | sort -u | wc -l)
LOOPS=$(grep "← .*Write " "$LOG" | sed 's/.*Write //' | sed 's/\x1b\[[0-9;]*m//g' | sort | uniq -c | sort -rn | awk '$1 >= 3 {print $2 "(" $1 "x)"}')
HAS_PLAN=$(grep -c "Plan\|계획\|plan\|파일.*구조\|file.*structure" "$LOG" 2>/dev/null || echo 0)
HAS_BUILD=$(grep -c "npm run build\|vite build" "$LOG" 2>/dev/null || echo 0)
BUILD_PASS=$(grep -c "built in" "$LOG" 2>/dev/null || echo 0)
BUILD_FAIL=$(grep -c "BUILD FAILED\|Build failed\|error TS" "$LOG" 2>/dev/null || echo 0)
CODE_FENCES=$(grep -c '```' "$LOG" 2>/dev/null || echo 0)
HOOK_MSGS=$(grep -c "\[OMU\]" "$LOG" 2>/dev/null || echo 0)

# Phase tracking
PHASE_CHANGES=$(grep -c "\[OMU:" "$LOG" 2>/dev/null || echo 0)
UNDERSTAND=$(grep -c "UNDERSTAND" "$LOG" 2>/dev/null || echo 0)
IMPLEMENT=$(grep -c "IMPLEMENT" "$LOG" 2>/dev/null || echo 0)
VERIFY=$(grep -c "VERIFY" "$LOG" 2>/dev/null || echo 0)
DONE=$(grep -c "DONE" "$LOG" 2>/dev/null || echo 0)

# Build verdict
ISSUES=""
[ "$HAS_PLAN" -lt 2 ] && ISSUES="$ISSUES NO_PLANNING"
[ "$UNIQUE_FILES" -eq 0 ] && ISSUES="$ISSUES NO_FILES"
[ -n "$LOOPS" ] && ISSUES="$ISSUES WRITE_LOOP($LOOPS)"
[ "$HAS_BUILD" -eq 0 ] && ISSUES="$ISSUES NO_BUILD"
[ "$BUILD_FAIL" -gt 0 ] && ISSUES="$ISSUES BUILD_FAILED"
[ "$CODE_FENCES" -gt 0 ] && ISSUES="$ISSUES CODE_FENCES"
[ "$HOOK_MSGS" -eq 0 ] && ISSUES="$ISSUES NO_HOOKS_FIRED"

echo ""
echo "[TRAJECTORY ANALYSIS] Log: $LOG"
echo "  Lines: $LINES | Writes: $WRITES | Unique files: $UNIQUE_FILES"
echo "  Build: ${BUILD_PASS}pass/${BUILD_FAIL}fail | Hooks fired: $HOOK_MSGS"
echo "  Phases: UNDERSTAND=$UNDERSTAND IMPLEMENT=$IMPLEMENT VERIFY=$VERIFY DONE=$DONE"
if [ -n "$ISSUES" ]; then
  echo "[TRAJECTORY VERDICT: FAIL] Issues:$ISSUES"
  echo "[ITERATION TRIGGER] Analyze the FULL trajectory at $LOG with a subagent (oh-my-claudecode:analyst). Do NOT use tail/grep — read the entire log. Classify failure patterns. Fix the harness (src/hooks/*.ts or src/index.ts), rebuild (npm run build in project root), and re-run opencode. Do NOT ask the user."
else
  echo "[TRAJECTORY VERDICT: PASS] Hooks fired correctly. Proceed to playwright CRUD testing."
  echo "[ITERATION TRIGGER] Run playwright test: node test_habit.mjs (after starting preview server). If any test FAIL, analyze and fix harness hooks, then re-run opencode."
fi

exit 0
