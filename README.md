# OMU — Oh My Upstage

Solar Pro 3의 코딩 에이전트 성능을 하네스로 개선하는 OpenCode 플러그인.

## 배경

Solar Pro 3(102B MoE, 12B active)는 저렴하지만 프론티어 모델 대비 코딩 성능이 부족합니다 (SWE-Bench 28.6% vs 70-80%). OMU는 규칙 기반 하네스(hooks)로 Solar Pro 3가 "엇나가지 않도록" 제어하여, 실용적인 CLI 코딩 에이전트로 활용할 수 있게 합니다.

## 접근 방식

**관찰 우선 반복 사이클:**

```
순정 실행 → 실패 패턴 관찰 → 하네스 규칙 추가 → 정량 평가 → 반복
```

1. Solar Pro 3를 순정 OpenCode로 실행하여 실패 패턴을 수집
2. 관찰된 패턴에 맞는 hook/rule을 설계
3. 하네스 적용 후 동일 태스크에서 before/after 비교

## 식별된 실패 패턴과 대응 훅

| 실패 패턴 | 설명 | 대응 훅 |
|-----------|------|---------|
| 도구 인자 누락 | bash description, write filePath 등 required 필드 누락 | Argument Validator |
| 무한 루프 | 동일 파일 반복 편집, 같은 도구 연속 호출 | Loop Detection |
| Edit 반복 실패 | oldString 매칭 실패 후 동일 시도 반복 | Retry Escape |
| 구조적 탈선 | 지시와 무관한 Google 검색, git, pip 등 | Context Injection |
| 파일 내용 파괴 | Write로 기존 코드 삭제 | File Integrity Guard |

## 플러그인 구조

```
omu/
├── src/index.ts          # 플러그인 엔트리 + 5개 훅
├── dist/index.js          # 컴파일된 플러그인
├── .opencode/
│   └── opencode.json      # Solar Pro 3 provider + 플러그인 설정
├── evaluation/
│   ├── tasks.json         # 5개 평가 태스크 정의
│   ├── fixtures/          # 태스크별 테스트 파일
│   ├── run.sh             # 자동 평가 스크립트 (baseline vs harness)
│   └── results/           # 실행 결과
└── .omu/reports/          # 분석 리포트
```

## 설치 및 사용

### 사전 요구사항
- [OpenCode](https://opencode.ai) v1.2+
- Node.js v20+
- Upstage API 키

### 설치

```bash
git clone https://github.com/your-repo/omu.git
cd omu

# API 키 설정
echo "UPSTAGE_API_KEY=your_key_here" > .env

# 플러그인 빌드
npm install
npm run build

# OpenCode 설정 — .opencode/opencode.json에 플러그인 등록
# (이미 설정되어 있음)
```

### 실행

```bash
# 하네스 적용된 상태로 OpenCode 실행
source .env
OPENAI_API_KEY=$UPSTAGE_API_KEY opencode

# 평가 실행 (baseline vs harness 비교)
./evaluation/run.sh both
```

## 하네스 훅 상세

### 1. Argument Validator (`tool.execute.before`)
Solar Pro 3가 자주 누락하는 필수 인자에 기본값을 주입합니다.
- `bash.description` → `"Execute command"`
- `read.offset` < 1 → 1로 보정

### 2. Loop Detection (`tool.execute.after`)
동일 파일 반복 편집(3회+)이나 같은 도구 연속 호출(3회+)을 감지하여 경고합니다.

### 3. Retry Escape (`tool.execute.after`)
동일 도구 호출이 연속 실패(2회+)하면 "다른 접근 방식을 시도하세요" 메시지를 주입합니다.

### 4. Context Injection (`experimental.chat.system.transform`)
Solar Pro 3 전용 시스템 프롬프트 규칙을 주입합니다:
- 주어진 태스크에만 집중 (탈선 방지)
- 기존 코드 보존 (Edit 사용 권장)
- 도구 사용 효율성 규칙

### 5. File Integrity Guard (`tool.execute.before`)
Write 시 기존 파일 대비 50% 이상 크기가 줄어들면 경고합니다.

## 평가 결과

5개 코딩 태스크 (Easy 1, Medium 2, Hard 2)에서 Baseline vs Harness 비교:

| Metric | Baseline | Harness | Change |
|--------|----------|---------|--------|
| Pass rate | 3/5 | 3/5 | 동일 (다른 태스크 성공) |
| Total errors | 65 | 31 | **-52%** |
| Avg time | 52s | 32s | **-38%** |

**핵심 발견**: 하네스는 성공률보다 **효율성**에 더 큰 영향을 줍니다. 에러 52% 감소, 속도 38% 향상. 특히 Context Injection(시스템 프롬프트 규칙 주입)이 가장 큰 효과를 보였습니다.

자세한 결과: [evaluation/report.md](evaluation/report.md)

## 레퍼런스

- [OpenCode](https://opencode.ai) — CLI 코딩 에이전트 프레임워크
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — OpenCode 하네스 참조 구현
- [Upstage Solar Pro 3](https://www.upstage.ai) — 102B MoE 모델

## 라이센스

MIT
