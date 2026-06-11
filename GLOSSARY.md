# Alli 용어집 — API 명세 ↔ 운영자 화면(대시보드) 용어 대조

> **목적**: API 명세서(`docs/api-reference/en`, [SDK-ENDPOINTS.md](./SDK-ENDPOINTS.md))의 용어와 실제 Alli 운영자/사용자 화면의 명칭이 달라 생기는 혼동을 방지하기 위한 대조표.
> **출처**: [docs.allganize.ai/allganize-alli-works](https://docs.allganize.ai/allganize-alli-works) (한국어 가이드) + [allganize-alli-works-userguide-en](https://docs.allganize.ai/allganize-alli-works-userguide-en) (영문 가이드) + [구 Alli 공식 용어집](https://guide.allganize.ai/alli/glossary/) + API 레퍼런스 원문. 2026-06-11 조회.
> 초판의 추정 2건(답변 생성 노드, Q&A 후보)은 영문 가이드·공식 용어집으로 **확정 완료**.

---

## 0. 제품·화면 구분

| 명칭 | 무엇인가 | 비고 |
|---|---|---|
| **Alli 대시보드** | 운영자(관리자)용 관리 화면 (`app.alli.ai`). 앱 작성·문서 관리·설정 담당 | API 키 발급 위치 |
| **Alli Works** | 임직원(최종 사용자)용 포털. 대화, 문서함, 앱 사용 화면 | SDK가 대체/보완하려는 사용자 경험 영역 |
| **앱 마켓** | 대시보드 내에서 Alli가 기본 제공하는 앱 모음. 테스트 후 "앱 관리"에 추가 | API의 "App Market"과 동일 명칭 |
| 대시보드 주요 메뉴 | **앱 마켓 / 앱 관리 / 멤버 / 대화 / 문서 / 지식 베이스 / 통계 / 설정** | 아래 각 절에서 API 용어와 대조 |

---

## 1. 앱 유형 ⚠️ 최대 혼동 지점

API는 옛 명칭(skill, single action, campaign)을 그대로 쓰고, 화면은 새 명칭(대화형/답변형/에이전트형)을 쓴다.

| API 용어 | 화면 용어 | 설명 | 혼동 주의 |
|---|---|---|---|
| `single_action` / Single Action App | **답변형 앱** | 한 번 입력 → 한 번 출력(싱글턴). LLM 프롬프트 기반 간단 앱 | 문서 제목엔 "싱글액션 앱"이 남아 있으나 화면 본문은 일관되게 "답변형 앱" |
| `skill` / Conversational App | **대화형 앱** | 멀티턴 지원, 노드 기반 빌더로 제작 | API 응답의 `type: "skill"`이 화면의 "대화형 앱"임 |
| campaign / 캠페인 | **대화형 앱** (구 명칭) | 대시보드 URL 경로가 `.../campaigns/SKILL_ID`로 남아 있음 | `POST /webapi/skill`의 `id`는 이 URL의 SKILL_ID. v2 API의 "campaign app" 실행 = `run_conversation` |
| Agent App | **에이전트형 앱** | 인스트럭션 + 도구(MCP Tool) 연동으로 작업을 수행하는 에이전트 빌더 기반 앱 | 사람(상담원)을 뜻하는 "agent"와 전혀 다른 개념 (3절 참조) |
| LLM App | (총칭) **앱** | API에선 위 유형 전체를 "LLM App"으로 통칭 (`/webapi/apps`) | 화면에는 "LLM 앱"이라는 분류가 따로 없음 |

## 2. 앱 상태·실행 관련

| API 용어 | 화면 용어 | 설명 |
|---|---|---|
| `published: true` | **공개된 앱** | 사용자에게 공개된 상태 |
| `published: false` | **작성 중인 앱** | 초안 상태. 화면 메뉴에 "작성 중으로 변경" 액션 존재 |
| `inputs` (apps/run) | **인풋 설정 / 변수명** | 답변형 앱: 빌더의 "인풋 설정"(6가지 입력 타입)에서 정한 변수명(예: `file1`, `content`)이 `inputs`의 키 |
| `variables` (skill 실행) | **변수** | 설정 > 변수에서 관리. 타입: 값 / 문자열 변수 / 목록 및 파일 형식 변수 |
| user variables | **변수** (사용자 정보 변수) | 대화형 앱 실행 시 `inputs`로 넘길 수 있는 것은 "사용자 변수"로 설정된 것만 |
| `placement` (start_conversation) | **플레이스먼트** | SDK 설정 용어. "고정 플레이스먼트"로 특정 페이지/앱에 스킬 배치 |
| `category` (GENERAL, IT, OTHERS…) | **카테고리**: 일반, 세일즈, 고객 지원, 마케팅, IT, 인사, 법률, 기타 | 앱 마켓 분류 8종 |
| `mode: sync / stream / background` | (화면 노출 없음) | API 전용 실행 옵션. 화면의 앱 테스트는 항상 대화식 |

## 3. 사람 관련 용어 ⚠️ "agent ≠ 에이전트형 앱"

| API 용어 | 화면 용어 | 설명 | 혼동 주의 |
|---|---|---|---|
| agent / `AGENT-EMAIL` / `/v2/agents` | **멤버** | 대시보드에 로그인하는 운영자·임직원 계정. 메뉴: "멤버", 이력 메뉴: "멤버 정보" | API의 "agent"를 화면에서 "에이전트"로 부르지 않음. "에이전트(형 앱)"은 1절의 AI 앱 |
| user / `USER-EMAIL` | **사용자** | 대화를 거는 최종 사용자. Alli Works에선 멤버가 곧 사용자라 경계가 흐림 | 사내 Alli는 사용자 계정을 별도 관리하지 않음 — SDK는 호출 식별자로만 사용 |
| `OWN-USER-ID` (헤더) | 등록된 사용자는 **대화 > 멤버 정보**에 표시 | 호출의 최종 사용자를 지정하는 **귀속(attribution) 헤더** — 인증(API-KEY)과 별개. 처음 보는 ID면 Alli가 사용자를 자동 생성(사전 등록 불필요), 같은 ID의 후속 호출은 동일 사용자 활동으로 묶임. 비ASCII는 `base64:값` 형식 | **미지정 시 "프로젝트 기본 사용자"로 합쳐지고 `threadId`(멀티턴)가 비활성** ⚠️. ERP 사번/RPA 시스템 ID를 넘기는 것을 권장 |
| customer / Customers 메뉴 | (구 명칭) | 구버전 대시보드의 "Customers" 메뉴가 API 문서에 남아 있음. 현 화면은 "대화 > 멤버 정보" | API 문서의 "Customers menu" 안내는 현 화면과 불일치 |
| permission group | **그룹** (예: 어드민 그룹) | 설정 > 권한의 멤버 분류 단위 | SDK 제외 영역 |
| contact agent (노드) | **담당 멤버 연결 노드** | 대화를 담당자에게 넘기는 노드 | 여기서도 agent → "멤버" |

## 4. 지식베이스·문서 ⚠️ "Knowledge Base ≠ 화면의 '지식 베이스' 메뉴"

| API 용어 | 화면 용어 | 설명 | 혼동 주의 |
|---|---|---|---|
| Knowledge Base / `knowledge_base_nodes` / `kbId` | **문서** (메뉴) | 업로드된 사내 문서와 폴더. API의 KB 노드 = 문서 메뉴의 파일/폴더 | **화면의 "지식 베이스" 메뉴는 다른 것** — Q&A·연동·리트리버·피드백 등 "소스 관리" 묶음 메뉴임 |
| KB node (`nodeType: file/folder`) | 문서 / 폴더 | 파일과 폴더를 합쳐 "노드"로 부르는 건 API뿐 | 화면에 "노드"라는 말은 대화형 앱 빌더에서만 등장(7절) |
| Public/Personal Document Box | **공용 문서함 / 개인 문서함** | Alli Works 사용자 화면의 문서 영역 | API의 KB는 공용 문서함 쪽 |
| hashtag | **해시태그** | 문서·Q&A 분류 태그. 검색 범위 제한에 사용 | 동일 |
| `status: on/off` (toggle_documents) | 문서 사용 켜기/끄기 | 검색 노출 여부 전환 | |
| `processState` (parsing, completed…) | (업로드 처리 상태 표시) | 업로드 후 파싱/임베딩 진행 상태 | |
| synonyms API (`/v2/synonyms/`) | **동의어/이의어 사전** | 지식 베이스 > 학습 메뉴의 사전 기능 | |
| retrieval 가중치 (bm25 등) | **리트리버 최적화** | 지식 베이스 > 학습 메뉴 | Retrieval API의 가중치 파라미터와 대응되는 운영 화면 |
| feedback (faq/mrc/user_feedback) | **피드백 부여 및 관리** | 지식 베이스 > 학습 메뉴에서 수집된 피드백 관리 | |

## 5. Q&A ⚠️ "API의 FAQ = 화면의 Q&A"

| API 용어 | 화면 용어 | 설명 |
|---|---|---|
| FAQ / `faq` / `register_faq` | **Q&A** | 질문-답변 쌍 지식베이스. 화면은 일관되게 "Q&A", API는 일관되게 "faq" |
| `similarQuestions` | **유사 질문** | 하나의 Q&A에 등록하는 변형 질문들 |
| `faq_candidates` | **후보 (Candidates)** | 공식 정의: "라이브 상태가 아닌, 지식베이스에 속한 Q&A". Alli가 답을 찾지 못했거나 사용자가 "해당 없음"을 선택한 질문이 자동 등록됨. 구 Alli 대시보드의 "Candidates" 탭이며 **Alli Works 신 가이드에는 미노출** — SDK 제외 영역 |
| (주의) question candidates | **질문 후보 개수** (Q&A 설정) | 검색 시 표시할 답변 후보 **개수** 설정 — 위의 미응답 질문 "후보(Candidates)"와 단어만 같고 전혀 다른 개념 ⚠️ |
| Q&A auto-generation | **Q&A 자동 생성** | 문서 기반으로 Q&A를 자동 생성하는 기능 |
| `isUsed` / status | 사용/미사용 상태 | Q&A 활성 여부 |

## 6. 답변·검색 기능 ⚠️ "MRC와 생성형 답변은 화면에서 다른 이름"

| API 용어 | 화면 용어 | 설명 | 혼동 주의 |
|---|---|---|---|
| Generative Answer (`/webapi/generative_answer`) | **답변 생성** (영문: Answer Generation) | RAG 기반 생성형 답변. 빌더 노드명은 "답변 생성 노드(Answer Generation node)"로 확정. 노드는 **에이전트 모드**(멀티턴, RAG Agent)와 **그룹 프롬프트 모드**(지정 프롬프트로 1회 답변) 두 방식 지원 | 그룹 프롬프트 모드가 API의 `promptGroupId`와 연결되는 개념 |
| MRC / `/webapi/mrc` / Documents Search | **문서에서 답변** | 기계독해(MRC)로 문서에서 답변 구절을 "추출" — 생성형 답변과 다른 기능 | 노드 문서에 "기계독해(MRC) AI 활용" 명시. 생성이 아닌 추출 |
| Q&A Search (`POST /webapi/faq`) | **Q&A에서 답변** | Q&A 지식베이스 유사도 검색 | |
| Cognitive Search / Answer Bot | (총칭 없음) | API 문서의 구 제품명. 화면에는 등장하지 않음 | "Answer Bot API" = Q&A/문서 검색 계열의 옛 묶음 이름 |
| `clue` / `clues` | **출처** (근거 문서) | 답변 생성에 사용된 근거. 사용자 화면에선 "출처 정보"로 표시 | |
| `confidence` | **신뢰도** (기본 신뢰도, base confidence) | 문서 검색 설정의 "신뢰도 기준값"과 대응. 구 용어집에선 "Score" | |
| `effectiveConfidence` | **조정 신뢰도** (adjusted confidence) | 사용자/멤버 피드백이 반영된 보정 신뢰도. Q&A 설정의 "신뢰도 조정 속도"가 보정 강도를 결정 | API 응답의 두 값이 화면의 두 신뢰도와 1:1 대응 |
| `promptGroupId` | **답변 생성 그룹 프롬프트** | 설정 > 프롬프트 관리. 단일 프롬프트를 체이닝한 그룹. URL에서 ID 확인 | "Q&A 자동생성 그룹 프롬프트"는 다른 그룹이므로 ID 혼용 금지 |
| `threadId` / `isStateful` | (화면 노출 없음) | API 전용 멀티턴 식별자. `OWN-USER-ID` 없으면 비활성 | |
| `answerFormat: DRAFTJS` | (화면 노출 없음) | 화면 에디터의 내부 포맷(DraftJS). SDK는 MARKDOWN 권장 | |

## 7. 대화형 앱 노드 — API 문서 명칭 ↔ 빌더 화면 명칭

`start_conversation`/`send_chat`이 호환하는 노드는 **Message Node, Q&A Node, Documents Node** 세 가지 (API 문서 기준).

| API 문서 명칭 | 빌더 화면 명칭 |
|---|---|
| Message Node | **메시지 보내기/질문하기 노드** |
| Q&A Node ("Answer with FAQ") | **Q&A에서 답변 노드** |
| Documents Node ("Answer with MRC") | **문서에서 답변 노드** |
| (Generative Answer) | **답변 생성 노드** (Answer Generation node — 확정) |
| LLM Node | **LLM 노드** |
| (LLM input) | **LLM 인풋 노드** |
| (set variable) | **변수값 설정 노드** (계산식·함수 지원) / **변수 내보내기 노드** |
| (condition) | **조건 추가 노드** |
| (form input) | **입력 폼 보내기 노드** |
| contact agent | **담당 멤버 연결 노드** |
| (send email) | **이메일 보내기 노드** |
| (integration) | **연동하기 노드** |
| (deep research) | **딥 리서치 노드** |
| (MCP) | **MCP 노드** |

## 8. 대화·이력·통계

| API 용어 | 화면 용어 | 설명 |
|---|---|---|
| conversation | **대화** | 대시보드 메뉴 "대화" = 앱 사용 이력 관리 |
| chat | (대화 내) 메시지 | 대화 안의 개별 메시지 단위 |
| conversation history | **대화형앱 사용 기록** | 대화 메뉴 하위 |
| single action history | **답변형앱 사용 기록** | 대화 메뉴 하위 |
| user information | **멤버 정보** | 대화 메뉴 하위 — API 문서의 "Customers"에 해당 |
| analytics / statistics | **통계** / **LLM 통계** | 대시보드 통계 메뉴 — SDK 제외 영역 |

## 9. 키·인증 ⚠️ "API 키 ≠ SDK 키"

| API 용어 | 화면 위치/용어 | 설명 | 혼동 주의 |
|---|---|---|---|
| `API-KEY` (REST) | **설정 > 일반 > API Key** | 본 SDK가 사용하는 키 | |
| `sdkKey` | SDK 연동 설정의 **SDK 키** | Alli 웹 채팅 위젯(JS SDK) 임베드용 키 — REST API 키와 **다른 키** | 설정 > SDK 문서의 "연동하기"는 위젯 임베드 얘기. 본 프로젝트의 "SDK"와 이름만 같음 |
| Bearer / TokenAuth | (화면 노출 없음) | OpenAPI 스펙상 토큰 인증도 정의됨 | 사내 SDK는 API-KEY 사용 |
| `OWN-USER-ID` | SDK 문서의 **사용자 특정** (`setUserId`) | REST에선 헤더, JS SDK에선 메서드. 자동 생성·멀티턴 의존성 등 개념은 3절 참조 | |

---

## 빠른 참조 — 자주 틀리는 6가지

1. **"skill"이라 쓰고 "대화형 앱"이라 읽는다.** API의 `type: "skill"`, `/webapi/skill`, URL의 `campaigns/`는 전부 화면의 "대화형 앱".
2. **"single_action"은 "답변형 앱"이다.** "싱글액션"은 문서 제목에만 남은 옛 명칭.
3. **API의 "FAQ"는 화면의 "Q&A"다.** 반대로 화면에서 "FAQ"를 찾으면 없다.
4. **API의 "Knowledge Base"는 화면의 "문서" 메뉴다.** 화면의 "지식 베이스" 메뉴는 Q&A·사전·리트리버·피드백을 묶은 별개 메뉴.
5. **"agent"는 사람(멤버), "에이전트형 앱"은 AI 앱이다.** `AGENT-EMAIL`은 멤버 이메일이고, 에이전트형 앱과 무관.
6. **`OWN-USER-ID`는 인증이 아니라 귀속이다.** 안 보내도 호출은 되지만 멀티턴(`threadId`)이 비활성화되고 모든 이력이 "프로젝트 기본 사용자" 하나로 합쳐진다. 처음 보는 ID는 자동 생성되므로 사번을 그대로 넘기면 된다(비ASCII는 `base64:값`).
