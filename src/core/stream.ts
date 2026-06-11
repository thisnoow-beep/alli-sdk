/* 스트리밍 JSON 스캐너 — SSOT §3.5: stream은 SSE가 아니라
   "sync와 동일 포맷의 JSON 조각"이 텍스트로 흘러온다.
   누적 버퍼에서 완성된 최상위 JSON 값을 증분 추출한다.

   구현 규칙 (M2):
   - 상태: { depth, inString, escaped, valueStart } 단일 패스.
   - 문자열 내부의 {}/[] 는 깊이 계산 제외, \" 이스케이프 존중.
   - 값 시작 문자가 아닌 잡텍스트(예: 미문서화 프리픽스)는 throw하지 않고
     'garbage' 결과로 노출한다 (§9-2 안전판 — raw 뷰에서 가시화).
   - depth가 0으로 복귀하면 슬라이스 후 JSON.parse — 실패 시 garbage.
   - end()는 잔여 partial을 garbage로 플러시 ("스트림이 불완전하게 종료됨" 경고용).
   - 호출자는 TextDecoder('utf-8', { stream: true })로 디코딩한 텍스트를 push한다
     (한글 멀티바이트가 청크 경계에서 쪼개지는 것은 디코더 레이어가 처리). */

export type ScanResult =
  | { kind: 'value'; value: unknown; raw: string }
  | { kind: 'garbage'; raw: string };

export interface JsonScanner {
  /** 디코딩된 텍스트 조각을 누적하고, 새로 완성된 결과들을 반환 */
  push(text: string): ScanResult[];
  /** 스트림 종료 — 잔여 partial을 garbage로 플러시 */
  end(): ScanResult[];
}

export function createJsonScanner(): JsonScanner {
  throw new Error('TODO(M2): createJsonScanner 구현');
}
