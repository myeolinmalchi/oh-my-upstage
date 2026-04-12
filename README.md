# Oh My Upstage

<img width="2598" height="1176" alt="image" src="https://github.com/user-attachments/assets/088d795c-7305-433a-9e23-b57771d02a88" />


**Solar Pro 3를 위한 OpenCode 하네스 플러그인**

Solar Pro 3에 "레시피 북 앱을 만들어줘"라고 시키면, 플러그인 없이는 빌드가 안 됩니다. 파일을 작성하지는 않고 폴더 탐색만 무한히 하거나, 컴포넌트 파일을 만들고 import를 안 하거나, 빌드를 무시합니다. OMU와 함께라면 동일한 프롬프트에서 빌드되고 동작하는 앱이 나옵니다.

| 앱 | Baseline | OMU |
|----|----------|-----|
| 습관 트래커 | 빌드 실패 | 추가, 토글, 스트릭, 새로고침 유지까지 동작. 삭제만 미연결. |
| 레시피 북 | 구현 불완전 | CRUD 전체 동작. 카드 목록, 상세 보기 포함. |
| 운동 기록 | 구현 불완전 | 서버 연동 실패했으나 풀스택 코드 구현. |

## 시작하기

```bash
git clone git@github.com:myeolinmalchi/oh-my-upstage.git
cd oh-my-upstage && npm install && npm run build
```

`.opencode/opencode.json`에 추가:

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
export UPSTAGE_API_KEY=your_key
opencode
```

## Solar의 실패 패턴과 OMU의 개입

### 같은 파일을 18번 고친다

edit 도구로 `App.jsx`를 반복 수정하는데, 매번 `oldString`을 틀립니다. 파일 상태를 추적하지 못하기 때문입니다.

```
Solar: edit("App.jsx", oldString="...", newString="...")  → 실패
Solar: edit("App.jsx", oldString="...", newString="...")  → 실패
OMU:   "Edit failed 2 times. STOP using edit. Use write to rewrite the entire file."
```

없으면: 같은 edit를 18회 반복하다 세션 토큰 소진.

### `.jsx`를 `.tsx`로 쓴다

Solar는 `.jsx` 프로젝트에서도 TypeScript 문법을 섞어 씁니다.

```
Solar: write("src/hooks/useStreak.tsx", "const getItem = (): Habit[] => { ... }")
OMU:   파일명 .tsx → .jsx 리다이렉트, ": Habit[]" 타입 어노테이션 제거
결과:  useStreak.jsx에 유효한 JS가 쓰여짐
```

없으면: Vite가 `.tsx`를 못 읽거나, JS 파일에 TS 문법이 섞여서 빌드 실패.


### 프로젝트 빌드를 생략한다

파일을 다 쓰고도 `npm run build`를 실행하지 않고 세션을 끝냅니다.

```
Solar: write("src/components/RecipeCard.jsx", code)
OMU:   "All planned files written. Run npm run build now."
       → 반응 없으면 자동으로 빌드 실행, 에러를 Solar에게 피드백
```

없으면: 파일은 있지만 빌드 에러를 아무도 안 잡음.

### 엉뚱한 곳에서 프로젝트를 빌드한다

fullstack 앱에서 `npm run build`를 프로젝트 루트에서 실행합니다. 클라이언트 빌드(`vite build`)가 아니라 플러그인 빌드(`tsc`)가 돌아갑니다.

```
Solar: bash("npm run build")
결과:  "> tsc" (플러그인 빌드가 실행됨)
OMU:   client/ 디렉토리 감지 → cd client && npm run build 자동 실행
```

없으면: Solar는 빌드가 성공한 줄 알고 넘어감. 실제 프론트엔드는 빌드 안 됨.

### 컴포넌트를 만들고 `import`를 생략한다

`RecipeCard.jsx`, `RecipeList.jsx`를 만들지만 `App.jsx`에서 import하지 않습니다.

```
Solar: write("src/components/RecipeCard.jsx", code)
OMU:   App.jsx에 RecipeCard가 import 안 된 것 감지 → import + JSX 렌더링 자동 추가
```

없으면: 컴포넌트 파일은 있지만 화면에 안 나옴.

## References

- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
- [OpenCode Plugin API](https://opencode.ai)
- [Upstage Solar Pro 3](https://developers.upstage.ai)
