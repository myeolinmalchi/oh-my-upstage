# Oh My Upstage

Solar Pro 3용 [OpenCode](https://opencode.ai) 하네스 플러그인.

## What is OMU?


Solar Pro 3(102B MoE)는 저렴하지만 코딩 에이전트로 다루기에는 까다롭습니다.  
OMU는 OpenCode의 플러그인으로, Solar Pro 3의 도구 호출과 코드 작성 패턴을 교정합니다.

[oh-my-claudecode](https://github.com/anthropics/claude-code)와 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)에서 영감을 받았으며,   
강한 모델을 위한 오케스트레이션이 아니라, **약한 모델을 쓸 만하게 만드는 것**이 목표로 합니다.


## 설치

```bash
# 1. 클론
git clone git@github.com:myeolinmalchi/oh-my-upstage.git
cd oh-my-upstage

# 2. 의존성 설치 + 빌드
npm install
npm run build

# 3. OpenCode 글로벌 설정에 플러그인 등록
# ~/.config/opencode/opencode.json 또는 프로젝트의 .opencode/opencode.json에 추가:
```

```json
{
  "plugin": ["file:///절대경로/oh-my-upstage/dist/index.js"],
  "provider": {
    "upstage": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.upstage.ai/v1"
      },
      "models": {
        "solar-pro3": {
          "name": "solar-pro3"
        }
      }
    }
  },
  "model": "upstage/solar-pro3"
}
```

```bash
# 4. API 키 설정
export UPSTAGE_API_KEY=your_key_here
export OPENAI_API_KEY=$UPSTAGE_API_KEY

# 5. 실행
opencode
```

## Hooks

| 훅 | 위치 | 하는 일 |
|----|------|---------|
| Argument Validator | `tool.execute.before` | 누락된 필수 인자에 기본값 주입. `bash.description`, `read.offset` 등 |
| Loop Detection | `tool.execute.after` | 같은 파일 3회+ 편집, 같은 호출 3회+ 반복 시 경고 |
| Retry Escape | `tool.execute.after` | 같은 도구 호출이 2회+ 연속 실패하면 전략 전환 강제 |
| Context Injection | `chat.system.transform` | Solar Pro 3 전용 규칙 주입 — 탈선 방지, 도구 사용법, 코드 품질 체크리스트 |
| File Integrity Guard | `tool.execute.before` | Write 시 기존 파일보다 50%+ 작아지면 경고 |
| ID Pattern Detection | `tool.execute.after` | `len(list)+1` ID 패턴 감지 → `max()+1` 사용 유도 |
| Exploration Blocker | `tool.execute.after` | Write 없이 Read/Glob 5회+ 시 "탐색 중단, 파일 작성 시작" 강제 |
| Test Nudge | `tool.execute.after` | 코드 작성 후 테스트 미실행 시 실행 촉구 |

## 요구사항

- [OpenCode](https://opencode.ai) v1.2+
- Node.js v20+
- [Upstage API 키](https://console.upstage.ai)

## 라이센스

MIT
