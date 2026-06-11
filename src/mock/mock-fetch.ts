/* 목 fetch — MSW 대신 fetch 호환 구현을 AlliClient에 주입한다.
   목적: 자격증명 없이 6개 Flow 전체를 개발/데모/테스트.
   - 13개 엔드포인트 라우트 테이블 (fixtures.ts 사용)
   - 스트리밍 응답은 ReadableStream으로, 청크 경계를 픽스처 스크립트 그대로 내보냄
     (JSON 중간/문자열 중간/한글 멀티바이트 중간 분할 시나리오 포함)
   - 지연(latency) 시뮬레이션
   - 실패 트리거: API-KEY 'invalid-key' 또는 누락 → 403/7001,
     run inputs 누락 → {"errors":"internal error. Expecting value: ..."} (§9-1),
     파일명에 'fail' 포함 업로드 → 인제스천 parsing_fail 시퀀스
   - ingestion_status는 kbId별로 호출마다 단계가 진행되는 상태 유지 */

import type {
  ChatMessage,
  GenerativeAnswerBody,
  KbNode,
  KbProcessState,
  KbSearchBody,
  RunAppBody,
} from '../core/types';
import {
  APP_FIXTURES,
  DEFAULT_CONVERSATION_CHATS,
  GA_ANSWER_MARKDOWN,
  GA_CLUES,
  HASHTAGS_FIXTURE,
  KB_NODE_FIXTURES,
  LEGACY_RUN_RESPONSE,
  PROJECT_FIXTURE,
  RUN_CITATION,
  RUN_INPUTS_ERROR_BODY,
  RUN_MESSAGE_MARKDOWN,
} from './fixtures';

export interface MockFetchOptions {
  latencyMs?: number;
}

/* ---------- 모듈 레벨 상태 ----------
   여러 createMockFetch 인스턴스(예: 화면 전환으로 클라이언트 재생성)에서도
   대화 이력·인제스천 진행이 이어지도록 모듈 레벨에 둔다. 테스트는 resetMockState()로 격리. */

/** run_conversation이 누적한 대화별 챗 — §5.12/5.13이 이 Map을 읽는다 */
const conversationStore = new Map<string, ChatMessage[]>();
/** kbId별 ingestion_status 호출 횟수 — 호출마다 단계 진행 */
const ingestionCalls = new Map<string, number>();
/** 업로드 fileName에 'fail' 포함 → 인제스천 실패 시퀀스를 탈 노드 id */
const failMarkedNodes = new Set<string>();
/** 업로드로 생긴 노드 — 검색(§5.8)에 합산 노출 */
const uploadedNodes: KbNode[] = [];
/** 삭제된 노드 id — 검색에서 제외 */
const deletedNodeIds = new Set<string>();
let uploadCounter = 0;
let convCounter = 0;
let chatIdCounter = 0;

/** 테스트 격리용 — 모듈 레벨 상태 전체 초기화 */
export function resetMockState(): void {
  conversationStore.clear();
  ingestionCalls.clear();
  failMarkedNodes.clear();
  uploadedNodes.length = 0;
  deletedNodeIds.clear();
  uploadCounter = 0;
  convCounter = 0;
  chatIdCounter = 0;
}

/* ---------- 공통 헬퍼 ---------- */

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** chunks를 그대로 enqueue하는 스트림 응답 — 조각 간 latencyMs/3 지연 (§3.5 JSON 조각 스트림) */
function streamResponse(chunks: (string | Uint8Array)[], latencyMs: number): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        await delay(latencyMs / 3);
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** 직렬화된 JSON을 3조각으로 분할 — 두 번째 조각이 marker(한글, UTF-8 3바이트)의
    첫 바이트 직후에서 끝나도록 해 "멀티바이트 문자 중간" 경계를 강제한다.
    (소비측 TextDecoder(stream:true) 검증용) */
function splitMidMultibyte(text: string, marker: string): Uint8Array[] {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const at = text.indexOf(marker);
  const markerStart = at >= 0 ? enc.encode(text.slice(0, at)).length : Math.floor(bytes.length / 2);
  const cut2 = Math.min(markerStart + 1, bytes.length - 1); // 한글 3바이트 중 1바이트 뒤 = 문자 중간
  const cut1 = Math.max(1, Math.floor(cut2 / 2));
  return [bytes.slice(0, cut1), bytes.slice(cut1, cut2), bytes.slice(cut2)];
}

/** init.body(문자열) 또는 Request 본문에서 JSON 파싱 — 실패 시 undefined */
async function readJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const b = init?.body;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return undefined;
    }
  }
  if (input instanceof Request) {
    try {
      return await input.clone().json();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** multipart body 식별 — init.body instanceof FormData 우선, Request면 formData() 시도 */
async function readFormBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FormData | undefined> {
  if (init?.body instanceof FormData) return init.body;
  if (input instanceof Request) {
    try {
      return await input.clone().formData();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pushChat(convId: string, message: unknown, sender: 'user' | 'agent'): void {
  let chats = conversationStore.get(convId);
  if (!chats) {
    chats = [];
    conversationStore.set(convId, chats);
  }
  chats.push({
    id: `chat-${++chatIdCounter}`,
    message,
    sender,
    createdAt: new Date().toISOString(),
  });
}

/* ---------- 라우트 핸들러 ---------- */

/** §5.4 POST /webapi/apps/{id}/run */
function handleRun(appId: string, body: RunAppBody | undefined, latencyMs: number): Response {
  // §9-1 재현 — inputs 누락/빈 객체면 비표준 에러 본문을 원문 그대로 500으로
  const inputs = body?.inputs;
  if (!inputs || Object.keys(inputs).length === 0) {
    return new Response(RUN_INPUTS_ERROR_BODY, {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // §9-3 재현 — 레거시 앱은 result.choices[] 형태
  if (appId === 'app-legacy-9') return jsonResponse(LEGACY_RUN_RESPONSE);

  const app = APP_FIXTURES.find((a) => a.id === appId);
  const result = {
    result: {
      id: `run-${appId}`,
      name: app?.name ?? 'Mock App',
      type: 'single_action',
      responses: [
        {
          id: 'resp-1',
          message: RUN_MESSAGE_MARKDOWN,
          completed: true,
          citations: [RUN_CITATION],
        },
      ],
      variables: {},
      conversation: { id: 'conv-run-1', state: 'completed' },
    },
  };

  if (body?.mode === 'stream') {
    // sync와 동일 포맷의 JSON을 3조각으로 — 두 번째 조각은 한글 바이트 중간에서 절단 (§3.5)
    return streamResponse(splitMidMultibyte(JSON.stringify(result), '요약'), latencyMs);
  }
  return jsonResponse(result);
}

/** §5.5 POST /webapi/v2/apps/{id}/run_conversation — 항상 스트리밍.
    ⚠️ ASSUMPTION(§9-2): 응답 스키마 미문서 — 첫 조각 {"conversation":{"id"}},
    이어 {"message","sender":"agent"} 조각 2개, 마지막 {"completed":true}로 가정.
    Gate G1에서 실 캡처로 교체. */
function handleRunConversation(fd: FormData | undefined, latencyMs: number): Response {
  const rawMessage = fd?.get('message');
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const rawChoices = fd?.get('choices');
  const choices = typeof rawChoices === 'string' ? rawChoices : '';
  const rawConvId = fd?.get('conversationId');
  // conversationId가 오면 그 대화를 이어가고, 없으면 새 대화 id 발급
  const convId =
    typeof rawConvId === 'string' && rawConvId !== '' ? rawConvId : `conv-mock-${++convCounter}`;

  const fileNames: string[] = [];
  if (fd) {
    for (const v of fd.values()) {
      if (typeof v !== 'string') fileNames.push(v.name);
    }
  }

  const pieces: string[] = [];
  if (fileNames.length) pieces.push(`첨부 파일 ${fileNames.join(', ')}을(를) 확인했습니다`);
  if (message) pieces.push(`"${message}" 요청을 접수했습니다`);
  if (choices) pieces.push(`선택지 ${choices} 입력을 반영했습니다`);
  const reply1 = pieces.length ? `${pieces.join('. ')}.` : '입력을 접수했습니다.';
  const reply2 = '처리가 완료되었습니다. 추가로 도와드릴까요?';

  // §5.12/5.13에서 회수되도록 대화별 이력 누적
  if (message) pushChat(convId, message, 'user');
  if (choices) pushChat(convId, `choices: ${choices}`, 'user');
  pushChat(convId, reply1, 'agent');
  pushChat(convId, reply2, 'agent');

  return streamResponse(
    [
      JSON.stringify({ conversation: { id: convId } }),
      JSON.stringify({ message: reply1, sender: 'agent' }),
      JSON.stringify({ message: reply2, sender: 'agent' }),
      JSON.stringify({ completed: true }),
    ],
    latencyMs,
  );
}

/** §5.6 POST /webapi/generative_answer */
function handleGenerativeAnswer(
  body: GenerativeAnswerBody | undefined,
  hasOwnUserId: boolean,
  latencyMs: number,
): Response {
  const full: Record<string, unknown> = {
    answer: GA_ANSWER_MARKDOWN,
    intent: 'SEARCH',
    clues: GA_CLUES,
  };
  // §3.2 재현 — OWN-USER-ID 없으면 멀티턴 비활성 → threadId 생략
  if (hasOwnUserId) full['threadId'] = 'th-mock-1';
  // 멀티턴(threadId 전달) 시 재작성된 질문 동봉
  if (body?.threadId) full['fuQuestion'] = `재작성된 질문: ${body?.query ?? ''} (이전 맥락 반영)`;

  if (body?.mode === 'stream') {
    // ⚠️ ASSUMPTION: GA 스트림 조각 형태 미문서 —
    // 누적 answer가 점점 길어지는 부분 객체 3개 + 마지막 완전체(clues/threadId 포함)로 가정.
    const a = GA_ANSWER_MARKDOWN;
    return streamResponse(
      [
        JSON.stringify({ answer: a.slice(0, Math.floor(a.length / 4)) }),
        JSON.stringify({ answer: a.slice(0, Math.floor(a.length / 2)) }),
        JSON.stringify({ answer: a }),
        JSON.stringify(full),
      ],
      latencyMs,
    );
  }
  return jsonResponse(full);
}

/** §5.8 POST /webapi/v2/knowledge_base_nodes/search */
function handleKbSearch(body: KbSearchBody | undefined): Response {
  let nodes = [...KB_NODE_FIXTURES, ...uploadedNodes].filter((n) => !deletedNodeIds.has(n.id));
  const term = body?.filter_?.searchTerm;
  if (term) nodes = nodes.filter((n) => (n.name ?? '').includes(term));
  const types = body?.filter_?.nodeType;
  if (types?.length) {
    nodes = nodes.filter((n) => n.nodeType !== undefined && types.includes(n.nodeType));
  }
  const limit = body?.limit ?? 10;
  // ⚠️ ASSUMPTION: 목록 래퍼 키 미문서 — {"result":{"nodes":[...]}} 가정
  return jsonResponse({ result: { nodes: nodes.slice(0, limit) } });
}

/** §5.9 POST /webapi/v2/knowledge_base_nodes/upload */
function handleKbUpload(fd: FormData | undefined): Response {
  const rawName = fd?.get('fileName');
  const fileName = typeof rawName === 'string' && rawName !== '' ? rawName : 'unnamed.bin';
  const id = `kb-new-${++uploadCounter}`;
  // 실패 트리거 — fileName에 'fail' 포함 시 이후 인제스천이 실패 시퀀스를 탄다
  if (fileName.includes('fail')) failMarkedNodes.add(id);
  const hashtags = fd
    ? fd.getAll('hashtags').filter((v): v is string => typeof v === 'string')
    : [];
  const node: KbNode = {
    id,
    name: fileName,
    nodeType: 'file',
    hashtags,
    status: 'on',
    processState: 'initializing',
    createdAt: new Date().toISOString(),
  };
  uploadedNodes.push(node);
  // ⚠️ ASSUMPTION: §5.9 "노드 배열" 래퍼 미문서 — 검색(5.8)과 동일한 {"result":{"nodes":[...]}} 가정
  return jsonResponse({ result: { nodes: [node] } });
}

/** §5.11 GET /webapi/v2/ingestion_status/{kbId} — 호출마다 단계 진행 */
function handleIngestionStatus(kbId: string): Response {
  const n = ingestionCalls.get(kbId) ?? 0;
  ingestionCalls.set(kbId, n + 1);
  const seq: KbProcessState[] = failMarkedNodes.has(kbId)
    ? ['initializing', 'parsing', 'parsing_fail']
    : ['initializing', 'parsing', 'completed'];
  const idx = Math.min(n, seq.length - 1);
  const status = seq[idx];
  const steps = seq.slice(0, idx + 1).map((name, i) => ({
    name,
    status: i < idx ? 'done' : 'running',
  }));
  return jsonResponse({ status, steps });
}

/* ---------- 진입점 ---------- */

export function createMockFetch(opts: MockFetchOptions = {}): typeof fetch {
  const latencyMs = opts.latencyMs ?? 120;

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // 상대 경로 호출도 허용 — base는 매칭에 쓰지 않는다
    const u = new URL(url, 'http://mock.alli.local');
    const path = u.pathname;

    await delay(latencyMs);

    // 공통 인증: API-KEY 누락 또는 'invalid-key' → 403/7001 (§3.3)
    const apiKey = headers.get('API-KEY');
    if (!apiKey || apiKey === 'invalid-key') {
      return jsonResponse({ type: 'APIError', code: 7001, message: 'Invalid API Key' }, 403);
    }

    // 1. §5.1 프로젝트 (키 검증)
    if (method === 'GET' && path === '/webapi/v2/projects') return jsonResponse(PROJECT_FIXTURE);

    // 2. §5.2 앱 목록
    if (method === 'GET' && path === '/webapi/v2/apps') {
      const q = u.searchParams;
      let list = APP_FIXTURES.slice();
      const term = q.get('searchTerm');
      if (term) {
        list = list.filter((a) => a.name.includes(term) || (a.description ?? '').includes(term));
      }
      const type = q.get('type');
      if (type) list = list.filter((a) => a.type === type);
      const published = q.get('published');
      if (published !== null) list = list.filter((a) => a.published === (published === 'true'));
      const cursor = q.get('cursor');
      if (cursor) {
        const at = list.findIndex((a) => a.cursor === cursor);
        list = at >= 0 ? list.slice(at + 1) : [];
      }
      const pageSize = Number(q.get('pageSize') ?? '50') || 50;
      // ⚠️ ASSUMPTION: 목록 래퍼 키 미문서 — {"result":{"apps":[...]}} 가정 (Gate G1에서 검증)
      return jsonResponse({ result: { apps: list.slice(0, pageSize) } });
    }

    // 3. §5.3 앱 단건
    const mApp = path.match(/^\/webapi\/v2\/apps\/([^/]+)$/);
    if (method === 'GET' && mApp) {
      const app = APP_FIXTURES.find((a) => a.id === decodeURIComponent(mApp[1]));
      if (!app) return jsonResponse({ type: 'APIError', code: 7003, message: 'Invalid Parameter' }, 400);
      // ⚠️ ASSUMPTION: 단건도 result 래핑으로 가정
      return jsonResponse({ result: app });
    }

    // 4. §5.4 앱 실행 (v2 아님에 주의)
    const mRun = path.match(/^\/webapi\/apps\/([^/]+)\/run$/);
    if (method === 'POST' && mRun) {
      const body = (await readJsonBody(input, init)) as RunAppBody | undefined;
      return handleRun(decodeURIComponent(mRun[1]), body, latencyMs);
    }

    // 5. §5.5 대화형 앱 실행 (multipart, 항상 스트리밍)
    const mConv = path.match(/^\/webapi\/v2\/apps\/([^/]+)\/run_conversation$/);
    if (method === 'POST' && mConv) {
      return handleRunConversation(await readFormBody(input, init), latencyMs);
    }

    // 6. §5.6 생성형 답변
    if (method === 'POST' && path === '/webapi/generative_answer') {
      const body = (await readJsonBody(input, init)) as GenerativeAnswerBody | undefined;
      return handleGenerativeAnswer(body, headers.get('OWN-USER-ID') !== null, latencyMs);
    }

    // 7. §5.7 해시태그 목록
    if (method === 'GET' && path === '/webapi/hashtags') {
      return jsonResponse({ result: HASHTAGS_FIXTURE });
    }

    // 8. §5.8 KB 노드 검색
    if (method === 'POST' && path === '/webapi/v2/knowledge_base_nodes/search') {
      return handleKbSearch((await readJsonBody(input, init)) as KbSearchBody | undefined);
    }

    // 9. §5.9 KB 업로드
    if (method === 'POST' && path === '/webapi/v2/knowledge_base_nodes/upload') {
      return handleKbUpload(await readFormBody(input, init));
    }

    // 10. §5.10 KB 삭제 — 200 빈 본문
    const mDel = path.match(/^\/webapi\/v2\/knowledge_base_nodes\/([^/]+)$/);
    if (method === 'DELETE' && mDel) {
      deletedNodeIds.add(decodeURIComponent(mDel[1]));
      return new Response('', { status: 200 });
    }

    // 11. §5.11 인제스천 상태 (폴링 진행)
    const mIng = path.match(/^\/webapi\/v2\/ingestion_status\/([^/]+)$/);
    if (method === 'GET' && mIng) return handleIngestionStatus(decodeURIComponent(mIng[1]));

    // 13. §5.13 대화 전체 메시지 (pageNo 페이징, 페이지당 5건) — 12보다 먼저 매칭
    const mChats = path.match(/^\/webapi\/v2\/conversations\/([^/]+)\/chats$/);
    if (method === 'GET' && mChats) {
      const convId = decodeURIComponent(mChats[1]);
      const chats = conversationStore.get(convId) ?? DEFAULT_CONVERSATION_CHATS;
      const pageNo = Number(u.searchParams.get('pageNo') ?? '1') || 1;
      // ⚠️ ASSUMPTION: 래퍼 미문서 — {"result":{"chats":[...]}} 가정
      return jsonResponse({ result: { chats: chats.slice((pageNo - 1) * 5, pageNo * 5), pageNo } });
    }

    // 12. §5.12 대화 단건 (최근 챗 20개 포함)
    const mGet = path.match(/^\/webapi\/v2\/conversations\/([^/]+)$/);
    if (method === 'GET' && mGet) {
      const convId = decodeURIComponent(mGet[1]);
      const chats = conversationStore.get(convId) ?? DEFAULT_CONVERSATION_CHATS;
      // ⚠️ ASSUMPTION: 래퍼 미문서 — {"result":{...}} 가정
      return jsonResponse({ result: { id: convId, state: 'completed', chats: chats.slice(-20) } });
    }

    // 매칭 실패 — §3.3 비표준 에러 형태 재현
    return jsonResponse({ error: `Method Not Allowed ${method}: ${path}` }, 405);
  };

  return mockFetch as typeof fetch;
}
