# OMU Iteration — 3-App Parallel Entry Point

이 커맨드를 실행하면 `/team`으로 에이전트 팀을 생성하고, 3개 앱을 병렬 실행 → 통합 분석 → 훅 수정 → 재실행 → 테스트 루프를 강제합니다.

## 앱 매핑 (고정)

| App Dir | Prompt | Type | Preview Port |
|---------|--------|------|-------------|
| app-kanban | prompts/habit.md | Frontend-only (localStorage) | 5190 |
| app-budget | prompts/recipe.md | Fullstack (Express + JSON) | 5191 |
| app-memo | prompts/workout.md | Fullstack (FastAPI + SQLite) | 5192 |

## 실행 순서

### 1. Team 생성
```
TeamCreate({ team_name: "omu-iter", description: "OMU 3-app parallel iteration" })
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
     - 3 logs per iteration: trajectory-habit-N.log, trajectory-recipe-N.log, trajectory-workout-N.log
  2. Cross-reference patterns across all 3 apps to find GENERIC failure patterns
  3. Fix harness hooks (src/hooks/*.ts, src/index.ts) — GENERIC fixes only, no monkey-patches
  4. Rebuild plugin: cd /Users/mason/workspace/upstage-ambassador/omu && npm run build
  
  Rules:
  - NEVER modify Solar Pro 3's generated code
  - ONLY modify harness hooks/prompts
  - All hook fixes must be generic (work for ANY app type: frontend-only AND fullstack)
  - Include trajectory log line numbers in your reports
  - Compare patterns across all 3 logs — a fix is only valid if it helps all 3 or at least doesn't break any
  
  Check TaskList for your assignments. Mark tasks completed when done."
})

Agent({
  name: "qa",
  subagent_type: "oh-my-claudecode:qa-tester",
  team_name: "omu-iter",
  model: "sonnet",
  prompt: "You are QA in the OMU iteration team. Your job:
  1. Test all 3 apps with playwright — start preview servers, navigate, interact with UI directly
  2. Review PRs for code quality and regression risk
  
  Testing protocol (run ALL 3 in sequence):
  
  === App 1: Habit Tracker (app-kanban, port 5190) ===
  - cd /Users/mason/workspace/upstage-ambassador/omu/app-kanban && npm run build && npx vite preview --port 5190 &
  - Tests: 습관 추가, 삭제(✕), 토글(완료/미완료), 스트릭 표시, 새로고침 후 데이터 유지
  - 7 criteria: RENDER, ADD, ADD2, TOGGLE, STREAK, DELETE, PERSIST
  
  === App 2: Recipe Book (app-budget, port 5191) ===
  - cd /Users/mason/workspace/upstage-ambassador/omu/app-budget
  - Start backend: node server.js & (port 3001)
  - Build frontend: cd client && npm run build && npx vite preview --port 5191 &
  - Tests: 레시피 추가(제목+재료+조리법), 목록 카드 표시, 상세 보기, 수정, 삭제
  - 5 criteria: ADD, LIST, DETAIL, EDIT, DELETE
  
  === App 3: Workout Logger (app-memo, port 5192) ===
  - cd /Users/mason/workspace/upstage-ambassador/omu/app-memo
  - Start backend: cd .. && python3 server.py & (port 8000)
  - Build frontend: cd client && npm run build && npx vite preview --port 5192 &
  - Tests: 운동 기록 추가(이름+세트+반복+무게+날짜), 날짜별 목록, 볼륨 계산, 수정, 삭제
  - 5 criteria: ADD, LIST, VOLUME, EDIT, DELETE
  
  Report format:
  habit:   [N/7] RENDER=P ADD=P ADD2=P TOGGLE=P STREAK=P DELETE=P PERSIST=P
  recipe:  [N/5] ADD=P LIST=P DETAIL=P EDIT=P DELETE=P
  workout: [N/5] ADD=P LIST=P VOLUME=P EDIT=P DELETE=P
  TOTAL: [N/17]
  
  Do NOT run test_*.mjs files — test manually with playwright.
  
  For PR review:
  - Check regex hooks for false positives
  - Check for regressions across all 3 app types
  - APPROVE or REQUEST CHANGES
  
  Check TaskList for your assignments. Mark tasks completed when done."
})
```

### 3. Iteration Tasks 생성 (3-app 병렬 + 의존성 체인)

```
=== Phase 1: Parallel Run (3 tasks, no dependencies between them) ===

Task 1a: "Run opencode: habit tracker (app-kanban)"
  owner: coordinator (me)
  description: |
    cd /Users/mason/workspace/upstage-ambassador/omu/app-kanban
    # Clean: keep only .opencode, .env, node_modules
    find . -maxdepth 1 ! -name . ! -name .opencode ! -name .env ! -name .gitignore ! -name node_modules -exec rm -rf {} +
    npm create vite . -- --template react --yes && npm install
    opencode run --agent solar "$(cat ../prompts/habit.md)" 2>&1 | tee ../.omc/logs/trajectory-habit-N.log

Task 1b: "Run opencode: recipe book (app-budget)"
  owner: coordinator (me)
  description: |
    cd /Users/mason/workspace/upstage-ambassador/omu/app-budget
    find . -maxdepth 1 ! -name . ! -name .opencode ! -name .env ! -name .gitignore ! -name node_modules -exec rm -rf {} +
    npm create vite . -- --template react --yes && npm install
    mkdir -p client && cp -r src client/ && cp package.json client/ && cp vite.config.js client/ && cd client && npm install
    opencode run --agent solar "$(cat ../prompts/recipe.md)" 2>&1 | tee ../.omc/logs/trajectory-recipe-N.log

Task 1c: "Run opencode: workout logger (app-memo)"
  owner: coordinator (me)
  description: |
    cd /Users/mason/workspace/upstage-ambassador/omu/app-memo
    find . -maxdepth 1 ! -name . ! -name .opencode ! -name .env ! -name .gitignore ! -name node_modules -exec rm -rf {} +
    npm create vite . -- --template react --yes && npm install
    mkdir -p client && cp -r src client/ && cp package.json client/ && cp vite.config.js client/ && cd client && npm install
    opencode run --agent solar "$(cat ../prompts/workout.md)" 2>&1 | tee ../.omc/logs/trajectory-workout-N.log

=== Phase 2: Analyze (blocked by ALL of Phase 1) ===

Task 2: "Cross-analyze 3 trajectories + report patterns"
  owner: engineer
  blockedBy: [1a, 1b, 1c]
  description: |
    Read ALL 3 trajectory logs in full:
    - .omc/logs/trajectory-habit-N.log
    - .omc/logs/trajectory-recipe-N.log
    - .omc/logs/trajectory-workout-N.log
    
    Report format:
    ## Per-App Summary
    [For each app: files created, build result, hook activations, errors]
    
    ## Cross-App Patterns
    [Patterns that appear in 2+ apps — these are the GENERIC issues worth fixing]
    
    ## App-Specific Issues
    [Issues unique to one app — do NOT fix these in hooks, note for reference only]
    
    ## Recommended Hook Changes
    [Ordered by impact. Each must include: pattern name, affected apps, log line evidence, proposed fix]

Task 3: "Create GitHub Issues with log evidence"
  owner: coordinator
  blockedBy: [2]
  description: Based on engineer's report, gh issue create for each new CROSS-APP pattern. Include log line evidence from all affected apps.

=== Phase 3: Fix + Rebuild ===

Task 4: "Fix harness hooks (generic only)"
  owner: engineer
  blockedBy: [3]
  description: |
    Fix hooks in src/hooks/*.ts based on cross-app analysis.
    - ONLY fix patterns that appear in 2+ apps
    - Test that fixes don't break other app types (e.g., fullstack fix must not break frontend-only)
    - Rebuild plugin: npm run build

=== Phase 4: Parallel Re-run (3 tasks) ===

Task 5a: "Re-run opencode: habit tracker"
  owner: coordinator
  blockedBy: [4]
  description: Clean app-kanban, re-run opencode with updated plugin.

Task 5b: "Re-run opencode: recipe book"
  owner: coordinator
  blockedBy: [4]
  description: Clean app-budget, re-run opencode with updated plugin.

Task 5c: "Re-run opencode: workout logger"
  owner: coordinator
  blockedBy: [4]
  description: Clean app-memo, re-run opencode with updated plugin.

=== Phase 5: Test ===

Task 6: "Test all 3 apps with playwright"
  owner: qa
  blockedBy: [5a, 5b, 5c]
  description: Build and test all 3 apps. Report scores per app and total.

=== Phase 6: PR ===

Task 7: "Create PR with cross-app analysis"
  owner: coordinator
  blockedBy: [6]
  description: |
    git checkout -b iteration/N
    Commit hook changes with cross-app analysis summary
    gh pr create with:
    - Per-app scores (habit N/7, recipe N/5, workout N/5)
    - Total score (N/17)
    - Patterns fixed
    - Before/after comparison

Task 8: "Review PR"
  owner: qa
  blockedBy: [7]
  description: Review the PR. APPROVE or REQUEST CHANGES.

Task 9: "Merge + decide next"
  owner: coordinator
  blockedBy: [8]
  description: |
    If approved, gh pr merge.
    If TOTAL >= 14/17 → done.
    Else create next iteration tasks (Phase 1-6 again).
```

### 4. Coordinator가 Phase 1을 병렬 실행

Task 1a, 1b, 1c를 동시에 시작한다. 각각 별도 터미널에서 opencode를 실행하고, 모두 완료되면 engineer에게 Task 2를 알린다.

**중요**: 3개 opencode 실행은 반드시 병렬로. 순차 실행 금지.

```
# 병렬 실행 예시 (coordinator가 직접)
Bash({ command: "cd app-kanban && opencode run ...", run_in_background: true })
Bash({ command: "cd app-budget && opencode run ...", run_in_background: true })
Bash({ command: "cd app-memo && opencode run ...", run_in_background: true })
```

## 핵심: TaskList = 상태 머신

- 각 Task는 state
- blockedBy는 transition condition
- owner는 해당 state의 executor
- Task 완료 → 다음 Task unblock → 자동 전환
- Phase 1과 Phase 4는 병렬 (1a/1b/1c, 5a/5b/5c)
- Phase 2는 3개 모두 완료 후 시작

## 종료 조건
- TOTAL >= 14/17 → 팀 shutdown
- 5 iteration 도달 → 최선 결과로 종료

## 회귀 Guard
이전 iteration에서 PASS → 현재 FAIL인 테스트 발견 시:
- git revert + regression 라벨 Issue 생성
- 해당 iteration의 hook 변경 롤백

## 스코어 기준

### habit (7점)
1. RENDER — 앱이 렌더링되고 추가 폼이 보임
2. ADD — 습관 추가 가능
3. ADD2 — 두 번째 습관 추가 가능
4. TOGGLE — 완료/미완료 토글
5. STREAK — 스트릭(연속 달성) 표시
6. DELETE — 습관 삭제
7. PERSIST — 새로고침 후 데이터 유지

### recipe (5점)
1. ADD — 레시피 추가 (제목+재료+조리법)
2. LIST — 카드 형태 목록 표시
3. DETAIL — 클릭 시 상세 보기
4. EDIT — 레시피 수정
5. DELETE — 레시피 삭제

### workout (5점)
1. ADD — 운동 기록 추가 (이름+세트+반복+무게+날짜)
2. LIST — 날짜별 목록 표시
3. VOLUME — 볼륨(세트×반복×무게) 계산 표시
4. EDIT — 기록 수정
5. DELETE — 기록 삭제
