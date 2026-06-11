# Alli SDK 탑재 대상 엔드포인트 (확정 선별본)

> [ENDPOINT-SUMMARY.md](./ENDPOINT-SUMMARY.md)에서 SDK 구축 시 실제 탑재할 엔드포인트만 추린 문서.
> API 용어와 운영자 화면 용어의 대조는 [GLOSSARY.md](./GLOSSARY.md) 참조 (예: API의 `skill` = 화면의 "대화형 앱").
> v1 시나리오·SSOT는 [SSOT.md](./SSOT.md) — 이 37개 중 시나리오 6개에 필요한 13개를 1차 선별한 자기완결 기준 문서.
>
> **선별 기준**
> 1. 추천도 ★★★ 이상만 포함
> 2. v2 엔드포인트가 존재하면 legacy(`/webapi/*`)는 제외 (v2만 탑재)
> 3. **사용자/에이전트/권한 관리 제외** — 사내 Alli는 사용자 계정을 관리하지 않음
> 4. **NLU API 제외** — 별도 서버·별도 계약
> 5. **분석·집계성 엔드포인트 제외**
> 6. 예외: v2 대체가 없는 고유 기능은 비고와 함께 포함
>
> 총 **37개 엔드포인트**, 6개 모듈.

---

## 공통 레이어 (SDK 코어)

| 항목 | 내용 |
|---|---|
| 서버 | `https://backend.alli.ai` (US) / `https://backend-ja.alli.ai` (JA) — base URL 설정 가능하게 |
| 인증 | `API-KEY` 헤더 자동 주입 |
| 사용자 식별 | `OWN-USER-ID`는 인증이 아니라 **귀속(attribution) 헤더** — 호출의 최종 사용자를 기록. 처음 보는 ID면 Alli가 사용자를 자동 생성(사전 등록 불필요), 같은 ID의 후속 호출은 동일 사용자 활동으로 묶임. **멀티턴(threadId)은 이 헤더가 있어야 활성화**되고, 대화 소유자·피드백 주체 기록과 `userIds` 이력 필터에도 사용됨 → 호출자(ERP 사번, RPA는 시스템 계정 ID)를 옵션으로 받아 자동 주입 + 비ASCII `base64:` 인코딩 헬퍼 제공. (`AGENT-EMAIL`=멤버(운영자) 명의와는 반대편 당사자) |
| 응답 포맷 | SDK 기본값을 `answerFormat: "MARKDOWN"`, `format: "text"`로 노출 (DraftJS 기본값 회피) |
| 스트리밍 | `mode: sync \| stream` 공통 옵션화. stream은 sync와 동일 포맷의 JSON 조각 |
| 에러 처리 | 7000(일반)/7001(API키)/7002(JSON)/7003(파라미터)/7004(결제)/405(메서드) → SDK 공통 예외 매핑 |

---

## 1. 앱 실행 (App Market) — 5개

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `POST /webapi/apps/{app_id}/run` | LLM 앱 실행. `inputs` 변수 전달, `mode: sync/stream/background`, `conversationId`로 상태 유지 | **핵심.** 전표 요약, 문서 초안, 데이터 추출 등 Alli 앱 직접 호출 | ★★★★★ |
| `GET /webapi/v2/apps` | 앱 목록 (검색어/카테고리/타입/공개여부 필터, 커서 페이징) | 호출 가능한 앱 카탈로그 조회, 앱 ID 확보 | ★★★★ |
| `GET /webapi/v2/apps/{app_id}` | 앱 상세 조회 | 실행 전 입력 변수 스키마 확인 → SDK 입력 검증 | ★★★★ |
| `POST /webapi/v2/apps/{app_id}/run_conversation` | 캠페인 앱 실행 (스트리밍, multipart로 파일/미디어 첨부) | ERP 첨부문서를 넘겨 처리하는 앱 호출 | ★★★★ |
| `POST /webapi/skill` | 스킬 실행 후 최종 텍스트만 반환 (`id`, `text`, `variables`) | 엔티티 추출 등 결과 텍스트만 필요한 배치/화면 | ★★★★ |

## 2. 생성형 답변 & 직접 LLM 호출 — 3개

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `POST /webapi/generative_answer` | 문서/Q&A/표 기반 생성형 답변. 모델 선택, `answerFormat`, `isStateful`+`threadId` 멀티턴, `clues` 근거 반환, `hashtags`/`search_from` 범위 제한 | **핵심.** 사규/업무 매뉴얼 질의응답, 멀티턴 도우미 | ★★★★★ |
| `POST /webapi/retrieval` | 질문 관련 문서 페이지 검색 (BM25/텍스트벡터/제목벡터 가중치 조절) | 답변 생성 없이 관련 페이지만 받아 ERP 로직에서 후처리 | ★★★★ |
| `POST /webapi/v2/chat/completions` | 검색 없이 직접 LLM 호출 (messages, model, temperature, sync/stream) | 메일 초안, 번역 등 검색이 필요 없는 텍스트 생성·변환 | ★★★★ |

## 3. 검색 (Cognitive Search) — 4개

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `POST /webapi/faq` | Q&A 지식베이스 유사 질문-답변 검색 (해시태그 필터, confidence) | 헬프데스크/사내 FAQ 검색 위젯 | ★★★★ |
| `POST /webapi/mrc` | 문서에서 답변 구절 추출(MRC) | 규정·계약서에서 정확한 답변 추출 | ★★★★ |
| `POST /webapi/find_match` | 통합 검색 (exact match → small talk → FAQ → MRC 순차, 임계값 조절) | 단일 호출 다단계 검색이 필요한 챗봇형 UI | ★★★ |
| `GET /webapi/single_faq` | Q&A 단건 상세 조회 | 검색 결과 상세 화면 | ★★★ |

※ 문서 단건 조회는 `GET /webapi/v2/knowledge_base_nodes/{node_id}`(4절), 제목 검색은 `content_search`(searchScope 옵션)로 대체.

## 4. 대화 관리 — 10개

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `POST /webapi/start_conversation` | `placement`로 스킬 지정해 대화 시작 | 대화형 앱 진입점 | ★★★★ |
| `POST /webapi/send_chat` | 진행 중 대화에 사용자 메시지 전송 | 대화형 앱 메시지 교환 | ★★★★ |
| `POST /webapi/end_conversation_by_agent` | 에이전트 측 대화 종료 | 세션 정리 | ★★★ |
| `GET /webapi/v2/conversations` | 대화 목록 (사용자/앱/기간 필터, 커서 페이징) | 대화 이력 화면 | ★★★ |
| `GET /webapi/v2/conversations/{id}` | 대화 단건 + 최근 챗 20개 | 대화 이력 상세 | ★★★ |
| `GET /webapi/v2/conversations/{id}/chats` | 대화 내 전체 메시지 페이징 조회 | 대화 이력 전체 로드 | ★★★ |
| `GET /webapi/v2/conversations/{id}/chats/{chat_id}` | 챗 단건 + 중간 단계(intermediateSteps) | 스트리밍/백그라운드 실행 결과 검증 | ★★★ |
| `GET /webapi/v2/conversations/{id}/running` | 대화 실행 중 여부 | **`apps/run` background 모드 폴링** | ★★★ |
| `POST /webapi/v2/conversations/{id}/stop` | 실행 중 대화 중지 | 장시간 실행 취소 | ★★★ |
| `POST /webapi/v2/conversations/{id}/chats/{chat_id}/feedback` | 챗 응답 평점/사유/제안답변 피드백 | ERP UI 👍/👎 수집 | ★★★ |

## 5. 지식베이스(문서) 관리 — 14개

ERP 문서 → Alli 동기화 시나리오. 전부 v2 계열.

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `POST /webapi/v2/knowledge_base_nodes/upload` | 문서 업로드 (PDF/Word/PPT/Excel/HTML/TXT, OCR·레이아웃 옵션, 폴더/권한/해시태그) | **문서 동기화 핵심** | ★★★★ |
| `POST /webapi/v2/knowledge_base_nodes/search` | 노드(파일/폴더) 검색·목록 (필터/정렬/커서 페이징) | 동기화 상태 대조, 문서 탐색 | ★★★★ |
| `GET /webapi/v2/ingestion_status/{kb_id}` | 문서 파싱 파이프라인 단계별 상태 | 업로드 후 처리 완료 대기 (폴링) | ★★★ |
| `POST /webapi/v2/knowledge_base_nodes/upload_from_aws_s3` | S3에서 문서 가져오기 | S3 보관 문서 대량 이관 | ★★★ |
| `POST /webapi/v2/knowledge_base_nodes/upload_from_azure_blob` | Azure Blob에서 문서 가져오기 | Azure 보관 문서 대량 이관 | ★★★ |
| `GET /webapi/v2/knowledge_base_nodes/{node_id}` | 노드 단건 조회 | 문서 메타데이터 확인 | ★★★ |
| `PUT /webapi/v2/knowledge_base_nodes/{node_id}` | 노드 수정 (제목/해시태그/권한/커스텀 속성) | ERP 문서번호 등을 커스텀 속성으로 동기화 | ★★★ |
| `DELETE /webapi/v2/knowledge_base_nodes/{node_id}` | 노드 삭제 | 폐기 문서 정리 | ★★★ |
| `POST /webapi/v2/knowledge_base_nodes/content_search` | 본문 전문 검색 (searchScope: 제목/본문/모두) | 본문·제목 기반 문서 찾기 | ★★★ |
| `POST /webapi/v2/knowledge_base_nodes/page_content_search` | 페이지 단위 본문 검색 (페이지 번호 반환) | 페이지 정밀 검색 | ★★★ |
| `GET /webapi/v2/knowledge_base_nodes/{node_id}/text` | 파싱된 문서 텍스트 추출 | Alli 파싱 원문을 ERP에서 재활용 | ★★★ |
| `GET /webapi/v2/knowledge_base_nodes/{node_id}/download` | 원본 파일 다운로드 | 원본 문서 내려받기 | ★★★ |
| `POST /webapi/v2/folders` · `GET/PUT/DELETE /webapi/v2/folders/{id}` | 폴더 생성/조회/수정/삭제 (권한 상속) | ERP 문서 분류 체계를 폴더로 미러링 | ★★★ |
| `POST /webapi/toggle_documents` | 문서 활성/비활성 일괄 전환 | 문서를 지우지 않고 검색 노출만 차단 (개정 대기 문서 등) — **v2 대체 없음, legacy 예외 포함** | ★★ |

## 6. 유틸리티 — 4개

| 엔드포인트 | 기능 | SDK 활용처 (ERP 관점) | 추천도 |
|---|---|---|---|
| `GET /webapi/v2/projects` | API-KEY에 해당하는 프로젝트 정보 | SDK 초기화 시 키 검증·헬스체크 | ★★★ |
| `POST /webapi/v2/multimodal/generate-file` | 마크다운 → PDF/DOCX/PPTX/XLSX 변환 | 앱 답변을 ERP 보고서 파일로 출력 | ★★★ |
| `POST /webapi/v2/multimodal/media-content` | 미디어(이미지/오디오) base64 조회 | 앱 응답 내 미디어 표시 | ★★★ |
| `GET /webapi/hashtags` | 전체 해시태그와 사용 수 | 검색·답변 API의 `hashtags` 필터 값 구성 | ★★★ |

---

## 구현 우선순위

| 단계 | 대상 |
|---|---|
| **Phase 1 (필수)** | 공통 레이어 + `v2/apps` 목록·상세 + `apps/{id}/run` + `generative_answer` |
| **Phase 2 (핵심 보강)** | `retrieval`, `skill`, `run_conversation`, `chat/completions`, `faq`/`mrc` 검색, `find_match`+`match_feedback`, 대화 관리 10종 |
| **Phase 3 (연동 시나리오)** | 지식베이스 14종, 유틸리티 4종 |

## 제외 내역 (참고)

**legacy → v2 대체** (기능은 동일, v2만 탑재):

| 제외된 legacy | 대체 v2 |
|---|---|
| `GET /webapi/apps` | `GET /webapi/v2/apps` |
| `GET /webapi/single_document` | `GET /webapi/v2/knowledge_base_nodes/{node_id}` |
| `GET /webapi/search_document_by_title` | `POST /webapi/v2/knowledge_base_nodes/content_search` (searchScope) |
| `POST /webapi/upload_file` / `upload_from_s3` | `v2/knowledge_base_nodes/upload` / `upload_from_aws_s3` |
| `GET /webapi/check_file_status` | `GET /webapi/v2/ingestion_status/{kb_id}` |
| `GET/POST /webapi/knowledge_bases` | `POST /webapi/v2/knowledge_base_nodes/search` |
| `POST /webapi/update_document` / `update_kb_name` | `PUT /webapi/v2/knowledge_base_nodes/{node_id}` |
| `POST /webapi/delete_file` | `DELETE /webapi/v2/knowledge_base_nodes/{node_id}` |
| `GET /webapi/knowledge_base_preview` / `GET /download_document_by_name/{project_id}` | `v2 .../preview` / `.../download` |

**범위 제외** (사유):

- 사용자/에이전트/권한 관리 전체 — 사내 Alli는 사용자 계정을 관리하지 않음
- Q&A(FAQ) 관리·피드백 8종 (`register_faq` POST/PUT, `delete_faq`, `faqs`, `upload_faq_file`, `faq/user_feedback`, `mrc/user_feedback`, `match_feedback`) — Q&A는 Alli 대시보드에서 직접 관리하기로 결정, SDK 범위에서 제거
- NLU API 4종 — 별도 서버(`nlu-api.allganize.ai`)·별도 계약
- 분석·집계 12종 — 요구사항상 불필요 (summary_analytics, daily count, 쿼리 히스토리, 호출 통계, 크레딧, 감사 로그 등)
- 앱 생성/수정, cognitive_config — 앱 "개발" 영역 (ERP는 호출만)
- RARE·bulk_processing — RAG 품질 평가 도구
- 자동 해시태그, faq_candidates, 대화 카테고리, 권한그룹 — Alli 대시보드 운영 영역

### 설계 시 주의사항 (유지)

1. **App Market·Generative Answer는 계약 옵션** — SDK 배포 전 계정 매니저를 통해 기능 활성화 확인.
2. **대화형 스킬 제약** — 실행 중간 사용자 입력이 필요한 스킬은 `apps/{id}/run` 불가(문서 업로드 후 LLM 노드 실행은 예외). `start_conversation`/`send_chat`은 Message/Q&A/Documents 노드만 호환.
3. **멀티턴 의존성** — `generative_answer`의 `threadId`는 `OWN-USER-ID` 헤더 없이는 비활성화됨. 미지정 시 전 호출이 "프로젝트 기본 사용자" 하나로 합쳐져 멀티턴 불가 + 대화 이력이 뒤섞임. 계정을 관리하지 않더라도 호출 식별자(사번/시스템 ID)를 넘기는 구조 필요 — 자동 생성되므로 등록 절차는 없음.
