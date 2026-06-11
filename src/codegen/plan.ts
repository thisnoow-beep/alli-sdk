/* 코드 생성 계약 — SSOT §7.
   산출물은 정확히 4개(3세트): curl ① / JavaScript(브라우저 fetch ② + Node.js ③) / Python requests ④.
   API 키는 컨텍스트에 절대 포함되지 않는다 — 생성 코드는 환경변수 ALLI_API_KEY를 읽고,
   브라우저 변형만 placeholder + "운영 브라우저 코드에 키 금지" 경고 주석을 쓴다. */

import type { RequestSpec } from '../core/request-spec';

export type Wrapper =
  | { kind: 'none' }
  /** Flow 4: threadId 보관·재전송 멀티턴 루프 (ask(query, threadId) 형태) */
  | { kind: 'ga-thread-loop' }
  /** Flow 6: 대화 시작 → conversationId 확보 → 후속 전송 루프 */
  | { kind: 'conversation-loop' }
  /** Flow 5: 업로드 → ingestion_status 폴링 → 성공 시 구 노드 삭제 / 실패 시 신규 노드 롤백 */
  | {
      kind: 'kb-replace';
      oldNodeId: string;
      pollInitialMs: number;
      pollMaxMs: number;
      pollTimeoutMs: number;
    };

export interface CodegenPlan {
  spec: RequestSpec;
  wrapper: Wrapper;
}

/** API 키는 여기 절대 넣지 않는다 */
export interface CodegenContext {
  baseUrl: string;
  /** Flow 1에서 설정된 OWN-USER-ID (원본 — 인코딩은 생성 코드 안에서) */
  ownUserId?: string;
  /** USER-EMAIL 설정 시 */
  userEmail?: string;
}

export type ArtifactVariant = 'curl' | 'browser' | 'node' | 'python';

export interface GeneratedArtifact {
  variant: ArtifactVariant;
  /** 3세트 그룹 라벨 */
  setLabel: 'curl' | 'JavaScript' | 'Python';
  /** 탭 제목, 예: 'Node.js (20+)' */
  title: string;
  language: 'bash' | 'javascript' | 'python';
  code: string;
}
