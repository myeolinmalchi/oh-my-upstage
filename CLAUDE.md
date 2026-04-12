# OMU Project Rules

## Iteration Protocol (MANDATORY)

OpenCode + Solar Pro 3 iteration 실행 후 반드시 다음을 수행할 것:

1. **Trajectory 분석**: opencode 실행 완료 즉시, 서브에이전트(oh-my-claudecode:analyst 또는 oh-my-claudecode:critic)에게 trajectory 로그 전체를 넘겨서 분석시킬 것. 직접 tail이나 grep으로 대충 보지 말 것.
2. **분석 체크리스트**:
   - Planning: Solar가 계획을 출력했는가? 파일 순서가 올바른가?
   - 훅 작동: 어떤 훅이 발동했는가? 오작동하는 훅이 있는가? (루프 유발, 잘못된 타이밍 등)
   - 파일 생성: 몇 개 파일이 생성되었는가? 컴포넌트 분리가 되었는가?
   - Prop 일관성: App.jsx에서 전달하는 prop 이름과 컴포넌트가 받는 prop 이름이 일치하는가?
   - 빌드: npm run build가 실행되었는가? 성공했는가?
   - 반복 패턴: 같은 파일을 3회 이상 반복 작성하는 루프가 있는가?
3. **Cleanup**: 앱 디렉토리 초기화 시 .opencode와 .env만 남기고 전부 삭제한 뒤 `npm create vite . -- --template react`로 초기화할 것.

## 금지사항
- Solar Pro 3가 생성한 코드를 직접 수정하지 말 것. 하네스(훅/프롬프트)만 수정.
- trajectory를 tail로만 보지 말 것. 전체를 분석할 것.
- 커밋하지 말 것 (명시적 지시 없는 한).
