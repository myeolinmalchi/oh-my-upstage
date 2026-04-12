# OMU Iteration Loop — Habit Tracker

You are the Coordinator of the OMU harness improvement loop. Your job is to iterate until the habit tracker app passes ALL playwright CRUD tests.

## Checklist (ALL must pass)
1. **Planning**: Solar Pro 3가 원샷 프롬프트만으로 파일 구조를 계획하고 올바른 순서로 작성
2. **Hooks**: OMU 하네스 훅들이 실제로 작동 (빌드 검증, autoFixImports, 진행 추적, 시스템 프롬프트 주입)
3. **CRUD**: 습관 추가/삭제, 완료 토글, 스트릭 계산, 새로고침 후 데이터 유지 — playwright 전체 PASS

## Iteration Protocol

### Phase 1: Clean & Setup
```bash
cd app-kanban
# Delete everything except .opencode and .env
find . -maxdepth 1 ! -name '.' ! -name '.opencode' ! -name '.env' ! -name 'node_modules' -exec rm -rf {} +
npm create vite . -- --template react
npm install
```

### Phase 2: Run OpenCode with Trajectory Capture
```bash
cd app-kanban
UPSTAGE_API_KEY=up_vmYrVl1wpnieJYmUn8sHDYz5NN3eF opencode run --agent solar "$(cat ../prompts/habit.md)" 2>&1 | tee ../.omc/logs/trajectory-habit-{N}.log
```
Replace {N} with the current iteration number.

### Phase 3: Trajectory Analysis
Spawn a subagent (oh-my-claudecode:analyst) to read the FULL trajectory log. Check:
- Did Solar output a plan? File order correct? (hooks → components → App.jsx)
- Which OMU hooks fired? ([OMU] messages in log)
- How many files created? Component separation?
- Prop name consistency between App.jsx and components?
- Was npm run build executed? Did it pass?
- Any write loops (same file 3+ times)?

### Phase 4: Build & Test
```bash
cd app-kanban && npm run build
# If build passes, start preview and run playwright
npx vite preview --port 5190 &
sleep 2
node ../test_habit.mjs
kill %1
```

### Phase 5: Evaluate & Fix
If playwright tests have FAILs:
1. Analyze which tests failed and WHY
2. Determine if the fix belongs in:
   - **Harness hooks** (src/hooks/*.ts, src/index.ts) — preferred
   - **System prompt** (BASE_RULES in src/index.ts)
   - **Agent config** (agents/solar.md)
3. Apply fix, rebuild plugin: `npm run build` (in project root)
4. Go back to Phase 1

### Termination
- **SUCCESS**: All 7 playwright tests PASS
- **MAX ITERATIONS**: After 10 iterations, report best result and stop

## Rules
- NEVER modify Solar Pro 3's generated code directly
- ONLY modify harness (hooks/prompts/agent config)
- ALWAYS analyze the FULL trajectory, not just tail
- ALWAYS use `tee` to capture trajectory to `.omc/logs/`
- NEVER commit without explicit permission
- Track PASS history: if a previously passing test regresses, prioritize fixing it
