# ALLI SDK — 사내 ERP 개발자용 Alli API 플레이그라운드

Allganize **Alli** 앱을 ERP 화면·RPA·업무 자동화 스크립트에서 호출하기 위한 테스트 도구.
웹앱에서 API를 직접 테스트하고, 검증된 설정을 **그대로 실행 가능한 코드 4종(curl / 브라우저 JS / Node.js / Python)** 으로 생성한다.

- 사용에는 이 README만으로 충분하다. 아래는 개발·유지보수용 내부 문서: 스펙 [SSOT.md](./SSOT.md) (시나리오 6개 × 엔드포인트 13개), 용어 [GLOSSARY.md](./GLOSSARY.md), 디자인 [DESIGN.md](./DESIGN.md)
- 스택: Vanilla TypeScript + Vite 정적 SPA (프레임워크 없음), 브라우저 → `backend.alli.ai` 직접 호출 (프록시 없음)

## 시작하기

요구사항: **Node.js 20+**

```bash
npm install
npm run dev          # 실 API 모드 (CORS 허용 + 유효한 API 키 필요)
npm run dev:mock     # 목 모드 — 자격증명 없이 6개 Flow 전체 데모
```

| 스크립트 | 설명 |
|---|---|
| `npm run dev:mock` | 목 fetch 주입 — 13개 엔드포인트 시뮬레이션 (상단 바에 "목 모드" 배지) |
| `npm test` | Vitest 단위 테스트 (코어/목/코드젠) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | 타입체크 + 정적 빌드 (`dist/` — `base:'./'` 상대 경로라 아무 정적 서버/파일 공유로 배포 가능) |

## 화면 (초기 설정 + Flow 6개)

| 라우트 | Flow | 설명 |
|---|---|---|
| `#/setup` | 0 | 초기 설정 가이드(기본 진입) — 백엔드 환경변수 `ALLI_API_KEY` 사전 설정. 생성 코드 전체의 전제 |
| `#/connect` | 1 | Base URL(US 리전 고정) + API 키 검증(`GET /v2/projects`), OWN-USER-ID 설정 |
| `#/apps` | 2 | 앱 목록/상세 — 검색·유형(답변형/대화형)·게시 필터, 커서 페이징, 앱 ID 복사 |
| `#/run` | 2 | 앱 실행 — 변수 정의/검증(로컬), sync/stream, DraftJS 폴백 |
| `#/multipart` | 3 | 파일 첨부(run_conversation) — multipart 미리보기, 스트리밍 |
| `#/answer` | 4 | 답변 생성(Generative Answer) — 모델/그룹 프롬프트/해시태그/출처, threadId 멀티턴 |
| `#/replace` | 5 | 문서 교체 — 업로드 → 인제스천 폴링 → 삭제/롤백 (상태 머신) |
| `#/conversation` | 6 | 대화형 앱 멀티턴 — 텍스트/선택지/폼/파일 입력, 서버 이력 조회 |

모든 화면 공통: **Raw 요청/응답 뷰**(키 마스킹), **에러 코드 해설 패널**, **코드 생성 3세트 4개**.

## API 키 취급

- 키는 기본적으로 **sessionStorage(현재 탭)에만** 보관 — 탭을 닫으면 소멸.
- "영구 저장" 옵트인 시 localStorage에 평문 저장 — 화면에 경고 표시, 공용 PC 사용 금지.
- 생성된 코드에는 키가 절대 삽입되지 않는다 — 플레이그라운드의 키 입력과 코드 가이드는 별개로, 모든 변형이 `#/setup`(초기 설정)에서 안내하는 백엔드 환경변수 `ALLI_API_KEY` 전제로 생성된다. curl/Node/Python은 환경변수 직접 참조, 브라우저 변형은 백엔드가 환경변수를 읽어 주입한 값(`globalThis.ALLI_API_KEY`) 참조 — 키 리터럴/placeholder 금지, 운영은 프록시 경유 권장.
- 키 위치: Alli 대시보드 **Settings > General**의 REST API 키. ⚠️ JS 챗 위젯용 `sdkKey`와 다른 키다.

## 배포 전 사전 점검

- **App Market·Generative Answer는 계약 옵션** — 프로젝트에 활성화돼 있는지 계정 매니저를 통해 확인할 것. 비활성 시 4xx가 떨어지며, 에러 패널이 "(가능성)" 힌트를 표시한다.
- 브라우저 → `backend.alli.ai` 직접 호출이므로 **CORS 허용이 전제**다. 차단 시 연결 화면에서 "네트워크 또는 CORS 차단 가능성" 패널이 뜬다 (브라우저 콘솔에서 확인). 차단이 확인되면 개발 시에는 Vite dev 프록시를 임시로 구성할 것 (제품 범위 밖).

## Gate G1 — 실 API 검증 프로토콜 (릴리스 차단 항목)

Alli 공식 문서에 응답 스키마가 명시되지 않은 API가 있어, 목 픽스처에 **ASSUMPTION** 주석으로 가정돼 있다.
실 자격증명 확보 후 아래를 수행해 가정을 실측으로 교체할 것:

1. **CORS 실측** — `#/connect`에서 실 키로 프로젝트 확인.
2. **run 응답 형태 확정** — `#/run`에서 답변형 앱 실행 → Raw 뷰 "응답 복사" → `result.responses[]` vs `result.choices[]` 확정.
3. **run_conversation 스트림 확정** — `#/multipart`에서 실행 → Raw 뷰의 청크 트랜스크립트 복사 → conversationId 위치 확정.
4. **GA 스트림 프레이밍** — `#/answer` stream 모드 → 청크 트랜스크립트 캡처.
5. 캡처로 `src/mock/fixtures.ts`(ASSUMPTION 교체), 필요시 `src/core/extract.ts`(우선 경로 고정), `SSOT.md`의 미확정 스키마 절 갱신.
6. 생성 코드 4종을 실제 셸 / Node 20 / Python 3에서 1회씩 실행 검증.

## 구조

```
src/
├─ core/      # 프레임워크 무관 SDK 코어 (DOM 없음 — ERP에서 재사용 가능)
│             # client(헤더 주입·sync/stream), endpoints(13개 RequestSpec 빌더),
│             # stream(비SSE JSON 조각 스캐너), errors(한글 해설), extract(deep-scan),
│             # draftjs(폴백), encoding(base64: OWN-USER-ID), replace-machine(Flow 5 리듀서)
├─ codegen/   # RequestSpec → curl/브라우저JS/Node/Python 4종 생성 (+ 멀티턴/폴링/교체 wrapper)
├─ flows/     # 화면 7개 (초기 설정 + Flow 1~6)
├─ ui/        # 공용 컴포넌트 (error-panel, raw-view, code-panel, kv-form, stream-view …)
├─ state/     # 세션(키)·앱 선택·변수 정의(localStorage)
├─ mock/      # fetch 주입형 목 (13개 라우트, ASSUMPTION 태그 픽스처)
├─ lib/       # 해시 라우터, pub/sub 스토어, DOM 헬퍼
└─ styles/    # DESIGN.md 디자인 토큰 (CSS 커스텀 프로퍼티)
```

핵심 설계: **RequestSpec 일원화** — 같은 spec 객체를 ① 실제 호출 ② multipart 미리보기 ③ 코드 생성이 소비하므로, 화면에서 테스트한 요청과 생성된 코드가 구조적으로 일치한다.

### 목 모드 데모 트리거

| 트리거 | 재현되는 것 |
|---|---|
| API 키에 `invalid-key` | 403 / code 7001 (키 오류 해설) |
| 변수 없이 실행 | `{"errors":"internal error. Expecting value…"}` — 실제 서버가 돌려주는 불친절한 에러 원문 재현 |
| 앱 "레거시 요약" 실행 | `result.choices[]` 레거시 응답 형태 |
| 업로드 파일명에 `fail` 포함 | 인제스천 `parsing_fail` → 롤백 경로 (Flow 5) |
| OWN-USER-ID 미설정 + 답변 생성 | threadId 미반환 (멀티턴 비활성) |

## 범위 밖 (v1 비목표)

앱 생성/수정, 사용자·멤버·권한 관리, SSO, 프록시/게이트웨이 서버, 중앙 호출 로그, 분석/통계,
Q&A(FAQ) 관리, background 실행 모드, NLU API, RAG 평가 — 백로그는 [SDK-ENDPOINTS.md](./SDK-ENDPOINTS.md) 참조.
