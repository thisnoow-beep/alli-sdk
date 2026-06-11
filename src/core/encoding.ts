/* OWN-USER-ID 인코딩 — SSOT §3.2: 비ASCII 문자 불가 → 'base64:인코딩값' 형식.
   브라우저와 Node 20 모두에서 동작해야 한다 (테스트는 node 환경). */

export function isAscii(s: string): boolean {
  // 코드포인트 0x00~0x7F 전수 검사 — 0x7F 초과 코드포인트는 charCodeAt도 0x7F를 초과하므로 충분
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** ASCII면 그대로, 아니면 'base64:' + base64(utf8 바이트).
    예: encodeOwnUserId('홍길동') === 'base64:7ZmN6ri464+Z' */
export function encodeOwnUserId(id: string): string {
  if (isAscii(id)) return id; // 빈 문자열 포함 — ASCII는 변환 없이 그대로
  const bytes = new TextEncoder().encode(id);
  // String.fromCharCode(...전체)는 인자 개수 한도(스택)를 넘을 수 있어 청크 단위로 변환
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return 'base64:' + btoa(bin);
}
