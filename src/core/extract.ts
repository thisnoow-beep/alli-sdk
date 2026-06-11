/* 미문서화 응답에서 데이터를 견고하게 추출하는 헬퍼들.
   §9-2 (run_conversation 스트림 스키마 미문서화)·§9-3 (run 응답 이중 형태) 대응.
   Gate G1(실 API 검증)에서 실제 경로가 확정되면 우선 경로를 고정하되 deep-scan은 폴백으로 유지. */

export interface ExtractedMessage {
  text: string;
  /** DraftJS JSON에서 추출된 텍스트인지 (배지 표시용) */
  viaDraftJs: boolean;
}

/** BFS(최대 깊이 8)로 conversationId를 찾는다.
    매칭(대소문자 무시): 키 'conversationId' | 'conversation_id' | 'convId',
    또는 키 'conversation' 아래 객체의 string 'id'. 첫 번째 비어있지 않은 문자열 반환. */
export function deepFindConversationId(value: unknown): string | undefined {
  void value;
  throw new Error('TODO(M2): deepFindConversationId 구현');
}

/** run 응답(§5.4)에서 메시지들 추출 — result.responses[](v2)와 result.choices[](레거시) 모두 대응.
    각 message 문자열은 tryExtractDraftJs를 먼저 시도. */
export function extractRunMessages(runResponse: unknown): ExtractedMessage[] {
  void runResponse;
  throw new Error('TODO(M2): extractRunMessages 구현');
}

/** 스트림 JSON 조각에서 사람이 읽을 텍스트 후보 추출 (후보 키: message, text, answer — BFS).
    문자열 값은 tryExtractDraftJs 먼저 시도. 없으면 null. */
export function extractStreamText(value: unknown): string | null {
  void value;
  throw new Error('TODO(M2): extractStreamText 구현');
}

/** 앱 목록 응답 정규화 — 목록 래퍼 키가 OpenAPI에 미상세하므로
    deep-scan으로 { id, name, type }을 가진 객체 배열을 찾는다. nextCursor는 마지막 항목의 cursor. */
export function extractAppsList(resp: unknown): { apps: import('./types').AppInfo[]; nextCursor?: string } {
  void resp;
  throw new Error('TODO(M2): extractAppsList 구현');
}

/** KB 검색 응답 정규화 — { id, nodeType? }를 가진 객체 배열을 deep-scan */
export function extractKbNodes(resp: unknown): { nodes: import('./types').KbNode[]; nextCursor?: string } {
  void resp;
  throw new Error('TODO(M2): extractKbNodes 구현');
}
