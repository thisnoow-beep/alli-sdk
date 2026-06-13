# Alli SDK SSOT — 시나리오·엔드포인트 단일 기준 문서

> **이 파일 하나만으로 SDK PRD를 작성할 수 있도록 만든 자기완결(self-contained) 문서.**
> 다른 문서(ENDPOINT-SUMMARY.md, GLOSSARY.md, docs/)를 컨텍스트에 넣지 않아도 되도록 필요한 스키마·용어·주의사항을 전부 인라인으로 포함한다.
>
> - 출처: `docs/api-reference/en/` (docs.allganize.ai 크롤, 2026-06-11)
> - 대상 제품: **사내 ERP 개발자용 Alli SDK + 테스트 플레이그라운드(웹앱)**
> - 버전: v1 (시나리오 6개 / 엔드포인트 13개)

---

## 1. 배경 — 누구를 위한, 무엇을 해결하는 SDK인가

사내 ERP 개발자는 **Alli 개발자들이 이미 만들어둔 앱**을 ERP 화면, RPA, 업무 자동화 스크립트에서 호출하고 싶다. 앱을 만들거나 운영(빌더·대시보드 관리)하는 것은 범위 밖이다.

Alli API의 진입 장벽과 본 SDK/플레이그라운드에서의 해소 위치:

| # | 진입 장벽 | 해소 위치 |
|---|---|---|
| 1 | 앱 ID 확인 필요 | Flow 2 — 앱 목록/상세 조회 화면에서 ID 복사 |
| 2 | 입력 변수 구조 확인 필요 | Flow 2 — key-value 입력 폼 (단, API가 변수 스키마를 제공하지 않음 → §9-1) |
| 3 | sync/stream 호출 방식 차이 | §3.5 실행 모드 정책 + 각 플레이그라운드의 모드 토글 |
| 4 | multipart 파일 업로드 처리 | Flow 3 — multipart payload 미리보기 + 코드 생성 |
| 5 | Generative Answer 옵션 이해 | Flow 4 — 옵션 UI(hashtags/search_from/멀티턴) + 코드 생성 |
| 6 | API Key 헤더 처리 | Flow 1 — 키 검증 + §3.2 헤더 규약 자동 주입 |
| 7 | 응답 포맷이 API별로 다름 | §3.4 응답 포맷 정책 (DraftJS 회피, MARKDOWN 강제) |
| 8 | 에러 코드 해석 필요 | §3.3 에러 코드표 + 전 화면 공통 에러 해설 패널 |
| 9 | ERP 코드 이식 반복 작업 | 전 Flow 공통 — curl/JavaScript/Python 코드 생성 (§7) |

---

## 2. 시나리오 한눈에 보기 (6개)

| Flow | 시나리오 | 핵심 엔드포인트 |
|---|---|---|
| 1 | API Key 검증 | `GET /webapi/v2/projects` |
| 2 | 앱 선택 후 테스트 실행 | `GET /webapi/v2/apps` → `GET /webapi/v2/apps/{app_id}` → `POST /webapi/apps/{app_id}/run` |
| 3 | 파일 첨부 앱 테스트 | `POST /webapi/v2/apps/{app_id}/run_conversation` |
| 4 | Generative Answer 테스트 | `POST /webapi/generative_answer` (+ `GET /webapi/hashtags`) |
| 5 | 문서 Replace | KB `search` → `upload` → `ingestion_status` 폴링 → `DELETE` |
| 6 | 대화형 앱 멀티턴 | `run_conversation` 반복 (+ `GET /v2/conversations/{id}`, `/chats`) |

공통(전 시나리오): 요청/응답 Raw 뷰, 에러 코드 해설 패널, curl/JS/Python 코드 생성.

---

## 3. 공통 레이어 (SDK 코어)

### 3.1 서버 (Base URL)

| 리전 | Base URL |
|---|---|
| US | `https://backend.alli.ai` |
| JA | `https://backend-ja.alli.ai` |
| 온프레미스 | 사용자 직접 입력 (커스텀 URL 허용) |

SDK·플레이그라운드 모두 base URL을 설정값으로 받는다. (NLU API는 별도 서버 `nlu-api.allganize.ai`·별도 계약 — 본 SDK 범위 밖)

### 3.2 인증·식별 헤더

| 헤더 | 필수 | 설명 |
|---|---|---|
| `API-KEY` | ✅ | 대시보드 **Settings > General**의 REST API 키. ⚠️ JS 챗 위젯용 `sdkKey`와는 다른 키 |
| `OWN-USER-ID` | 옵션 | 호출자 식별자(ERP 사번 등). 미지정 시 프로젝트 기본 사용자로 처리되고 **`threadId`(멀티턴) 기능이 비활성화**됨. 신규 ID를 보내면 Alli가 사용자를 자동 생성. **비ASCII 문자 불가** → `base64:인코딩값` 형식 사용 (SDK가 자동 변환) |
| `USER-EMAIL` | 옵션 | OWN-USER-ID 사용자의 이메일을 함께 갱신할 때 |

**`OWN-USER-ID` 개념 — 인증이 아니라 귀속(attribution)**

- `API-KEY`가 프로젝트(테넌트) 인증이라면, `OWN-USER-ID`는 그 안에서 **"이 호출의 최종 사용자가 누구인지"를 기록하는 식별자**다. 권한 검사 용도가 아니다.
- **사전 등록 불필요**: 처음 보는 ID를 보내면 Alli가 그 ID로 사용자를 자동 생성하고, 같은 ID의 모든 후속 호출은 동일 사용자의 활동으로 묶인다. 등록된 사용자는 대시보드 "대화 > 멤버 정보"에서 확인 (API 문서의 "Customers 메뉴" 안내는 구명칭).
- **영향 범위**: ① Generative Answer의 `threadId` 멀티턴 활성화 — 미지정 시 "프로젝트 기본 사용자"로 처리되며 멀티턴 비활성 ② 대화(`start_conversation`/`run_conversation`)의 소유자 기록 ③ 검색·피드백 API의 주체 기록 및 사용자별 필터 ④ `GET /v2/conversations`의 `userIds` 필터로 사용자별 이력 조회.
- `AGENT-EMAIL`(멤버=운영자 명의 지정)과는 반대편 당사자 — agent는 사람(운영자), user는 최종 사용자.
- **SDK 권고**: ERP 사번을 기본 전달(비ASCII는 자동 `base64:` 변환). RPA·배치는 `RPA-INVOICE-BOT` 같은 시스템 계정 ID로 사람 트래픽과 구분. 미지정 시 전 직원의 호출이 기본 사용자 하나로 합쳐져 멀티턴 불가 + 이력이 뒤섞인다.

### 3.3 에러 코드

에러 응답 기본 형태:

```json
{ "type": "APIError", "code": 7000, "message": "Something went wrong." }
```

| HTTP | code | 이름 | 의미 |
|---|---|---|---|
| 500 | 7000 | API Error | 미분류 서버 오류 |
| 403 | 7001 | Invalid API Key | `API-KEY` 헤더 값이 유효하지 않음 |
| 403 | 7002 | Invalid JSON | 요청 본문 JSON 디코딩 실패 |
| 400 | 7003 | Invalid Parameter | 파라미터 누락/형식 오류 |
| 403 | 7004 | Payment Error | 결제/과금 관련 오류 (연체 등) |
| 405 | — | Wrong HTTP Method | 잘못된 HTTP 메서드 |

⚠️ **비표준 에러 형태도 존재**: `{"error": "Method Not Allowed POST: /webapi/apps"}`, `{"errors": "internal error. Expecting value: ..."}` (앱 실행 시 inputs 누락) 등. SDK 에러 파서는 `code` 필드 외에 `error`/`errors` 키도 처리해야 한다.

### 3.4 응답 포맷 정책

- Generative Answer의 `answerFormat` 기본값은 `DRAFTJS`(에디터용 JSON) → **SDK는 항상 `MARKDOWN`을 명시 지정**한다.
- 앱 실행(`run`) 응답의 `message`도 DraftJS JSON 문자열로 올 수 있음 → 표시 계층에서 DraftJS 감지 시 plain text 추출 폴백 필요.
- 원칙: **모든 호출에서 마크다운/텍스트 포맷을 우선**, Raw 뷰에서만 원본 노출.

### 3.5 실행 모드

- `mode: sync`(기본) | `stream`. stream은 **sync와 동일 포맷의 JSON 조각을 스트리밍** — SSE가 아니므로 청크를 누적하며 JSON 단위로 파싱한다.
- `POST /webapi/apps/{app_id}/run`은 스펙상 `background` 모드도 존재 (결과는 conversation 폴링으로 회수). **v1 시나리오에서는 제외, 백로그(§10)**.

---

## 4. 시나리오 상세

### Flow 0. 초기 설정 (정적 가이드)

**목적**: 코드 생성의 전제 조건을 사전에 한 번 안내 — API 호출이 없는 가이드 화면 (`#/setup`, 기본 진입 화면).

플레이그라운드의 동작(연결 화면의 키 입력·세션 보관)과 코드 가이드는 완전히 별개다. 생성 코드는 모두 **키가 백엔드 환경변수 `ALLI_API_KEY`로 주입돼 있다**는 전제로 작성되며(§7-1), 이 화면이 그 전제를 안내한다:

1. REST API 키 발급 위치 — Settings > General (sdkKey와 혼동 주의)
2. 백엔드 환경변수 `ALLI_API_KEY` 설정 — macOS/Linux(export), Windows(PowerShell/setx), .env(+커밋 금지 경고), 컨테이너/CI(시크릿)
3. 브라우저 사용 원칙 — 소스/번들에 키 금지, 백엔드가 환경변수 값을 주입(`globalThis.ALLI_API_KEY`) 또는 운영은 프록시 경유
4. 설정 확인 — env 출력 + `GET /v2/projects` curl 한 줄

이후 모든 화면의 생성 코드는 이 설정이 완료됐다는 전제로 동작하고, 환경변수 설정법을 코드 안에서 다시 가르치지 않는다.

### Flow 1. API Key 검증

**목적**: 접속 설정(Base URL + 키 + 호출자 식별자)을 검증하고 세션에 고정.

1. Base URL 선택 — US / JA / 커스텀 직접 입력
2. API Key 입력
3. (옵션이지만 권장) `OWN-USER-ID` 입력 — ERP 사번 등. 멀티턴(Flow 4·6) 사용의 전제조건. 비ASCII면 `base64:` 자동 변환
4. **Project Check**: `GET /webapi/v2/projects` 호출
5. 200 → 검증 성공, 설정을 세션에 저장 후 앱 목록 화면으로
6. 실패 → 에러 코드 해설 표시 (403+7001 "API 키가 유효하지 않습니다 — Settings > General의 REST API 키인지, sdkKey와 혼동하지 않았는지 확인" 등)

**보안**: 키는 세션 메모리에만 보관. 영구 저장 시 경고 표시.

### Flow 2. 앱 선택 후 테스트 실행

**목적**: 앱 ID·입력 변수를 몰라도 앱을 골라 실행해보고, 그대로 ERP 코드로 가져간다.

1. 앱 목록: `GET /webapi/v2/apps` (검색어·type·published 필터, pageSize 최대 100, cursor 페이징)
2. 앱 선택 → `GET /webapi/v2/apps/{app_id}` 상세 표시 (name/type/category/description/published)
3. **입력 변수 입력 — key-value 자유 폼** (행 추가식)
   - ⚠️ 앱 목록/상세 API는 입력 변수 스키마를 반환하지 않는다(§9-1). 폼 상단에 안내문: *"변수명은 Alli 빌더 화면에서 확인하세요. single_action: 앱에 정의된 변수 / 대화형(skill): user 변수만 사용 가능"*
   - 값은 문자열 기본 + JSON 모드 토글 (KB ID 배열 등 `["S25vd..."]` 형태 입력용)
4. **앱 유형 분기**:
   - `single_action` → 그대로 실행 가능
   - `skill`(대화형) → 실행 중간에 사용자 입력(선택/메시지)이 필요한 앱은 `run` 불가 → "Flow 3/6 (run_conversation)으로 테스트하세요" 배너. 예외: 문서 업로드 후 LLM 노드 실행형 스킬은 `run` 가능
5. sync / stream 선택 → `POST /webapi/apps/{app_id}/run`
6. 결과 확인: 메시지 추출 뷰 + Raw JSON 뷰, 응답 내 `conversation.id` 표시
7. 코드 생성 (curl/JS/Python)

### Flow 3. 파일 첨부 앱 테스트

**목적**: multipart 구성을 눈으로 확인하고 코드로 가져간다.

1. 대화형(skill/campaign) 앱 선택 → Multipart Playground 이동
2. `message` 등 일반 필드 입력, 파일 첨부 (`files[]` / `media_files[]` / `form_files[]` 구분)
3. **multipart payload 미리보기** — 생성될 form-data 필드 목록을 코드 생성 결과와 동일한 구조로 표시
4. `POST /webapi/v2/apps/{app_id}/run_conversation` 호출 (응답은 스트리밍)
5. 스트리밍 청크 실시간 표시 → 완료 후 정리된 응답 뷰
6. 코드 생성 — JS `FormData`+fetch / Python `requests(files=...)` / `curl -F`

### Flow 4. Generative Answer 테스트

**목적**: 사내 문서/Q&A 기반 RAG 질의응답의 옵션 조합을 실험하고 코드로 가져간다.

1. Generative Answer Playground 이동, 질문 입력
2. 옵션 설정:
   - `model` 선택 (§5.6 모델 목록)
   - `promptGroupId` — Settings > Prompt Management의 그룹 프롬프트 URL 마지막 세그먼트
   - `hashtags` 필터 — `GET /webapi/hashtags`로 전체 태그·사용수를 불러와 선택 UI 구성 (qna/docs × include/exclude × and/or)
   - `search_from` — `["web","qna","document"]` 중 선택
   - `clues` / `clueText` — 근거 포함 여부
3. sync / stream 선택
4. `answerFormat: "MARKDOWN"` 고정 → `POST /webapi/generative_answer`
5. 답변 마크다운 렌더 + **clues 근거 패널** (source DOCUMENT|FAQ, title, pageNo, kbId/faqId, text)
6. **멀티턴**: `isStateful: true`면 응답의 `threadId`를 자동 보관 → 후속 질문에 자동 첨부. 전제: `OWN-USER-ID` 헤더 (Flow 1에서 설정— 없으면 "멀티턴 비활성" 안내)
7. 코드 생성

### Flow 5. 문서 Replace

**목적**: ERP에서 개정 문서를 안전하게 교체(replace)한다. KB 업로드에는 overwrite 시맨틱이 없으므로(§9-5) 업로드+삭제 조합으로 구현한다.

> ⚠️ **순서 주의 — "삭제 후 업로드"가 아니라 "업로드 → 완료 확인 → 삭제"**.
> 삭제를 먼저 하면 (a) 업로드 실패 시 문서가 소실되고 (b) 인제스천이 끝날 때까지 검색 공백이 생긴다.

1. 기존 문서 식별: `POST /webapi/v2/knowledge_base_nodes/search` (`filter_.searchTerm`) → 구 노드의 `id`·`hashtags`·`status`·`processState` 확보
2. 새 파일 업로드: `POST /webapi/v2/knowledge_base_nodes/upload` — `hashtags`는 구 노드 것을 승계, `targetFolderId`로 같은 폴더 지정
3. 업로드 응답의 새 노드 `id`로 `GET /webapi/v2/ingestion_status/{kb_id}` 폴링
   - `completed`/`post_completed` → 성공
   - `parsing_fail`/`post_parsing_fail` → 실패
4. 성공 → 구 노드 `DELETE` / 실패 → **새 노드 `DELETE`(롤백)**, 구 문서는 그대로 유지
5. 결과(성공/실패/롤백) 표시 + 코드 생성 (폴링 루프 포함)

비고: 2~4단계 동안 같은 이름의 문서가 일시적으로 2개 공존한다. 공존 시간을 최소화하고, 문제가 되면 구 문서 비활성화(toggle, 백로그 §10)를 도입한다.

### Flow 6. 대화형 앱 멀티턴 (신설)

**목적**: 대화형(skill) 앱 본래의 사용 방식 — 메시지를 주고받으며 진행 — 을 테스트한다.

1. 대화형 앱 선택 → Conversation Playground 이동
2. `run_conversation`을 **conversationId 없이** 호출 (message만) → 새 대화 시작
3. 스트리밍 응답에서 `conversationId` 확보
   - ⚠️ 스트리밍 응답 스키마(특히 conversationId 위치)는 문서에 없음 → 구현 시 실 호출로 검증 (§9-2)
4. 후속 입력 전송 (conversationId 포함): 텍스트 `message` / 버튼 선택 `choices: '[0]'` / 폼 제출 `sendFormInput` / 파일 첨부
5. 응답을 채팅 UI로 누적 표시. 대화 검증·이력: `GET /webapi/v2/conversations/{id}` (최근 챗 20개 포함), `GET /webapi/v2/conversations/{id}/chats` (pageNo 페이징)
6. 코드 생성 — 멀티턴 루프(대화 시작 → ID 보관 → 반복 전송) 형태

---

## 5. 엔드포인트 명세 (13개)

모든 요청에 `API-KEY` 헤더 필수(§3.2). Base URL은 §3.1.

### 5.1 `GET /webapi/v2/projects` — 키 검증·프로젝트 정보

- 화면 용어: 대시보드의 "프로젝트"
- 파라미터: 없음
- 응답: 프로젝트 정보 객체 (OpenAPI상 스키마 미상세 — **키 검증 용도로는 HTTP 200 여부만 사용**)

```bash
curl -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/v2/projects
```

### 5.2 `GET /webapi/v2/apps` — 앱 목록

- 화면 용어: API `skill` = 화면 **"대화형 앱"**, API `single_action` = 화면 **"답변형 앱"**

| Query 파라미터 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `searchTerm` | string | — | 앱 이름/설명 검색 |
| `categories` | string[] | — | 카테고리 필터 |
| `type` | string | — | 앱 유형 필터 (`single_action` \| `skill`) |
| `published` | boolean | — | 게시 여부 |
| `pageSize` | int | 50 (최대 100) | 페이지 크기 |
| `cursor` | string | — | 커서 페이징 |

- 응답 (앱별): `id`, `name`, `type`, `description`, `category`, `published`, `agentPermission`, `userPermission`, `cursor`
- ⚠️ **입력 변수 정의는 포함되지 않음** (§9-1)

```bash
curl -H 'API-KEY: YOUR_API_KEY' 'https://backend.alli.ai/webapi/v2/apps?published=true&pageSize=50'
```

### 5.3 `GET /webapi/v2/apps/{app_id}` — 앱 상세

- 응답: 5.2와 동일 구조의 단건. ⚠️ 입력 변수 정의 없음 (§9-1)

```bash
curl -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/v2/apps/APP_ID
```

### 5.4 `POST /webapi/apps/{app_id}/run` — 앱 실행 ★핵심

- 화면 용어: "답변형 앱 실행" (대화형 앱도 제한적으로 가능)
- 제약: **실행 중간 사용자 입력(선택/메시지)이 필요한 스킬은 불가** (문서 업로드 후 LLM 노드 실행은 예외) → `run_conversation` 사용

| Body 파라미터 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `inputs` | object | — | 변수명→값. single_action: 앱에 정의된 변수 / skill: **user 변수만** |
| `mode` | string | `sync` | `sync` \| `stream` \| `background` |
| `chat.message` | string | — | 사용자 메시지(질문) |
| `chat.source.knowledgeBaseIds` | string[] | — | 검색 범위: 문서 ID |
| `chat.source.folderIds` | string[] | — | 검색 범위: 폴더 ID |
| `chat.source.webSites` | string[] | — | 검색 범위: 웹사이트 |
| `chat.useNodeDefaultInputSource` | boolean | false | 노드 기본 소스 사용 |
| `isStateful` | boolean | false | 상태 유지 |
| `conversationId` | string | — | 기존 대화 이어서 실행 |
| `llmModel` | string | — | 등록된 모델명 (소문자) |
| `llmPromptId` | string | — | LLM 프롬프트 ID |
| `gaPromptGroupId` | string | — | 답변 생성 그룹 프롬프트 ID |
| `temperature` | number | 0 | 생성 온도 |
| `requiredVariables` | string[] | — | 필수 변수 지정 |

- 응답: `result { id, name, type(campaign|single_action|agent), category, responses[] { id, type, message, source, sender, createdAt, completed, citations[] { clueId, source(DOCUMENT|FAQ|WEB), title, knowledgeBaseId, pageNo, url, text }, error, intermediateStep }, variables, conversation { id, state } }`
- ⚠️ 레거시 문서 예시는 `choices[]` 키로 응답 — v2 스펙(`responses[]`)과 다름. 실 응답 캡처로 확정 필요 (§9-3)

```bash
curl -X POST 'https://backend.alli.ai/webapi/apps/APP_ID/run' \
  -H 'API-KEY: YOUR_API_KEY' -H 'Content-Type: application/json' \
  --data-raw '{"inputs":{"input":"요약할 텍스트"},"mode":"sync"}'
```

### 5.5 `POST /webapi/v2/apps/{app_id}/run_conversation` — 대화형 앱 실행 (multipart)

- 화면 용어: **"대화형 앱"** 실행 (campaign은 대화형 앱의 구명칭)
- Content-Type: `multipart/form-data`. 응답: **스트리밍** (스키마 미문서화 — §9-2)

| Form 필드 | 타입 | 설명 |
|---|---|---|
| `conversationId` | string | 기존 대화 이어가기 (생략 시 새 대화 시작) |
| `message` | string | 사용자 메시지 |
| `choices` | string | 버튼/선택지 인덱스 — JSON 배열 문자열, 예: `'[0, 1]'` |
| `sendFormInput` | string | 폼 제출 데이터 (JSON 문자열) |
| `fileIds` | string | 기존 파일 ID 참조 |
| `files` | binary[] | 일반 파일 첨부 |
| `media_files` | binary[] | 미디어 파일 첨부 |
| `form_files` | binary[] | 폼 파일 첨부 |

```bash
curl -X POST 'https://backend.alli.ai/webapi/v2/apps/APP_ID/run_conversation' \
  -H 'API-KEY: YOUR_API_KEY' \
  -F 'message=이 문서를 요약해줘' -F 'files=@./contract.pdf'
```

### 5.6 `POST /webapi/generative_answer` — 생성형 답변 ★핵심

- 화면 용어: **"답변 생성"** (Answer Generation). `promptGroupId` = Settings > Prompt Management의 "답변 생성 그룹 프롬프트"
- ⚠️ 계약 옵션 기능 — 프로젝트에 활성화돼 있어야 함 (§9-4)
- 헤더: `API-KEY` 필수, `OWN-USER-ID` 옵션 (**없으면 threadId 기능 비활성**)

| Body 파라미터 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `query` ✅ | string | — | 질문 |
| `model` | string | `gpt4_o` | 사용할 LLM (아래 목록) |
| `answerFormat` | string | `DRAFTJS` | `DRAFTJS` \| `MARKDOWN` — **SDK는 항상 MARKDOWN 지정** |
| `isStateful` | boolean | false | 멀티턴(후속 질문) 사용 |
| `threadId` | string(UUID) | — | 첫 호출엔 비우고, 응답의 threadId를 후속 호출에 전달. 직접 UUID 지정도 가능 |
| `promptGroupId` | string | — | 그룹 프롬프트 ID (Settings 페이지 URL 마지막 세그먼트) |
| `mode` | string | `sync` | `sync` \| `stream` |
| `clues` | boolean | false | 근거(clues) 포함 |
| `clueText` | boolean | false | 근거 문서 본문 포함 (clues=true일 때만 동작) |
| `hashtags` | object | — | `{ qnaInclude[], qnaIncludeOption(and\|or), qnaExclude[], qnaExcludeOption, docsInclude[], docsIncludeOption, docsExclude[], docsExcludeOption }` |
| `search_from` | string[] | — | 검색 소스: `web` \| `qna` \| `document` |

- 응답: `answer`(answerFormat에 따라 DraftJS 객체 또는 Markdown 문자열), `intent`(`SEARCH`\|`END_OF_CONVERSATION`), `clues[] { clueId, source(DOCUMENT|FAQ), title, pageNo, kbId, faqId, text }`, `threadId`, `fuQuestion`(멀티턴 시 재작성된 질문)
- 모델 값 예: `gpt4_o`, `gpt4_o_mini`, `gpt4_turbo`, `gpt4`, `turbo`(GPT3.5), `azure_gpt4`, `azure_turbo`, `anthropic_claude_3_opus`, `anthropic_claude_3_sonnet`, `anthropic_claude_3_haiku`, `gemini_pro`, `hyper_clova_x_lk_0` 등 (프로젝트에 등록된 모델만 유효)

```bash
curl -X POST https://backend.alli.ai/webapi/generative_answer \
  -H 'API-KEY: YOUR_API_KEY' -H 'OWN-USER-ID: EMP12345' -H 'Content-Type: application/json' \
  -d '{"query":"연차 이월 규정 알려줘","answerFormat":"MARKDOWN","isStateful":true,"clues":true,"search_from":["document","qna"]}'
```

### 5.7 `GET /webapi/hashtags` — 해시태그 목록

- 용도: Flow 4의 hashtags 필터 선택 UI 구성
- 응답: `{ "result": { "해시태그명": 사용수, ... } }`

```bash
curl -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/hashtags
```

### 5.8 `POST /webapi/v2/knowledge_base_nodes/search` — 문서/폴더 검색

- 화면 용어: API "Knowledge Base (node)" = 화면 **"문서" 메뉴**의 파일/폴더 (화면의 "지식 베이스" 메뉴와 다름)

| Body 파라미터 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `filter_.searchTerm` | string | — | 이름 검색 |
| `filter_.parentFolderIds` | (string\|null)[] | — | 폴더 범위 (null=루트) |
| `filter_.hashtags` / `excludingHashtags` | string[] | — | 태그 포함/제외 (`...SearchOperator`: `and`\|`or`) |
| `filter_.processState` | string[] | — | 처리 상태 필터 (값은 5.11 참조) |
| `filter_.status` | string[] | — | `on` \| `off` (검색 노출 여부) |
| `filter_.nodeType` | string[] | — | `file` \| `folder` |
| `filter_.knowledgeBaseIds` | string[] | — | 특정 노드 ID |
| `order` | string | `updated_at_desc` | `name_asc/desc`, `updated_at_asc/desc`, `created_at_asc/desc` |
| `limit` | int | 10 | 페이지 크기 |
| `after` | string | — | 커서 페이징 |

- 응답 (노드별): `id`, `name`, `createdAt`, `updatedAt`, `nodeType(file|folder)`, `hashtags`, `status(on|off)`, `size`, `processState`, `cursor`

```bash
curl -X POST https://backend.alli.ai/webapi/v2/knowledge_base_nodes/search \
  -H 'API-KEY: YOUR_API_KEY' -H 'Content-Type: application/json' \
  -d '{"filter_":{"searchTerm":"취업규칙","nodeType":["file"]},"limit":10}'
```

### 5.9 `POST /webapi/v2/knowledge_base_nodes/upload` — 문서 업로드

- Content-Type: `multipart/form-data`

| Form 필드 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `fileName` ✅ | string | — | 파일명 |
| `file` ✅ | binary | — | 파일 (PDF/Word/PPT/Excel/HTML/TXT) |
| `hashtags` | string[] | — | 해시태그 (Replace 시 구 노드 것 승계) |
| `targetFolderId` | string | — | 업로드 대상 폴더 |
| `useLayout` | boolean | true | 레이아웃 분석 |
| `useImageDescription` | boolean | true | 이미지 설명 생성 |
| `useOcr` | boolean | false | OCR 처리 |
| `isOverwriteFolderAccess` | boolean | false | 폴더 권한 상속 덮어쓰기 (⚠️ 문서 교체와 무관 — 권한 전용) |
| `accessPermissionGroups` / `accessAgents` / `accessUserFilters` | object[] | — | 접근 권한 |
| `viewAccessToAgent` / `viewAccessToUser` | boolean | false | 열람 권한 |
| `properties` | object[] | — | 커스텀 속성 key/value (ERP 문서번호 등) |
| `notificationHooks` | string[] | — | `email_on_ingestion_complete` |

- 응답: 업로드된 노드 배열 (5.8과 동일 노드 구조 — 새 노드 `id` 확보)

```bash
curl -X POST https://backend.alli.ai/webapi/v2/knowledge_base_nodes/upload \
  -H 'API-KEY: YOUR_API_KEY' \
  -F 'fileName=취업규칙_v3.pdf' -F 'file=@./취업규칙_v3.pdf' -F 'hashtags=인사규정'
```

### 5.10 `DELETE /webapi/v2/knowledge_base_nodes/{node_id}` — 문서 삭제

- 응답: 200 (빈 본문)

```bash
curl -X DELETE -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/v2/knowledge_base_nodes/NODE_ID
```

### 5.11 `GET /webapi/v2/ingestion_status/{kb_id}` — 문서 처리 상태 (폴링)

- 응답: `{ status, startedAt, endedAt, elapsed, steps[] { name, subLabel, startedAt, endedAt, status } }`
- `processState` 값: `initializing` → `parsing` → `completed` → `post_parsing` → `post_completed` (실패: `parsing_fail`, `post_parsing_fail` / 재시도: `retrying`, `post_retrying`)
- 폴링 종료 조건: 성공 = `completed`/`post_completed`, 실패 = `parsing_fail`/`post_parsing_fail`

```bash
curl -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/v2/ingestion_status/KB_ID
```

### 5.12 `GET /webapi/v2/conversations/{conversation_id}` — 대화 단건

- 응답: 대화 메타 + **최근 챗 20개**. Query: `variables[]` (대화 변수 선택 조회)

```bash
curl -H 'API-KEY: YOUR_API_KEY' https://backend.alli.ai/webapi/v2/conversations/CONV_ID
```

### 5.13 `GET /webapi/v2/conversations/{conversation_id}/chats` — 대화 전체 메시지

- Query: `pageNo` (기본 1) — 페이지 단위 조회
- 용도: Flow 6 멀티턴 검증, 스트리밍으로 놓친 메시지 회수

```bash
curl -H 'API-KEY: YOUR_API_KEY' 'https://backend.alli.ai/webapi/v2/conversations/CONV_ID/chats?pageNo=1'
```

---

## 6. 시나리오 × 엔드포인트 매트릭스

| 엔드포인트 | F1 | F2 | F3 | F4 | F5 | F6 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 5.1 `GET /v2/projects` | ✅ | | | | | |
| 5.2 `GET /v2/apps` | | ✅ | ✅ | | | ✅ |
| 5.3 `GET /v2/apps/{id}` | | ✅ | ✅ | | | ✅ |
| 5.4 `POST /apps/{id}/run` | | ✅ | | | | |
| 5.5 `POST /v2/apps/{id}/run_conversation` | | | ✅ | | | ✅ |
| 5.6 `POST /generative_answer` | | | | ✅ | | |
| 5.7 `GET /hashtags` | | | | ✅ | | |
| 5.8 `POST /v2/knowledge_base_nodes/search` | | | | | ✅ | |
| 5.9 `POST /v2/knowledge_base_nodes/upload` | | | | | ✅ | |
| 5.10 `DELETE /v2/knowledge_base_nodes/{id}` | | | | | ✅ | |
| 5.11 `GET /v2/ingestion_status/{kb_id}` | | | | | ✅ | |
| 5.12 `GET /v2/conversations/{id}` | | | | | | ✅ |
| 5.13 `GET /v2/conversations/{id}/chats` | | | | | | ✅ |

---

## 7. 코드 생성 규약

플레이그라운드의 모든 Flow는 현재 입력값 그대로 동작하는 코드를 3종으로 생성한다: **curl / JavaScript(fetch) / Python(requests)**.

공통 규칙:

1. **Base URL·키 변수화** — 실제 키 값은 절대 코드에 삽입하지 않고, 키를 코드에 적게 하는 placeholder(`YOUR_API_KEY` 류)도 금지. 모든 변형은 **환경변수 `ALLI_API_KEY` 설정 완료를 전제**로 생성한다(전제는 Flow 0 초기 설정 화면에서 사전 안내): curl/bash는 `$ALLI_API_KEY`, Node는 `process.env.ALLI_API_KEY`(미설정 throw), Python은 `os.environ["ALLI_API_KEY"]`(미설정 KeyError), 브라우저는 백엔드가 환경변수를 읽어 주입한 값(`globalThis.ALLI_API_KEY`, 미주입 throw)을 참조하고 "소스에 키 리터럴 금지 + 운영은 프록시 경유 권장" 주석을 동반. JS/Python은 `BASE_URL` 상수 분리, curl은 복사한 명령 단독 실행이 가능하도록 Base URL을 명령어에 인라인(kb-replace bash 스크립트는 예외적으로 `BASE_URL` 변수 유지)
2. **헤더 주입** — `API-KEY` 필수, Flow 1에서 OWN-USER-ID가 설정돼 있으면 함께 포함 (비ASCII면 `base64:` 변환 코드 포함)
3. **Content-Type** — JSON 요청은 `application/json` 명시, multipart는 명시하지 않음 (boundary 자동 설정: FormData / requests files= / curl -F)
4. **에러 처리 스켈레톤** — HTTP status 분기 + 본문의 `code`(7001~7004)/`error`/`errors` 키 해석 주석 포함
5. **stream 소비 코드** — fetch: `response.body.getReader()` 루프 / Python: `iter_content` 루프. 청크를 누적하며 JSON 단위로 파싱하는 헬퍼 포함 (§3.5 — SSE 아님)
6. **폴링 코드** — Flow 5는 ingestion_status 폴링 루프(간격·타임아웃·실패 상태 분기) 포함
7. **멀티턴 코드** — Flow 4는 threadId, Flow 6은 conversationId를 보관·재전송하는 루프 형태로 생성

---

## 8. 용어 대조 (최소 발췌)

API 명세 용어와 Alli 운영 화면 용어가 다르다. 코드·문서 작성 시 혼동 주의:

| API 용어 | 화면 용어 | 비고 |
|---|---|---|
| `skill` (conversational) | **대화형 앱** | URL의 `campaigns/...`(campaign)은 대화형 앱의 구명칭 |
| `single_action` | **답변형 앱** | |
| Agent App (`type: agent`) | **에이전트형 앱** | AI 앱 유형. 사람 아님 |
| agent / `AGENT-EMAIL` | **멤버** | 사람(운영자). 위의 에이전트형 앱과 전혀 다름 |
| Knowledge Base / `knowledge_base_nodes` | **"문서" 메뉴**의 파일·폴더 | 화면의 "지식 베이스" 메뉴(Q&A·사전 등 묶음)와 다른 것 |
| FAQ | **Q&A** | |
| Generative Answer | **답변 생성** (Answer Generation) | 빌더의 "답변 생성 노드" |
| `promptGroupId` | **답변 생성 그룹 프롬프트** | Settings > Prompt Management |
| REST `API-KEY` | Settings > General의 API 키 | JS 챗 위젯용 `sdkKey`와 다른 키 |

---

## 9. 알려진 한계·구현 시 검증 포인트

1. **입력 변수 스키마 API 부재** — 앱 목록/상세 어디에도 입력 변수 정의가 없다. key-value 자유 폼 + "빌더 화면에서 변수명 확인" 안내로 대응. inputs 오류 시 에러도 불친절함(`{"errors": "internal error. Expecting value: ..."}`) → 플레이그라운드에서 "입력 변수 누락/형식 오류 가능성" 해설 필요
2. **run_conversation 스트리밍 응답 스키마 미문서화** — conversationId 위치 포함. 구현 초기에 실 호출 캡처로 확정하고 본 문서를 갱신할 것
3. **run 응답 형태 이중성** — 레거시 문서 예시는 `result.choices[]`, v2 OpenAPI는 `result.responses[]` + `conversation`. 실 응답으로 확정 필요
4. **App Market·Generative Answer는 계약 옵션** — 모든 고객에게 기본 제공되지 않음. 배포 전 계정 매니저 통해 활성화 확인
5. **KB 업로드에 overwrite/replace 시맨틱 없음** — `isOverwriteFolderAccess`는 권한 상속 전용. Replace는 반드시 업로드→확인→삭제 조합 (Flow 5)
6. **멀티턴 전제조건** — `threadId`는 `OWN-USER-ID` 헤더 없이는 비활성화. 사내 Alli가 사용자 계정을 관리하지 않더라도 호출 식별자(사번 등)는 넘겨야 함
7. **DraftJS 기본값 함정** — `answerFormat` 미지정 시 DraftJS JSON이 반환됨. SDK는 항상 MARKDOWN 지정 (§3.4)
8. **GA 공식 문서의 200 응답 예시에 별개 API(문서 검색) 응답이 혼입**되어 있음 — 본 문서 5.6은 "Output Items" 명세 기준으로 정리했음

---

## 10. v1 제외 · 백로그

아래는 의도적으로 v1에서 제외 (필요 시 v2에서 시나리오와 함께 추가):

- **background 실행 시나리오** — `run`의 `mode: background` + `GET /v2/conversations/{id}/running` 폴링 + `POST /v2/conversations/{id}/stop` (RPA 장시간 실행용)
- **Retrieval 전용 검색** — `POST /webapi/retrieval` (답변 생성 없이 관련 문서 페이지만)
- **직접 LLM 호출** — `POST /webapi/v2/chat/completions` (검색 없는 텍스트 생성·번역)
- **인지 검색** — `POST /webapi/faq`, `POST /webapi/mrc`, `POST /webapi/find_match`, `GET /webapi/single_faq`
- **레거시 대화** — `start_conversation`/`send_chat`/`end_conversation_by_agent` (Message/Q&A/Documents 노드 한정) 및 대화 목록/피드백
- **KB 동기화 확장** — S3/Azure 업로드, 노드 GET/PUT, content_search/page_content_search, text/download, 폴더 CRUD, `toggle_documents`(문서 비활성화)
- **유틸리티** — `generate-file`(마크다운→PDF/DOCX 등), `media-content`(미디어 base64)

Q&A(FAQ) 관리·피드백(register_faq, delete_faq, faqs, upload_faq_file, user_feedback 계열, match_feedback)은 백로그가 아니라 **범위 제외** — Q&A는 Alli 대시보드에서 직접 관리하기로 결정.

전체 후보 풀(37개)과 선별 사유는 `SDK-ENDPOINTS.md` 참조 (단, 본 문서만으로 PRD 작성이 가능해야 하므로 백로그는 참고용).
