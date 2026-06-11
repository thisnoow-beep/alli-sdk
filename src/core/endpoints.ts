/* 13개 엔드포인트의 순수 RequestSpec 빌더 — SSOT §5.
   fetch하지 않는다. 같은 spec이 실호출·미리보기·코드 생성에 공유된다. */

import type { MultipartPart, RequestSpec } from './request-spec';
import type {
  GenerativeAnswerBody,
  KbSearchBody,
  ListAppsQuery,
  RunAppBody,
} from './types';

export const specs = {
  /** §5.1 키 검증·프로젝트 정보 — 검증 용도로는 HTTP 200 여부만 사용 */
  projects(): RequestSpec {
    return { id: 'projects', method: 'GET', path: '/webapi/v2/projects', body: { kind: 'none' }, stream: false };
  },

  /** §5.2 앱 목록 (skill=대화형 앱, single_action=답변형 앱) */
  listApps(q: ListAppsQuery = {}): RequestSpec {
    return {
      id: 'list_apps',
      method: 'GET',
      path: '/webapi/v2/apps',
      query: {
        searchTerm: q.searchTerm || undefined,
        categories: q.categories?.length ? q.categories : undefined,
        type: q.type,
        published: q.published,
        pageSize: q.pageSize,
        cursor: q.cursor,
      },
      body: { kind: 'none' },
      stream: false,
    };
  },

  /** §5.3 앱 상세 — 입력 변수 정의는 없음 (§9-1) */
  getApp(appId: string): RequestSpec {
    return {
      id: 'get_app',
      method: 'GET',
      path: `/webapi/v2/apps/${encodeURIComponent(appId)}`,
      body: { kind: 'none' },
      stream: false,
    };
  },

  /** §5.4 앱 실행 ★핵심 — mode가 body에 들어가고, stream 소비 여부는 spec.stream */
  runApp(appId: string, body: RunAppBody): RequestSpec {
    return {
      id: 'run_app',
      method: 'POST',
      path: `/webapi/apps/${encodeURIComponent(appId)}/run`,
      body: { kind: 'json', value: body },
      stream: body.mode === 'stream',
    };
  },

  /** §5.5 대화형 앱 실행 (multipart) — 응답은 항상 스트리밍 */
  runConversation(appId: string, parts: MultipartPart[]): RequestSpec {
    return {
      id: 'run_conversation',
      method: 'POST',
      path: `/webapi/v2/apps/${encodeURIComponent(appId)}/run_conversation`,
      body: { kind: 'multipart', parts },
      stream: true,
    };
  },

  /** §5.6 생성형 답변 ★핵심 — answerFormat은 항상 MARKDOWN 강제 (§3.4) */
  generativeAnswer(body: GenerativeAnswerBody): RequestSpec {
    return {
      id: 'generative_answer',
      method: 'POST',
      path: '/webapi/generative_answer',
      body: { kind: 'json', value: { ...body, answerFormat: 'MARKDOWN' } },
      stream: body.mode === 'stream',
    };
  },

  /** §5.7 해시태그 목록 — Flow 4 필터 UI 구성용 */
  hashtags(): RequestSpec {
    return { id: 'hashtags', method: 'GET', path: '/webapi/hashtags', body: { kind: 'none' }, stream: false };
  },

  /** §5.8 문서(KB 노드) 검색 — 화면 "문서" 메뉴의 파일/폴더 */
  kbSearch(body: KbSearchBody): RequestSpec {
    return {
      id: 'kb_search',
      method: 'POST',
      path: '/webapi/v2/knowledge_base_nodes/search',
      body: { kind: 'json', value: body },
      stream: false,
    };
  },

  /** §5.9 문서 업로드 (multipart) — parts는 호출측에서 구성 (fileName/file/hashtags/...) */
  kbUpload(parts: MultipartPart[]): RequestSpec {
    return {
      id: 'kb_upload',
      method: 'POST',
      path: '/webapi/v2/knowledge_base_nodes/upload',
      body: { kind: 'multipart', parts },
      stream: false,
    };
  },

  /** §5.10 문서 삭제 — 200 빈 본문 */
  kbDelete(nodeId: string): RequestSpec {
    return {
      id: 'kb_delete',
      method: 'DELETE',
      path: `/webapi/v2/knowledge_base_nodes/${encodeURIComponent(nodeId)}`,
      body: { kind: 'none' },
      stream: false,
    };
  },

  /** §5.11 문서 처리 상태 (폴링) — 성공 completed/post_completed, 실패 parsing_fail/post_parsing_fail */
  ingestionStatus(kbId: string): RequestSpec {
    return {
      id: 'ingestion_status',
      method: 'GET',
      path: `/webapi/v2/ingestion_status/${encodeURIComponent(kbId)}`,
      body: { kind: 'none' },
      stream: false,
    };
  },

  /** §5.12 대화 단건 (최근 챗 20개 포함) */
  getConversation(conversationId: string, variables?: string[]): RequestSpec {
    return {
      id: 'get_conversation',
      method: 'GET',
      path: `/webapi/v2/conversations/${encodeURIComponent(conversationId)}`,
      query: variables?.length ? { variables } : undefined,
      body: { kind: 'none' },
      stream: false,
    };
  },

  /** §5.13 대화 전체 메시지 (pageNo 페이징) */
  getConversationChats(conversationId: string, pageNo = 1): RequestSpec {
    return {
      id: 'get_conversation_chats',
      method: 'GET',
      path: `/webapi/v2/conversations/${encodeURIComponent(conversationId)}/chats`,
      query: { pageNo },
      body: { kind: 'none' },
      stream: false,
    };
  },
} as const;
