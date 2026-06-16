/* 목 픽스처 — SSOT §5 명세 기반.
   ⚠️ 응답 스키마가 미문서화된 곳(§9-2 run_conversation 스트림, §9-3 run 형태, 목록 래퍼 키)은
   ASSUMPTION 주석을 달고 Gate G1(실 API 검증)에서 캡처로 교체한다. */

import type { AppInfo, ChatMessage, Citation, Clue, KbNode } from '../core/types';

/* ---------- §5.1 프로젝트 ---------- */

/** 키 검증은 200 여부만 사용. 실측(§5.1, Gate G1): bare 배열 [{id,name,cognitiveSearchApiKey}] */
export const PROJECT_FIXTURE = [
  { id: 'prj-mock-1', name: 'Mock Project', cognitiveSearchApiKey: 'mock-cog-key' },
] as const;

/* ---------- §5.2~5.3 앱 ---------- */

/* cursor는 §5.2 응답의 앱별 필드 — 목 페이징에서 "이 앱 다음부터"의 커서로 사용 */
export const APP_FIXTURES: AppInfo[] = [
  {
    id: 'app-sum-001',
    name: '전표 요약',
    type: 'single_action',
    description: '전표/영수증 텍스트를 한 문단으로 요약하는 답변형 앱',
    category: '재무',
    published: true,
    cursor: 'cur-app-sum-001',
  },
  {
    id: 'app-trans-002',
    name: '계약서 번역',
    type: 'single_action',
    description: '계약서 조항을 한↔영 번역하는 답변형 앱',
    category: '법무',
    published: true,
    cursor: 'cur-app-trans-002',
  },
  {
    id: 'app-doc-101',
    name: '문서 도우미',
    type: 'skill',
    description: '사내 문서 기반으로 질의응답하는 대화형 앱',
    category: '공통',
    published: true,
    cursor: 'cur-app-doc-101',
  },
  {
    // published=false 하나 — 목록 필터(published) 동작 확인용
    id: 'app-exp-102',
    name: '경비 정산 봇',
    type: 'skill',
    description: '경비 정산 절차를 안내하는 대화형 앱 (게시 전)',
    category: '재무',
    published: false,
    cursor: 'cur-app-exp-102',
  },
  {
    id: 'app-agent-201',
    name: '구매 에이전트',
    type: 'agent',
    description: '구매 요청 접수부터 발주까지 처리하는 에이전트형 앱',
    category: '구매',
    published: true,
    cursor: 'cur-app-agent-201',
  },
  {
    // §9-3 재현용 — run 시 레거시 result.choices[] 형태로 응답하는 앱
    id: 'app-legacy-9',
    name: '레거시 요약',
    type: 'single_action',
    description: '레거시 choices[] 응답 형태 재현용 답변형 앱',
    category: '테스트',
    published: true,
    cursor: 'cur-app-legacy-9',
  },
];

/* ---------- §5.4 앱 실행 ---------- */

/** run 응답 메시지 — 마크다운 + 한글(스트림 멀티바이트 분할 시나리오의 재료) */
export const RUN_MESSAGE_MARKDOWN = [
  '## 전표 요약',
  '',
  '- 총 합계: **1,250,000원**',
  '- 항목 수: 12건',
  '- 결재 상태: 승인 대기',
  '',
  '요약: 6월 법인카드 사용 내역으로, 한도 초과 항목은 없습니다.',
].join('\n');

export const RUN_CITATION: Citation = {
  clueId: 'clue-run-1',
  source: 'DOCUMENT',
  title: '경비지침.docx',
  knowledgeBaseId: 'kb-002',
  pageNo: 3,
  text: '법인카드 사용 한도는 월 200만원으로 한다.',
};

/** §9-1 재현 — inputs 누락 시 서버가 돌려주는 비표준 에러 본문 (원문 그대로, 바이트 단위 일치 필요) */
export const RUN_INPUTS_ERROR_BODY =
  '{"errors":"internal error. Expecting value: line 1 column 1 (char 0)"}';

/** §9-3 재현 — 레거시 문서 예시 형태(result.choices[]) */
export const LEGACY_RUN_RESPONSE = {
  result: { choices: [{ message: '레거시 형태 응답입니다' }] },
} as const;

/* ---------- §5.6 Generative Answer ---------- */

/** 제목/목록/표 마크다운 + XSS 무해화 테스트용 <script> 문자열 포함 */
export const GA_ANSWER_MARKDOWN = [
  '# 연차 이월 규정 안내',
  '',
  '## 핵심 요약',
  '',
  '- 미사용 연차는 **최대 5일**까지 다음 해로 이월할 수 있습니다.',
  '- 이월 신청은 매년 12월 15일까지 인사팀에 제출해야 합니다.',
  '- 이월된 연차는 다음 해 6월 30일까지 사용해야 합니다.',
  '',
  '| 구분 | 기한 | 비고 |',
  '| --- | --- | --- |',
  '| 이월 신청 | 12/15 | 인사팀 제출 |',
  '| 이월 연차 사용 | 익년 6/30 | 미사용 시 소멸 |',
  '',
  'XSS 무해화 테스트: <script>alert(1)</script> (렌더러는 이 태그를 제거해야 한다)',
].join('\n');

export const GA_CLUES: Clue[] = [
  {
    clue_id: 'clue-ga-1',
    source: 'DOCUMENT',
    title: '취업규칙_v3.pdf',
    page_no: 12,
    kb_id: 'kb-001',
    text: '제12조(연차휴가의 이월) 미사용 연차는 최대 5일까지 다음 해로 이월할 수 있다.',
  },
  {
    source: 'FAQ',
    title: '연차 이월',
    faq_id: 'faq-77',
    text: '연차 이월 신청은 매년 12월 15일까지 인사팀에 제출합니다.',
  },
];

/* ---------- §5.7 해시태그 ---------- */

export const HASHTAGS_FIXTURE: Record<string, number> = {
  인사규정: 12,
  보안: 5,
  회계: 9,
  복리후생: 3,
  IT자산: 7,
};

/* ---------- §5.8 KB 노드 ---------- */

export const KB_NODE_FIXTURES: KbNode[] = [
  {
    id: 'kb-001',
    name: '취업규칙_v2.pdf',
    nodeType: 'file',
    hashtags: ['인사규정'],
    status: 'on',
    processState: 'completed',
    size: 482_133,
    createdAt: '2026-01-10T09:00:00Z',
    updatedAt: '2026-03-02T09:00:00Z',
    cursor: 'cur-kb-001',
  },
  {
    id: 'kb-002',
    name: '경비지침.docx',
    nodeType: 'file',
    hashtags: ['회계'],
    status: 'on',
    processState: 'completed',
    size: 120_482,
    createdAt: '2026-02-01T09:00:00Z',
    updatedAt: '2026-02-20T09:00:00Z',
    cursor: 'cur-kb-002',
  },
  {
    id: 'kb-003',
    name: '보안정책.pdf',
    nodeType: 'file',
    hashtags: ['보안', 'IT자산'],
    status: 'on',
    processState: 'completed',
    size: 980_204,
    createdAt: '2026-02-15T09:00:00Z',
    updatedAt: '2026-04-01T09:00:00Z',
    cursor: 'cur-kb-003',
  },
  {
    id: 'kb-f-01',
    name: '인사',
    nodeType: 'folder',
    hashtags: [],
    status: 'on',
    createdAt: '2026-01-05T09:00:00Z',
    updatedAt: '2026-01-05T09:00:00Z',
    cursor: 'cur-kb-f-01',
  },
];

/* ---------- §5.12~5.13 대화 ---------- */

/** run_conversation 이력이 없는 대화 id 조회 시의 기본 챗 — 12건(페이지당 5건 페이징 확인용 3페이지 분량) */
export const DEFAULT_CONVERSATION_CHATS: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
  id: `chat-default-${i + 1}`,
  message: i % 2 === 0 ? `사용자 메시지 ${i + 1}` : `에이전트 응답 ${i + 1}`,
  sender: i % 2 === 0 ? 'user' : 'agent',
  createdAt: `2026-06-01T09:${String(i).padStart(2, '0')}:00Z`,
}));
