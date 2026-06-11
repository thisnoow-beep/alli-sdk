/* 목 fetch — MSW 대신 fetch 호환 구현을 AlliClient에 주입한다.
   목적: 자격증명 없이 6개 Flow 전체를 개발/데모/테스트.
   요구사항 (M2):
   - 13개 엔드포인트 라우트 테이블 (fixtures.ts 사용)
   - 스트리밍 응답은 ReadableStream으로, 청크 경계를 픽스처 스크립트 그대로 내보냄
     (JSON 중간/문자열 중간/한글 멀티바이트 중간 분할 시나리오 포함)
   - 지연(latency) 시뮬레이션
   - 실패 트리거: API-KEY 'invalid-key' → 403/7001, run inputs 누락 → {"errors":"internal error. Expecting value: ..."},
     파일명에 'fail' 포함 업로드 → 인제스천 parsing_fail 시퀀스
   - ingestion_status는 kbId별로 호출마다 단계가 진행되는 상태 유지 */

export interface MockFetchOptions {
  latencyMs?: number;
}

export function createMockFetch(opts: MockFetchOptions = {}): typeof fetch {
  void opts;
  throw new Error('TODO(M2): createMockFetch 구현');
}
