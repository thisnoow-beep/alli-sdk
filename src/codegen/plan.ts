/* 코드 생성 계약 — SSOT §7.
   산출물은 정확히 4개(3세트): curl ① / JavaScript(브라우저 ② + Node.js 프록시 ③) / Python requests ④.
   JavaScript는 Model A 구조 — 브라우저(②)는 같은 출처 프록시(/api)를 키 없이 호출(오케스트레이션은
   클라이언트), Node.js(③)는 플로우 무관 리버스 프록시로 키(process.env.ALLI_API_KEY)를 쥐고
   Alli로 포워딩한다. curl/python은 서버·CLI측이라 Alli를 직접 호출.
   API 키는 컨텍스트에 절대 포함되지 않으며(키는 ctx 밖), 어떤 변형에도 키 리터럴/placeholder를
   넣지 않는다 — curl/node/python은 환경변수 ALLI_API_KEY 전제(초기 설정에서 사전 안내). */

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
