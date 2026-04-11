# Oh My Upstage (OMU)

Solar Pro 3용 [OpenCode](https://opencode.ai) 하네스 플러그인.

## 개요

Solar Pro 3(102B MoE, 12B active)는 SWE-Bench 28.6%의 중간 규모 모델입니다.  
OMU는 OpenCode 플러그인 API의 `tool.execute.before`/`after` 훅으로 Solar Pro 3의 도구 호출과 코드 작성을 교정합니다.

[oh-my-claudecode](https://github.com/anthropics/claude-code)와 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)에서 영감을 받았습니다.  
프론티어 모델용 오케스트레이션이 아닌, **약한 모델을 실용 수준으로 끌어올리는 하네스**입니다.

## 설치

```bash
git clone git@github.com:myeolinmalchi/oh-my-upstage.git
cd oh-my-upstage
npm install && npm run build
```

프로젝트의 `.opencode/opencode.json`에 등록:

```json
{
  "plugin": ["file:///절대경로/oh-my-upstage/dist/index.js"],
  "provider": {
    "upstage": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.upstage.ai/v1" },
      "models": { "solar-pro3": { "name": "solar-pro3" } }
    }
  },
  "model": "upstage/solar-pro3"
}
```

```bash
export UPSTAGE_API_KEY=your_key_here
opencode
```

## 훅

### Pre-execution (`tool.execute.before`)

| 훅 | 하는 일 |
|----|---------|
| 도구 차단 | task, question, webfetch, websearch, todowrite, skill 호출을 차단하고 write 유도 |
| 인자 보정 | `bash.description` 누락 시 기본값 주입, `read.offset` 음수 보정 |
| 스캐폴드 보호 | main.jsx, index.html, vite.config.js 덮어쓰기 차단 |
| 빈 편집 차단 | oldString === newString인 무의미한 편집 차단 |
| 디렉토리 자동 생성 | write 대상의 부모 디렉토리가 없으면 자동 생성 |
| CSS 자동 생성 | JSX에서 import한 `.css` 파일이 없으면 빈 파일 생성 |

### Post-execution (`tool.execute.after`)

| 훅 | 하는 일 |
|----|---------|
| 진행 추적 | 프롬프트에서 파일 목록 추출, write마다 완료 체크 후 "Remaining: X" 안내 |
| 탐색 차단 | write 없이 3회 연속 read/glob 시 "Write now" 강제 |
| 편집 루프 탐지 | 같은 파일 5회 이상 편집 시 전체 rewrite 유도 |
| 실패 연속 탐지 | 같은 도구 호출 3회 연속 실패 시 "다른 접근" 유도 |
| Import 자동 주입 | JSX에서 `<Component>` 참조 시 누락된 import를 디스크 스캔으로 자동 추가 |
| 빌드 검증 | 모든 파일 완료 후 `npm run build` 실행, 에러를 모델에 피드백 |
| 패키지 자동 설치 | 빌드 실패 시 미설치 npm 패키지 자동 설치 후 재빌드 |
| 서버 스모크 테스트 | server.js/server.py 작성 후 서버 기동 → POST/GET 엔드포인트 자동 검증 |
| 빌드 실패 재시도 | bash에서 `npm run build` 실패 감지 시 수정 후 재실행 강제 |

### System (`chat.system.transform`, `chat.params`)

| 훅 | 하는 일 |
|----|---------|
| 시스템 프롬프트 | 즉시 코드 작성, 에러 발생 시 즉시 수정 등 행동 규칙 주입 |
| reasoning_effort | `high`로 강제 설정 |

## 구조

```
src/
  index.ts              # 플러그인 진입점, 훅 배선
  hooks/
    validator.ts         # pre-execution: 차단, 보정, 보호
    coordinator.ts       # 세션 상태: 파일 추적, 탐색 차단, 실패 탐지
    verifier.ts          # post-execution: 빌드, 린트, import 수정, 스모크 테스트
```

## 요구사항

- [OpenCode](https://opencode.ai) v0.1+
- Node.js v20+
- [Upstage API 키](https://console.upstage.ai)

## 라이센스

MIT
