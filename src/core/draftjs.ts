/* DraftJS 폴백 — SSOT §3.4: answerFormat 미지정/일부 응답의 message가
   DraftJS JSON 문자열로 올 수 있음 → 표시 계층에서 감지 시 plain text 추출.

   판정 규칙 (M2): 문자열이 JSON 객체로 파싱되고, blocks 배열(각 원소에 string text)과
   entityMap 키를 가지면 DraftJS로 간주 → blocks[].text를 '\n'으로 join.
   아니면 null (DraftJS 아님). */

export function tryExtractDraftJs(s: string): string | null {
  void s;
  throw new Error('TODO(M2): tryExtractDraftJs 구현');
}
