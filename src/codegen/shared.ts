/* 코드 생성 공통 유틸 — SSOT §7.
   - 이스케이프: 셸 single/double quote, JS 문자열/템플릿 리터럴, Python 문자열/f-string
   - JSON → JS/Python 리터럴 렌더러 (§7-6: true→True / false→False / null→None)
   - 브라우저·Node 공용 JavaScript 빌더 — 두 변형은 ①키 주입 ②파일 첨부 ③스트림 소비만 다르다
   - 생성 코드에 동봉하는 헬퍼 스니펫 (encodeOwnUserId / raiseForStatus / extractJsonValues 등)
   원칙: 생성 코드는 "그대로 실행 가능" — 선언 순서·상단 import·한국어 주석 (SSOT §7). */

import type { CodegenContext, CodegenPlan, Wrapper } from './plan';
import type { MultipartPart, RequestSpec } from '../core/request-spec';
import { buildUrl } from '../core/request-spec';

export type KbReplaceWrapper = Extract<Wrapper, { kind: 'kb-replace' }>;
export type JsTarget = 'browser' | 'node';

/* ---------- 이스케이프 ---------- */

/** 셸 single-quote 리터럴 — ' 는 '\'' 로 (POSIX, §7-6) */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** 셸 double-quote("...") 내부에 들어갈 리터럴 이스케이프 */
export function shDouble(s: string): string {
  return s.replace(/[\\"`$]/g, (m) => '\\' + m);
}

/** JS 문자열 리터럴 (큰따옴표) — JSON.stringify가 정확한 이스케이프 */
export function jsStr(s: string): string {
  return JSON.stringify(s);
}

/** JS 템플릿 리터럴 내부에 안전하게 들어갈 리터럴 */
export function jsTpl(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Python 문자열 리터럴 (큰따옴표) — 한글 등 비ASCII는 그대로 유지 (§7-6) */
export function pyStr(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return `"${out}"`;
}

/** Python f-string의 리터럴 부분 — 중괄호는 {{ }} 로 */
export function pyFStr(s: string): string {
  return s.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

/* ---------- 리터럴 렌더러 ---------- */

/** JSON → JS 객체 리터럴 — JSON.stringify(value, null, 2) 그대로 유효한 JS (§7-6) */
export function renderJsValue(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? 'null';
}

/** JSON → Python 리터럴 — true→True / false→False / null→None, 문자열은 pyStr (§7-6) */
export function renderPyValue(v: unknown, level = 0): string {
  const pad = '    '.repeat(level);
  const childPad = '    '.repeat(level + 1);
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None';
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map((item) => childPad + renderPyValue(item, level + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, val]) => `${childPad}${pyStr(k)}: ${renderPyValue(val, level + 1)}`);
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return 'None';
}

/** 멀티라인 텍스트의 2행 이후를 pad만큼 들여쓴다 (리터럴 임베드용) */
export function indentTail(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l, i) => (i === 0 ? l : pad + l))
    .join('\n');
}

/* ---------- spec 접근 헬퍼 ---------- */

/** baseUrl 끝 슬래시 제거 — buildUrl과 동일 규칙 */
export function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** 경로+쿼리스트링 — 인코딩은 실호출(buildUrl)과 동일, 배열은 반복 파라미터 (§7-8) */
export function pathWithQuery(spec: RequestSpec): string {
  return buildUrl('', spec);
}

/** JSON body를 평범한 객체로 — 객체가 아니면 빈 객체 (wrapper 베이스 페이로드용) */
export function jsonBodyValue(spec: RequestSpec): Record<string, unknown> {
  if (spec.body.kind !== 'json') return {};
  const v = spec.body.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

export function omitKeys(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

export function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function multipartParts(spec: RequestSpec): MultipartPart[] {
  return spec.body.kind === 'multipart' ? spec.body.parts : [];
}

export function fileNameOf(part: MultipartPart): string | undefined {
  return part.file?.name || undefined;
}

/* ---------- 공통 문구 ---------- */

/** 에러 코드표 요약 (SSOT §3.3) — 변형별 주석 마커를 앞에 붙여 사용 (§7-4).
    생성 코드에 들어가는 문구이므로 SSOT 절 번호 등 내부 문서 참조 금지 — 그 자체로 읽혀야 한다. */
export const ERROR_TABLE_LINES: readonly string[] = [
  'Alli API 에러 코드표 — 응답 본문의 code/error/errors 키 해석:',
  '  7001 잘못된 API 키 (sdkKey와 혼동 주의) / 7002 요청 본문 JSON 디코딩 실패',
  '  7003 파라미터 누락·형식 오류 / 7004 결제(과금) 오류',
  "  errors에 'Expecting value' 포함 시 inputs 누락/형식 오류 가능성",
];

export const GA_FOLLOW_UP = '방금 답변을 더 자세히 설명해줘';
export const CONV_FOLLOW_UP = '여기에 후속 메시지를 입력하세요';

/* ---------- 생성 JS에 동봉하는 헬퍼 스니펫 ---------- */

export const JS_ENCODE_OWN_USER_ID = `// 비ASCII OWN-USER-ID/USER-EMAIL → 'base64:' + base64(utf8) 변환 — Alli API 헤더 규칙
function encodeOwnUserId(id) {
  if (/^[\\x00-\\x7F]*$/.test(id)) return id; // ASCII는 그대로
  const bytes = new TextEncoder().encode(id);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "base64:" + btoa(bin);
}`;

export const JS_RAISE_FOR_STATUS = `// 에러 처리 — HTTP status 분기 + 본문 code/error/errors 해석
// 코드표: 7001 잘못된 API 키(sdkKey와 혼동 주의) / 7002 요청 본문 JSON 디코딩 실패
//        7003 파라미터 누락·형식 오류 / 7004 결제(과금) 오류
async function raiseForStatus(res) {
  if (res.ok) return;
  const text = await res.text();
  let detail = text;
  try {
    const body = JSON.parse(text);
    const table = {
      7001: "잘못된 API 키 — Settings > General의 REST API 키인지, sdkKey와 혼동하지 않았는지 확인",
      7002: "요청 본문 JSON 디코딩 실패",
      7003: "파라미터 누락/형식 오류",
      7004: "결제/과금 오류 (연체 등)",
    };
    if (body.code && table[body.code]) detail = body.code + " " + table[body.code];
    else if (body.error) detail = String(body.error); // 비표준 형태: { "error": "..." }
    else if (body.errors) {
      detail = String(body.errors); // 비표준 형태: { "errors": "..." }
      // 'Expecting value'가 보이면 inputs 누락/형식 오류 가능성이 크다
      if (detail.includes("Expecting value")) detail += " — inputs 누락/형식 오류 가능성";
    } else if (body.message) detail = String(body.message);
  } catch {
    // 본문이 JSON이 아니면 원문 그대로 노출
  }
  throw new Error("HTTP " + res.status + ": " + detail);
}`;

export const JS_EXTRACT_JSON_VALUES = `// 스트림 버퍼에서 완성된 최상위 JSON 값만 잘라 파싱 (Alli 스트리밍은 SSE가 아니라 JSON 조각 스트림)
// 중괄호 깊이 추적 — 문자열 내부의 {}/[]와 \\" 이스케이프는 깊이 계산에서 제외한다.
// 미완성 조각은 rest로 돌려줘 다음 청크와 이어 붙인다.
function extractJsonValues(buffer) {
  const values = [];
  let depth = 0, inString = false, escaped = false, start = -1, consumed = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if ((ch === "}" || ch === "]") && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { values.push(JSON.parse(buffer.slice(start, i + 1))); } catch { /* 잡텍스트는 건너뜀 */ }
        consumed = i + 1;
        start = -1;
      }
    }
  }
  return { values, rest: buffer.slice(start >= 0 ? start : consumed) };
}`;

export const JS_FIND_CONVERSATION_ID = `// conversationId deep-scan — 응답 스키마가 공식 문서에 없어 트리 전체를 탐색.
// 실 응답 확인 후 정확한 경로로 고정하기를 권장.
function findConversationId(value) {
  if (value === null || typeof value !== "object") return null;
  if (typeof value.conversationId === "string") return value.conversationId;
  if (value.conversation && typeof value.conversation.id === "string") return value.conversation.id;
  for (const child of Object.values(value)) {
    const found = findConversationId(child);
    if (found) return found;
  }
  return null;
}`;

export const JS_EXTRACT_NODE_ID = `// 업로드 응답에서 새 노드 id 추출 — 노드 배열이 래핑돼 있어도 동작하도록 deep-scan
function extractNodeId(value) {
  if (value === null || typeof value !== "object") return null;
  if (typeof value.id === "string") return value.id;
  for (const child of Object.values(value)) {
    const found = extractNodeId(child);
    if (found) return found;
  }
  return null;
}`;

/* ---------- 브라우저·Node 공용 JavaScript 빌더 ---------- */

function jsHeadersBlock(ctx: CodegenContext, target: JsTarget): string {
  // 브라우저는 프록시가 키를 주입하므로 API-KEY를 싣지 않는다 (Model A)
  const L = [
    target === 'browser'
      ? '// 공통 헤더 — API 키는 프록시가 주입하므로 브라우저에는 없음'
      : '// 공통 헤더 — API-KEY 필수',
    'const HEADERS = {',
  ];
  if (target !== 'browser') L.push('  "API-KEY": API_KEY,');
  if (ctx.ownUserId) {
    L.push(`  "OWN-USER-ID": encodeOwnUserId(${jsStr(ctx.ownUserId)}), // 비ASCII는 base64: 로 자동 변환`);
  }
  if (ctx.userEmail) L.push(`  "USER-EMAIL": encodeOwnUserId(${jsStr(ctx.userEmail)}),`);
  L.push('};');
  return L.join('\n');
}

function jsUrlOf(spec: RequestSpec): string {
  return '`${BASE_URL}' + jsTpl(pathWithQuery(spec)) + '`';
}

function jsFetchJson(spec: RequestSpec, pad: string): string[] {
  return [
    `${pad}const res = await fetch(${jsUrlOf(spec)}, {`,
    `${pad}  method: ${jsStr(spec.method)},`,
    `${pad}  headers: { ...HEADERS, "Content-Type": "application/json" }, // JSON 본문만 Content-Type 명시`,
    `${pad}  body: JSON.stringify(payload),`,
    `${pad}});`,
  ];
}

function jsFetchMultipart(spec: RequestSpec, pad: string): string[] {
  return [
    `${pad}const res = await fetch(${jsUrlOf(spec)}, {`,
    `${pad}  method: ${jsStr(spec.method)},`,
    `${pad}  headers: HEADERS, // multipart는 Content-Type 직접 지정 금지 — FormData가 boundary 자동 설정`,
    `${pad}  body: fd,`,
    `${pad}});`,
  ];
}

function jsFetchBare(spec: RequestSpec, pad: string): string[] {
  if (spec.method === 'GET') {
    return [`${pad}const res = await fetch(${jsUrlOf(spec)}, { headers: HEADERS });`];
  }
  return [`${pad}const res = await fetch(${jsUrlOf(spec)}, { method: ${jsStr(spec.method)}, headers: HEADERS });`];
}

/** 브라우저 변형의 파일 입력 선언 (§7-7) */
function jsFileInputDecl(parts: MultipartPart[], target: JsTarget, pad: string): string[] {
  if (target !== 'browser' || !parts.some((p) => p.kind === 'file')) return [];
  return [`${pad}// <input type=file>에서:`, `${pad}const fileInput = document.querySelector('input[type="file"]');`];
}

/** fd.append(...) 라인들 — parts 순서 그대로 1:1 (§7-7 패리티 대상) */
function jsPartAppends(parts: MultipartPart[], target: JsTarget, pad: string): string[] {
  const L: string[] = [];
  let fileIdx = 0;
  for (const p of parts) {
    if (p.kind === 'text') {
      L.push(`${pad}fd.append(${jsStr(p.name)}, ${jsStr(p.value ?? '')});`);
    } else if (target === 'browser') {
      const fname = fileNameOf(p);
      L.push(`${pad}fd.append(${jsStr(p.name)}, fileInput.files[${fileIdx}]${fname ? `, ${jsStr(fname)}` : ''});`);
      fileIdx += 1;
    } else {
      const fname = fileNameOf(p);
      const filePath = fname ? `./${fname}` : 'FILE_PATH';
      L.push(
        `${pad}fd.append(${jsStr(p.name)}, new Blob([await readFile(${jsStr(filePath)})])${fname ? `, ${jsStr(fname)}` : ''});`,
      );
    }
  }
  return L;
}

/** 스트림 소비 — browser: getReader / node: for await (§7-5) */
function jsStreamConsume(target: JsTarget, pad: string, onValue: string[]): string[] {
  const L: string[] = [`${pad}await raiseForStatus(res);`];
  L.push(`${pad}const decoder = new TextDecoder("utf-8");`);
  L.push(`${pad}let buffer = "";`);
  if (target === 'browser') {
    L.push(`${pad}const reader = res.body.getReader();`);
    L.push(`${pad}for (;;) {`);
    L.push(`${pad}  const { done, value } = await reader.read();`);
    L.push(`${pad}  if (done) break;`);
    L.push(`${pad}  buffer += decoder.decode(value, { stream: true }); // 한글 멀티바이트가 청크 경계에서 쪼개져도 안전`);
  } else {
    L.push(`${pad}// Node 20: res.body(웹 ReadableStream)는 async iterable — for await로 청크 소비`);
    L.push(`${pad}for await (const chunk of res.body) {`);
    L.push(`${pad}  buffer += decoder.decode(chunk, { stream: true }); // 한글 멀티바이트가 청크 경계에서 쪼개져도 안전`);
  }
  L.push(`${pad}  const { values, rest } = extractJsonValues(buffer);`);
  L.push(`${pad}  buffer = rest; // 미완성 조각은 다음 청크와 이어 붙인다`);
  L.push(`${pad}  for (const v of values) {`);
  for (const l of onValue) L.push(`${pad}    ${l}`);
  L.push(`${pad}  }`);
  L.push(`${pad}}`);
  return L;
}

function jsSyncConsume(spec: RequestSpec, pad: string): string[] {
  const L = [`${pad}await raiseForStatus(res);`];
  if (spec.method === 'DELETE') {
    L.push(`${pad}console.log("삭제 완료 — HTTP", res.status); // 삭제 성공은 200 + 빈 본문`);
  } else {
    L.push(`${pad}const data = await res.json();`, `${pad}console.log(data);`);
  }
  return L;
}

function jsMainCall(target: JsTarget, fnName = 'main'): string {
  return target === 'node'
    ? `${fnName}().catch((err) => {\n  console.error(err);\n  process.exitCode = 1;\n});`
    : `${fnName}().catch(console.error);`;
}

/* --- wrapper: none --- */

function jsNoneMain(spec: RequestSpec, target: JsTarget): string {
  const L: string[] = ['async function main() {'];
  if (spec.body.kind === 'json') {
    L.push(`  const payload = ${indentTail(renderJsValue(spec.body.value), '  ')};`);
    L.push('');
    L.push(...jsFetchJson(spec, '  '));
  } else if (spec.body.kind === 'multipart') {
    L.push(...jsFileInputDecl(spec.body.parts, target, '  '));
    L.push('  const fd = new FormData(); // 화면에서 구성한 파트 순서 그대로 1:1');
    L.push(...jsPartAppends(spec.body.parts, target, '  '));
    L.push('');
    L.push(...jsFetchMultipart(spec, '  '));
  } else {
    L.push(...jsFetchBare(spec, '  '));
  }
  if (spec.stream) {
    L.push(...jsStreamConsume(target, '  ', ['console.log(v); // JSON 조각 — sync 응답과 동일 포맷']));
  } else {
    L.push(...jsSyncConsume(spec, '  '));
  }
  L.push('}', '', jsMainCall(target));
  return L.join('\n');
}

/* --- wrapper: ga-thread-loop (Flow 4) --- */

function jsGaThreadLoop(spec: RequestSpec, target: JsTarget): string {
  const body = jsonBodyValue(spec);
  const base = { ...omitKeys(body, ['query', 'threadId']), isStateful: true };
  const firstQuery = stringField(body, 'query') ?? '첫 질문을 입력하세요';
  const L: string[] = [];
  L.push('// 멀티턴 베이스 페이로드 — query/threadId는 ask() 인자로 주입');
  L.push(`const BASE_PAYLOAD = ${renderJsValue(base)};`);
  L.push('');
  L.push('// ⚠️ OWN-USER-ID 헤더 없으면 threadId(멀티턴)가 비활성화됩니다');
  L.push('// ask(query, threadId) → { answer, threadId } — 응답의 threadId를 후속 호출에 재사용');
  L.push('async function ask(query, threadId) {');
  L.push('  const payload = { ...BASE_PAYLOAD, query };');
  L.push('  if (threadId) payload.threadId = threadId; // 첫 호출엔 생략 — 응답이 새 threadId를 발급');
  L.push(...jsFetchJson(spec, '  '));
  if (spec.stream) {
    L.push('  let answer = null;');
    L.push('  let nextThreadId = threadId ?? null;');
    L.push(
      ...jsStreamConsume(target, '  ', [
        'if (v && typeof v === "object") { // JSON 조각 — sync 응답과 동일 포맷',
        '  if (v.answer !== undefined) answer = v.answer;',
        '  if (typeof v.threadId === "string") nextThreadId = v.threadId;',
        '}',
      ]),
    );
    L.push('  return { answer, threadId: nextThreadId };');
  } else {
    L.push('  await raiseForStatus(res);');
    L.push('  const data = await res.json();');
    L.push('  return { answer: data.answer, threadId: data.threadId };');
  }
  L.push('}');
  L.push('');
  L.push('async function main() {');
  L.push('  // 1차 질문 — threadId 없이 시작');
  L.push(`  const first = await ask(${jsStr(firstQuery)});`);
  L.push('  console.log("답변 1:", first.answer);');
  L.push('');
  L.push('  // 2차 질문 — 1차 응답의 threadId를 재사용해 맥락 유지 (멀티턴)');
  L.push(`  const second = await ask(${jsStr(GA_FOLLOW_UP)}, first.threadId);`);
  L.push('  console.log("답변 2:", second.answer);');
  L.push('}', '', jsMainCall(target));
  return L.join('\n');
}

/* --- wrapper: conversation-loop (Flow 6) --- */

function jsConversationLoop(spec: RequestSpec, target: JsTarget): string {
  const parts = multipartParts(spec);
  const extras = parts.filter((p) => !(p.kind === 'text' && (p.name === 'message' || p.name === 'conversationId')));
  const messagePart = parts.find((p) => p.kind === 'text' && p.name === 'message');
  const firstMessage = messagePart?.value || '안녕하세요';
  const L: string[] = [];
  L.push('// sendMessage(message, conversationId) — 전송 + 스트림 소비 + conversationId 회수');
  L.push('async function sendMessage(message, conversationId) {');
  L.push('  const fd = new FormData();');
  L.push('  if (conversationId) {');
  L.push('    fd.append("conversationId", conversationId); // 기존 대화 이어가기');
  L.push('  }');
  L.push('  fd.append("message", message);');
  if (extras.length > 0) {
    L.push('  if (!conversationId) {');
    L.push('    // 첫 메시지에만 포함 — 현재 입력값의 추가 필드/첨부');
    L.push(...jsFileInputDecl(extras, target, '    '));
    L.push(...jsPartAppends(extras, target, '    '));
    L.push('  }');
  }
  L.push(...jsFetchMultipart(spec, '  '));
  L.push('  let foundId = conversationId ?? null;');
  L.push(
    ...jsStreamConsume(target, '  ', [
      'console.log(v); // JSON 조각 — sync 응답과 동일 포맷',
      'if (!foundId) foundId = findConversationId(v);',
    ]),
  );
  L.push('  return foundId;');
  L.push('}');
  L.push('');
  L.push('async function main() {');
  L.push('  // 1) conversationId 없이 새 대화 시작 — 응답 스트림이 새 conversationId를 발급');
  L.push(`  const conversationId = await sendMessage(${jsStr(firstMessage)});`);
  L.push('  if (!conversationId) {');
  L.push('    throw new Error("스트림에서 conversationId를 찾지 못했습니다 — 응답 위치가 환경마다 다를 수 있으니 실제 응답 본문에서 확인하세요");');
  L.push('  }');
  L.push('  console.log("conversationId:", conversationId);');
  L.push('');
  L.push('  // 2) 후속 메시지 루프 — conversationId를 유지한 채 반복 전송');
  L.push(`  const followUps = [${jsStr(CONV_FOLLOW_UP)}];`);
  L.push('  for (const msg of followUps) {');
  L.push('    await sendMessage(msg, conversationId);');
  L.push('  }');
  L.push('}', '', jsMainCall(target));
  return L.join('\n');
}

/* --- wrapper: kb-replace (Flow 5) --- */

function jsKbReplace(spec: RequestSpec, w: KbReplaceWrapper, target: JsTarget): string {
  const parts = multipartParts(spec);
  const L: string[] = [];
  L.push(`const OLD_NODE_ID = ${jsStr(w.oldNodeId)}; // 교체 대상(구) 노드`);
  L.push(`const POLL_INITIAL_MS = ${w.pollInitialMs}; // 폴링 초기 간격`);
  L.push(`const POLL_MAX_MS = ${w.pollMaxMs}; // 백오프 최대 간격`);
  L.push(`const POLL_TIMEOUT_MS = ${w.pollTimeoutMs}; // 폴링 타임아웃`);
  L.push('');
  L.push('const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));');
  L.push('');
  L.push('async function deleteNode(nodeId) {');
  L.push('  const res = await fetch(`${BASE_URL}/webapi/v2/knowledge_base_nodes/${encodeURIComponent(nodeId)}`, {');
  L.push('    method: "DELETE",');
  L.push('    headers: HEADERS,');
  L.push('  });');
  L.push('  await raiseForStatus(res);');
  L.push('}');
  L.push('');
  L.push('// 문서 교체 루틴 — 순서: 업로드 → 완료 확인 → 삭제 (먼저 지우면 문서 소실/검색 공백이 생기므로 역순 금지)');
  L.push('async function replaceDocument() {');
  L.push('  // 1) 새 파일 업로드 (구 노드의 hashtags 승계, 같은 폴더 지정 권장)');
  L.push(...jsFileInputDecl(parts, target, '  '));
  L.push('  const fd = new FormData(); // 화면에서 구성한 파트 순서 그대로 1:1');
  L.push(...jsPartAppends(parts, target, '  '));
  L.push(`  const upRes = await fetch(${jsUrlOf(spec)}, {`);
  L.push(`    method: ${jsStr(spec.method)},`);
  L.push('    headers: HEADERS, // multipart는 Content-Type 직접 지정 금지 — FormData가 boundary 자동 설정');
  L.push('    body: fd,');
  L.push('  });');
  L.push('  await raiseForStatus(upRes);');
  L.push('  const newNodeId = extractNodeId(await upRes.json());');
  L.push('  if (!newNodeId) throw new Error("업로드 응답에서 새 노드 id를 찾지 못했습니다");');
  L.push('  console.log("업로드 완료 — 새 노드:", newNodeId);');
  L.push('');
  L.push('  // 2) ingestion_status 폴링 — 성공: completed/post_completed, 실패: parsing_fail/post_parsing_fail');
  L.push('  //    initializing/parsing/retrying/post_retrying 등 진행 상태는 계속 대기 (백오프)');
  L.push('  const deadline = Date.now() + POLL_TIMEOUT_MS;');
  L.push('  let interval = POLL_INITIAL_MS;');
  L.push('  for (;;) {');
  L.push('    const stRes = await fetch(`${BASE_URL}/webapi/v2/ingestion_status/${encodeURIComponent(newNodeId)}`, {');
  L.push('      headers: HEADERS,');
  L.push('    });');
  L.push('    await raiseForStatus(stRes);');
  L.push('    const { status } = await stRes.json();');
  L.push('    console.log("ingestion status:", status);');
  L.push('    if (status === "completed" || status === "post_completed") break; // 성공');
  L.push('    if (status === "parsing_fail" || status === "post_parsing_fail") {');
  L.push('      await deleteNode(newNodeId); // 실패 → 새 노드 롤백 삭제 (구 문서는 그대로 유지)');
  L.push('      throw new Error(`인제스천 실패(${status}) — 새 노드를 롤백 삭제했습니다`);');
  L.push('    }');
  L.push('    if (Date.now() >= deadline) {');
  L.push('      await deleteNode(newNodeId); // 타임아웃 → 롤백');
  L.push('      throw new Error("인제스천 타임아웃 — 새 노드를 롤백 삭제했습니다");');
  L.push('    }');
  L.push('    await sleep(interval);');
  L.push('    interval = Math.min(interval * 2, POLL_MAX_MS); // 백오프');
  L.push('  }');
  L.push('');
  L.push('  // 3) 성공 → 구 노드 삭제 (여기까지 신·구 문서가 잠시 공존 — 역순 금지)');
  L.push('  await deleteNode(OLD_NODE_ID);');
  L.push('  console.log("교체 완료:", OLD_NODE_ID, "→", newNodeId);');
  L.push('  return newNodeId;');
  L.push('}', '', jsMainCall(target, 'replaceDocument'));
  return L.join('\n');
}

/* ---------- Node.js 리버스 프록시 (Model A) ---------- */
/** Node.js 변형 — 플로우 무관 범용 리버스 프록시.
    브라우저(프론트)의 /api/* 요청을 Alli로 포워딩하며 API-KEY를 주입한다 (키는 이 서버에만 존재).
    플로우 오케스트레이션은 브라우저(클라이언트)가 맡으므로 이 서버 코드는 모든 플로우에서 동일하다. */
function renderNodeProxy(ctx: CodegenContext): string {
  return [
    '// Node.js 20+ 리버스 프록시 — 브라우저(프론트)의 /api/* 요청을 Alli 백엔드로 포워딩합니다.',
    '// API 키는 이 서버에만 둡니다(process.env.ALLI_API_KEY) — 브라우저로 내려가지 않습니다.',
    '// 외부 패키지 불필요(내장 http/fetch/stream만 사용). 실행: node proxy.mjs',
    '',
    'import { createServer } from "node:http";',
    'import { Readable } from "node:stream";',
    '',
    `const BASE_URL = ${jsStr(trimBase(ctx.baseUrl))}; // 실제 Alli 백엔드 — 브라우저엔 노출되지 않음`,
    'const API_KEY = process.env.ALLI_API_KEY;',
    'if (!API_KEY) throw new Error("환경변수 ALLI_API_KEY가 설정되지 않았습니다 — 초기 설정 가이드를 참고하세요"); // fail-fast',
    'const PORT = Number(process.env.PORT) || 8787;',
    'const PREFIX = "/api"; // 브라우저가 호출하는 같은 출처 경로 접두사',
    '',
    '// 응답에서 제거할 헤더 — fetch가 본문을 이미 디코드하므로 길이/인코딩 헤더를 그대로 흘리면 깨진다',
    'const STRIP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);',
    '',
    'const server = createServer(async (req, res) => {',
    '  try {',
    '    if (req.url !== PREFIX && !req.url.startsWith(PREFIX + "/")) {',
    '      res.writeHead(404).end("Not found — /api 하위 경로만 처리합니다");',
    '      return;',
    '    }',
    '    // /api 접두사를 떼고 Alli 경로로 매핑 (쿼리스트링 포함)',
    '    const upstreamPath = req.url.slice(PREFIX.length) || "/";',
    '    const hasBody = req.method !== "GET" && req.method !== "HEAD";',
    '',
    '    // 들어온 헤더를 그대로 전달하되 host 제거 + API-KEY 주입 (키는 여기서만)',
    '    const headers = { ...req.headers };',
    '    delete headers.host;',
    '    delete headers.connection;',
    '    delete headers["content-length"]; // fetch가 재계산',
    '    headers["API-KEY"] = API_KEY; // 멀티파트 boundary 등 Content-Type은 원본 그대로 포워딩',
    '',
    '    const upstream = await fetch(BASE_URL + upstreamPath, {',
    '      method: req.method,',
    '      headers,',
    '      body: hasBody ? Readable.toWeb(req) : undefined, // 요청 본문(JSON/멀티파트)을 스트림 그대로 전달',
    '      duplex: hasBody ? "half" : undefined,',
    '    });',
    '',
    '    // 상태/헤더를 그대로 내려보내고 응답 본문(스트리밍 포함)을 클라이언트로 pipe',
    '    const outHeaders = {};',
    '    upstream.headers.forEach((value, key) => {',
    '      if (!STRIP.has(key.toLowerCase())) outHeaders[key] = value;',
    '    });',
    '    res.writeHead(upstream.status, outHeaders);',
    '    if (upstream.body) {',
    '      Readable.fromWeb(upstream.body).pipe(res); // 스트리밍 응답도 청크 단위로 그대로 흘려보냄',
    '    } else {',
    '      res.end();',
    '    }',
    '  } catch (err) {',
    '    console.error(err);',
    '    if (!res.headersSent) res.writeHead(502);',
    '    res.end("Proxy error");',
    '  }',
    '});',
    '',
    'server.listen(PORT, () => {',
    '  console.log(`프록시 실행 중: http://localhost:${PORT}${PREFIX}/  ->  ${BASE_URL}`);',
    '});',
    '',
  ].join('\n');
}

/** 브라우저 JavaScript 빌더 — 같은 출처 Node 프록시(/api)를 키 없이 호출 (오케스트레이션은 클라이언트).
    Node.js 변형은 renderNodeProxy로 분기 — 플로우 무관 프록시 서버라 본문 빌더를 거치지 않는다. */
export function renderJsCode(plan: CodegenPlan, ctx: CodegenContext, target: JsTarget): string {
  // Node.js 변형은 플로우 무관 리버스 프록시 (Model A) — 키를 쥐고 /api/* 를 Alli로 포워딩
  if (target === 'node') return renderNodeProxy(ctx);

  const { spec, wrapper } = plan;
  const needsEncode = Boolean(ctx.ownUserId || ctx.userEmail);
  const chunks: string[] = [];

  // 1) 프롤로그 — 브라우저는 같은 출처 프록시(/api)를 호출하고 키는 싣지 않는다
  chunks.push(
    [
      '/* 전제: 이 코드는 같은 출처(same-origin)의 Node.js 프록시(/api)를 호출합니다.',
      '   API 키는 프록시 서버에만 있고 브라우저로는 내려오지 않습니다 —',
      '   별도 "Node.js" 탭의 리버스 프록시 서버를 함께 띄우세요. */',
    ].join('\n'),
  );
  chunks.push('const BASE_URL = "/api"; // 같은 출처 Node 프록시 경로 — 프록시가 실제 Alli 백엔드로 포워딩');

  // 2) 헤더 + 동봉 헬퍼
  if (needsEncode) chunks.push(JS_ENCODE_OWN_USER_ID);
  chunks.push(jsHeadersBlock(ctx, 'browser'));
  chunks.push(JS_RAISE_FOR_STATUS);
  if (spec.stream) chunks.push(JS_EXTRACT_JSON_VALUES);

  // 3) wrapper별 본문 (오케스트레이션은 브라우저=클라이언트에서 수행)
  switch (wrapper.kind) {
    case 'none':
      chunks.push(jsNoneMain(spec, target));
      break;
    case 'ga-thread-loop':
      chunks.push(jsGaThreadLoop(spec, target));
      break;
    case 'conversation-loop':
      chunks.push(JS_FIND_CONVERSATION_ID, jsConversationLoop(spec, target));
      break;
    case 'kb-replace':
      chunks.push(JS_EXTRACT_NODE_ID, jsKbReplace(spec, wrapper, target));
      break;
  }
  return chunks.join('\n\n') + '\n';
}
