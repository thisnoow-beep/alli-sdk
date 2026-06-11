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

/* 스캐너 모드 — 단일 패스 상태머신.
   idle      : 값 사이. 공백/쉼표/개행은 조용히 스킵.
   garbage   : 값 시작 문자가 아닌 잡텍스트 누적 중 (다음 값 시작 또는 end()에서 방출).
   container : {…} / […] 진행 중 — depth/inString/escaped 추적.
   string    : top-level 문자열 값 진행 중 — 닫는 따옴표에서 완성.
   primitive : top-level 숫자/true/false/null 진행 중 — 구분자(공백/쉼표/구조 문자)
               또는 버퍼 끝(end())이 와야 완성 (숫자가 push 경계에서 쪼개질 수 있으므로 대기). */
type Mode = 'idle' | 'garbage' | 'container' | 'string' | 'primitive';

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/* JSON 값이 시작될 수 있는 문자: { [ " 숫자 t f n -
   (이 외의 문자로 시작하면 잡텍스트로 본다 — 계약 주석 참조) */
function isValueStart(ch: string): boolean {
  return (
    ch === '{' ||
    ch === '[' ||
    ch === '"' ||
    ch === '-' ||
    (ch >= '0' && ch <= '9') ||
    ch === 't' ||
    ch === 'f' ||
    ch === 'n'
  );
}

/* 원시값 토큰을 구성할 수 있는 문자 — 숫자(지수·부호·소수점)와
   true/false/null 철자를 모두 덮는 보수적 집합. 여기에 안 맞으면 토큰 종료.
   잘못된 토큰("tru1x" 등)은 JSON.parse 실패로 garbage가 된다. */
function isPrimitiveChar(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '+' ||
    ch === '-' ||
    ch === '.'
  );
}

export function createJsonScanner(): JsonScanner {
  // 내부 버퍼 — push 종료 시 소비된 prefix를 잘라내 메모리를 제한한다.
  let buf = '';
  let pos = 0; // 다음 스캔 위치
  let tokenStart = 0; // 현재 값/garbage 토큰의 시작 인덱스 (valueStart 역할)
  let mode: Mode = 'idle';
  let depth = 0;
  let inString = false;
  let escaped = false;

  /* 완성된 슬라이스를 파싱 — 실패해도 절대 throw하지 않고 garbage로 강등 */
  function parseRaw(raw: string): ScanResult {
    try {
      return { kind: 'value', value: JSON.parse(raw) as unknown, raw };
    } catch {
      return { kind: 'garbage', raw };
    }
  }

  /* 값 시작 문자를 만났을 때 모드 전환 (호출 전에 garbage 플러시는 호출자 책임) */
  function startValue(ch: string): void {
    tokenStart = pos;
    if (ch === '{' || ch === '[') {
      mode = 'container';
      depth = 1;
      inString = false;
      escaped = false;
    } else if (ch === '"') {
      mode = 'string';
      escaped = false;
    } else {
      mode = 'primitive';
    }
    pos += 1;
  }

  function reset(): void {
    buf = '';
    pos = 0;
    tokenStart = 0;
    mode = 'idle';
    depth = 0;
    inString = false;
    escaped = false;
  }

  function push(text: string): ScanResult[] {
    buf += text;
    const out: ScanResult[] = [];

    while (pos < buf.length) {
      const ch = buf.charAt(pos);

      switch (mode) {
        case 'idle': {
          if (isWhitespace(ch) || ch === ',') {
            pos += 1; // 값 밖의 공백/쉼표/개행은 조용히 스킵
          } else if (isValueStart(ch)) {
            startValue(ch);
          } else {
            mode = 'garbage';
            tokenStart = pos;
            pos += 1;
          }
          break;
        }

        case 'garbage': {
          if (isValueStart(ch)) {
            // 다음 값 시작 → 누적된 잡텍스트 방출 후 값 시작
            out.push({ kind: 'garbage', raw: buf.slice(tokenStart, pos) });
            startValue(ch);
          } else {
            pos += 1;
          }
          break;
        }

        case 'container': {
          if (inString) {
            // 문자열 내부 — {}/[]는 깊이 계산 제외, \" 이스케이프 존중
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
          } else if (ch === '"') {
            inString = true;
          } else if (ch === '{' || ch === '[') {
            depth += 1;
          } else if (ch === '}' || ch === ']') {
            depth -= 1;
            if (depth === 0) {
              // depth 0 복귀 → 슬라이스 후 파싱 (괄호 짝 불일치 등은 parse 실패 → garbage)
              out.push(parseRaw(buf.slice(tokenStart, pos + 1)));
              mode = 'idle';
            }
          }
          pos += 1;
          break;
        }

        case 'string': {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') {
            out.push(parseRaw(buf.slice(tokenStart, pos + 1)));
            mode = 'idle';
          }
          pos += 1;
          break;
        }

        case 'primitive': {
          if (isPrimitiveChar(ch)) {
            pos += 1;
          } else {
            // 구분자 도달 → 토큰 확정. 구분자 문자 자체는 idle에서 재처리.
            out.push(parseRaw(buf.slice(tokenStart, pos)));
            mode = 'idle';
          }
          break;
        }
      }
    }

    // 소비된 prefix 잘라내기 — 진행 중인 토큰만 버퍼에 남긴다
    if (mode === 'idle') {
      buf = '';
      pos = 0;
      tokenStart = 0;
    } else if (tokenStart > 0) {
      buf = buf.slice(tokenStart);
      pos -= tokenStart;
      tokenStart = 0;
    }
    return out;
  }

  function end(): ScanResult[] {
    const out: ScanResult[] = [];
    if (mode !== 'idle') {
      const raw = buf.slice(tokenStart, pos);
      if (raw.length > 0) {
        if (mode === 'primitive') {
          // 버퍼 끝도 원시값의 유효한 구분자 — 완전한 토큰이면 값, 아니면 garbage
          out.push(parseRaw(raw));
        } else {
          // 미완성 container/string 또는 잡텍스트 → garbage 플러시
          out.push({ kind: 'garbage', raw });
        }
      }
    }
    reset();
    return out;
  }

  return { push, end };
}
