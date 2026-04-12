#!/bin/bash
# OMU Iteration State Machine — PostToolUse:Bash hook
# 각 단계의 완료를 감지하고 다음 단계를 강제 트리거한다.
# State: .omc/state/iteration-state.json

INPUT=$(cat /dev/stdin 2>/dev/null || echo "{}")
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
STATE_FILE="$ROOT/.omc/state/iteration-state.json"
mkdir -p "$ROOT/.omc/state" "$ROOT/.omc/logs"

# --- State read/write ---
read_state() {
  [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo '{"iteration":0,"phase":"IDLE","best_pass":0}'
}
write_state() { echo "$1" > "$STATE_FILE"; }
get() { echo "$1" | jq -r ".$2 // \"$3\""; }

STATE=$(read_state)
PHASE=$(get "$STATE" phase IDLE)
ITER=$(get "$STATE" iteration 0)

# ============================================================
# 1. opencode run 완료 → ANALYZE 강제
# ============================================================
if echo "$COMMAND" | grep -q "opencode run" 2>/dev/null; then
  LOG=$(echo "$COMMAND" | sed -n 's/.*tee \([^ ]*\).*/\1/p')
  [ -z "$LOG" ] && exit 0

  ITER=$((ITER + 1))
  STATE=$(echo "$STATE" | jq --argjson i "$ITER" --arg p "ANALYZE" --arg l "$LOG" '.iteration=$i | .phase=$p | .log=$l')
  write_state "$STATE"

  LINES=$(wc -l < "$ROOT/$LOG" 2>/dev/null | tr -d ' ')
  WRITES=$(grep -c "Wrote file successfully" "$ROOT/$LOG" 2>/dev/null || echo 0)
  HOOKS=$(grep -c "\[OMU\]" "$ROOT/$LOG" 2>/dev/null || echo 0)

  echo ""
  echo "[OMU-ITER:$ITER|ANALYZE] opencode 완료 (${LINES}줄, ${WRITES}writes, ${HOOKS}hooks)"
  echo "[FORCE] 서브에이전트(oh-my-claudecode:analyst)를 spawn하여 $LOG 전체를 분석하라."
  echo "  분석 항목: 플래닝 여부, 훅 발동, 파일 생성 순서, prop 일관성, 빌드 결과, write 루프."
  echo "  분석 완료 후 결과를 텍스트로 출력하라. 그 다음 gh issue create로 발견된 패턴마다 이슈를 생성하라."
  exit 0
fi

# ============================================================
# 2. gh issue create 완료 → FIX 강제
# ============================================================
if [ "$PHASE" = "ANALYZE" ] && echo "$COMMAND" | grep -q "gh issue" 2>/dev/null; then
  STATE=$(echo "$STATE" | jq '.phase="FIX"')
  write_state "$STATE"
  echo ""
  echo "[OMU-ITER:$ITER|FIX] 이슈 생성 완료."
  echo "[FORCE] 분석된 실패 패턴에 대한 훅을 수정하라 (src/hooks/*.ts, src/index.ts)."
  echo "  수정 후 플러그인 빌드: cd $ROOT && npm run build"
  exit 0
fi

# ============================================================
# 3. 플러그인 빌드 (tsc) 완료 → RERUN 강제
# ============================================================
if [ "$PHASE" = "FIX" ] && echo "$COMMAND" | grep -q "npm run build" 2>/dev/null; then
  STATE=$(echo "$STATE" | jq '.phase="RERUN"')
  write_state "$STATE"
  echo ""
  echo "[OMU-ITER:$ITER|RERUN] 플러그인 빌드 완료."
  echo "[FORCE] app-kanban 클린 후 opencode를 재실행하라:"
  echo "  cd $ROOT/app-kanban"
  echo "  find . -maxdepth 1 ! -name . ! -name .opencode ! -name .env ! -name node_modules -exec rm -rf {} +"
  echo "  cp -r /tmp/vite-scaffold/* . 2>/dev/null; npm install"
  echo "  UPSTAGE_API_KEY=\$UPSTAGE_API_KEY opencode run --agent solar \"\$(cat ../prompts/habit.md)\" 2>&1 | tee ../.omc/logs/trajectory-habit-$((ITER+1)).log"
  exit 0
fi

# ============================================================
# 4. 앱 빌드 (vite) 성공 → TEST 강제
# ============================================================
if [ "$PHASE" = "RERUN" ] && echo "$COMMAND" | grep -q "npm run build" 2>/dev/null; then
  STATE=$(echo "$STATE" | jq '.phase="TEST"')
  write_state "$STATE"
  echo ""
  echo "[OMU-ITER:$ITER|TEST] 앱 빌드 완료."
  echo "[FORCE] 서브에이전트(oh-my-claudecode:qa-tester)를 spawn하여 playwright로 직접 앱을 테스트하라."
  echo "  포트 5190에서 npx vite preview --port 5190을 시작하고, playwright chromium으로:"
  echo "  1) localhost:5190 접속하여 추가 폼이 보이는지 확인"
  echo "  2) 습관 이름 입력 후 추가 버튼 클릭 → 화면에 표시되는지"
  echo "  3) 두 번째 습관 추가"
  echo "  4) 체크박스/토글 버튼 클릭 → 완료 상태 변경되는지"
  echo "  5) 스트릭 숫자 표시되는지"
  echo "  6) 삭제 버튼(✕) 클릭 → 제거되는지"
  echo "  7) 페이지 새로고침 → 데이터 유지되는지"
  echo "  test_habit.mjs 스크립트를 실행하지 말고 에이전트가 직접 확인하라."
  exit 0
fi

# ============================================================
# 5. 테스트 완료 → PR 강제
# ============================================================
if [ "$PHASE" = "TEST" ]; then
  # 테스트 결과와 관계없이 다음 bash 호출에서 PR 단계로 이동
  STATE=$(echo "$STATE" | jq '.phase="PR"')
  write_state "$STATE"
  echo ""
  echo "[OMU-ITER:$ITER|PR] 테스트 완료."
  echo "[FORCE] GitHub PR 워크플로우를 실행하라:"
  echo "  1) git checkout -b iteration/$ITER"
  echo "  2) git add src/hooks/*.ts src/index.ts agents/solar.md"
  echo "  3) git commit — body에 trajectory 분석 요약 + 테스트 결과 포함"
  echo "  4) git push -u origin iteration/$ITER"
  echo "  5) gh pr create — body에 분석 결과, 수정 내용, 테스트 결과 포함"
  echo "  6) 서브에이전트(oh-my-claudecode:code-reviewer)로 PR 리뷰"
  echo "  7) approve면 gh pr merge --merge --delete-branch"
  echo "  8) git checkout main && git pull"
  exit 0
fi

# ============================================================
# 6. PR merge 완료 → NEXT 또는 DONE
# ============================================================
if [ "$PHASE" = "PR" ] && echo "$COMMAND" | grep -q "gh pr merge\|git checkout main" 2>/dev/null; then
  if [ "$ITER" -ge 10 ]; then
    STATE=$(echo "$STATE" | jq '.phase="DONE"')
    write_state "$STATE"
    echo "[OMU-ITER:$ITER] 최대 iteration 도달. 종료."
    exit 0
  fi
  STATE=$(echo "$STATE" | jq '.phase="IDLE"')
  write_state "$STATE"
  echo ""
  echo "[OMU-ITER:$ITER|NEXT] PR 병합 완료. 7/7 PASS가 아니면 다음 iteration을 시작하라."
  exit 0
fi

exit 0
