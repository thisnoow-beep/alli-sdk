/* DraftJS 폴백 — SSOT §3.4: answerFormat 미지정/일부 응답의 message가
   DraftJS JSON 문자열로 올 수 있음 → 표시 계층에서 감지 시 plain text 추출.

   판정 규칙 (M2): 문자열이 JSON 객체로 파싱되고, blocks 배열(각 원소에 string text)과
   entityMap 키를 가지면 DraftJS로 간주 → blocks[].text를 '\n'으로 join.
   아니면 null (DraftJS 아님). */

export function tryExtractDraftJs(s: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null; // JSON이 아니면 DraftJS 아님
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!('entityMap' in obj)) return null;
  const blocks = obj['blocks'];
  if (!Array.isArray(blocks)) return null;
  const texts: string[] = [];
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) return null;
    const text = (block as Record<string, unknown>)['text'];
    if (typeof text !== 'string') return null; // 원소 하나라도 string text가 없으면 DraftJS 아님
    texts.push(text);
  }
  // blocks가 비어 있으면 '' 반환 (DraftJS이긴 하므로 null이 아님)
  return texts.join('\n');
}
