# OMU Iteration — Single Command Entry Point

이 커맨드를 실행하면 `/team`으로 3명의 에이전트 팀을 생성하고, TaskList로 iteration 흐름을 강제합니다.

## 실행 순서

### 1. Team 생성
```
TeamCreate({ team_name: "omu-iter", description: "OMU harness iteration loop" })
```

### 2. Teammate Spawn
```
Agent({
  name: "engineer",
  subagent_type: "oh-my-claudecode:executor",
  team_name: "omu-iter",
  model: "opus",
  prompt: "You are the Engineer in the OMU iteration team. Your job:
  1. Analyze opencode trajectory logs (read the FULL log, not tail/grep)
  2. Identify failure patterns with line-number evidence
  3. Fix harness hooks (src/hooks/*.ts, src/index.ts) — GENERIC fixes only, no monkey-patches
  4. Rebuild plugin: cd /Users/mason/workspace/upstage-ambassador/omu && npm run build
  
  Rules:
  - NEVER modify Solar Pro 3's generated code
  - ONLY modify harness hooks/prompts
  - All hook fixes must be generic (work for any app, not just habit tracker)
  - Include trajectory log line numbers in your reports
  
  Check TaskList for your assignments. Mark tasks completed when done."
})

Agent({
  name: "qa",
  subagent_type: "oh-my-claudecode:qa-tester",
  team_name: "omu-iter",
  model: "sonnet",
  prompt: "You are QA in the OMU iteration team. Your job:
  1. Test apps with playwright — start preview server, navigate, interact with UI directly
  2. Review PRs for code quality and regression risk
  
  Testing protocol:
  - cd /Users/mason/workspace/upstage-ambassador/omu/app-kanban
  - npx vite preview --port 5190 &
  - Use playwright chromium to navigate to localhost:5190
  - Test: 추가, 삭제(✕), 토글(미완료/완료), 스트릭, 새로고침 후 유지
  - Report each as PASS/FAIL with what you saw
  - Do NOT run test_habit.mjs — test manually with playwright
  
  For PR review:
  - Check regex hooks for false positives
  - Check for regressions
  - APPROVE or REQUEST CHANGES
  
  Check TaskList for your assignments. Mark tasks completed when done."
})
```

### 3. Iteration 1 Tasks 생성 (의존성 체인으로 순서 강제)

```
Task 1: "Clean app-kanban + run opencode with trajectory capture"
  owner: coordinator (me)
  description: |
    cd /Users/mason/workspace/upstage-ambassador/omu/app-kanban
    find . -maxdepth 1 ! -name . ! -name .opencode ! -name .env ! -name node_modules -exec rm -rf {} +
    cp -r /tmp/vite-scaffold/* . && npm install
    UPSTAGE_API_KEY=$UPSTAGE_API_KEY opencode run --agent solar "$(cat ../prompts/habit.md)" 2>&1 | tee ../.omc/logs/trajectory-habit-1.log

Task 2: "Analyze trajectory + report patterns"
  owner: engineer
  blockedBy: [1]
  description: Read FULL .omc/logs/trajectory-habit-1.log. Report failure patterns with line numbers.

Task 3: "Create GitHub Issues with log evidence"
  owner: coordinator
  blockedBy: [2]
  description: Based on engineer's report, gh issue create for each new pattern. Include log line evidence.

Task 4: "Fix harness hooks (generic only)"
  owner: engineer
  blockedBy: [3]
  description: Fix hooks in src/hooks/*.ts. Generic solutions only. Rebuild plugin.

Task 5: "Clean + re-run opencode"
  owner: coordinator
  blockedBy: [4]
  description: Clean app-kanban, re-run opencode with updated plugin.

Task 6: "Test with playwright (direct UI)"
  owner: qa
  blockedBy: [5]
  description: Build app, start preview, test all CRUD with playwright directly.

Task 7: "Create PR (branch + commit + push + gh pr create)"
  owner: coordinator
  blockedBy: [6]
  description: git checkout -b iteration/N, commit hook changes, push, gh pr create with analysis.

Task 8: "Review PR"
  owner: qa
  blockedBy: [7]
  description: Review the PR. APPROVE or REQUEST CHANGES.

Task 9: "Merge + decide next"
  owner: coordinator
  blockedBy: [8]
  description: If approved, gh pr merge. If 7/7 PASS → done. Else create next iteration tasks.
```

### 4. Coordinator가 Task 1부터 실행 시작

Task 1을 직접 수행한 후, TaskList를 체크하고 의존성이 해소된 다음 task를 해당 teammate에게 SendMessage로 알린다.

## 핵심: TaskList = 상태 머신

- 각 Task는 state
- blockedBy는 transition condition  
- owner는 해당 state의 executor
- Task 완료 → 다음 Task unblock → 자동 전환
- 모든 Task 완료 = iteration 완료
- 7/7 PASS 아니면 → 새 iteration tasks 생성 (Task 10~18)

## 종료 조건
- 7/7 playwright PASS → 팀 shutdown
- 10 iteration 도달 → 최선 결과로 종료

## 회귀 Guard
이전 iteration PASS → 현재 FAIL인 테스트 발견 시:
- git revert + regression 라벨 Issue 생성
- 해당 iteration의 hook 변경 롤백
