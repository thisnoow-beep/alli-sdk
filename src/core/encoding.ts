/* OWN-USER-ID 인코딩 — SSOT §3.2: 비ASCII 문자 불가 → 'base64:인코딩값' 형식.
   브라우저와 Node 20 모두에서 동작해야 한다 (테스트는 node 환경). */

export function isAscii(s: string): boolean {
  void s;
  throw new Error('TODO(M2): isAscii 구현');
}

/** ASCII면 그대로, 아니면 'base64:' + base64(utf8 바이트).
    예: encodeOwnUserId('홍길동') === 'base64:7ZmN6ri464+Z' */
export function encodeOwnUserId(id: string): string {
  void id;
  throw new Error('TODO(M2): encodeOwnUserId 구현');
}
