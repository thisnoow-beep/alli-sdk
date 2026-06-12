/* Python (requests) 변형 생성기 — SSOT §7.
   - API 키: os.environ["ALLI_API_KEY"] — 미설정이면 KeyError로 fail-fast (§7-1)
   - JSON body는 renderPyValue로 Python 리터럴 변환 후 json=payload 전달 (§7-6)
   - multipart는 data dict(텍스트) + files 리스트 of 튜플 — Content-Type 미지정 (§7-3, §7-7)
   - stream은 iter_content(chunk_size=None) + 증분 utf-8 디코더 + extract_json_values (§7-5) */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import type { MultipartPart, RequestSpec } from '../core/request-spec';
import type { KbReplaceWrapper } from './shared';
import {
  CONV_FOLLOW_UP,
  GA_FOLLOW_UP,
  jsonBodyValue,
  multipartParts,
  omitKeys,
  pathWithQuery,
  pyFStr,
  pyStr,
  renderPyValue,
  stringField,
  trimBase,
} from './shared';

/* ---------- 생성 Python에 동봉하는 헬퍼 스니펫 ---------- */

const PY_ENCODE_OWN_USER_ID = `def encode_own_user_id(value):
    """비ASCII OWN-USER-ID/USER-EMAIL → 'base64:' + base64(utf-8) 변환 (SSOT §3.2, §7-2)"""
    if value.isascii():
        return value  # ASCII는 그대로
    return "base64:" + base64.b64encode(value.encode("utf-8")).decode("ascii")`;

const PY_RAISE_FOR_API_ERROR = `# 에러 처리 — HTTP status 분기 + 본문 code/error/errors 해석 (SSOT §3.3, §7-4)
# 코드표: 7001 잘못된 API 키(sdkKey와 혼동 주의) / 7002 요청 본문 JSON 디코딩 실패
#        7003 파라미터 누락·형식 오류 / 7004 결제(과금) 오류
ERROR_CODES = {
    7001: "잘못된 API 키 — Settings > General의 REST API 키인지, sdkKey와 혼동하지 않았는지 확인",
    7002: "요청 본문 JSON 디코딩 실패",
    7003: "파라미터 누락/형식 오류",
    7004: "결제/과금 오류 (연체 등)",
}


def raise_for_api_error(res):
    if res.ok:
        return
    detail = res.text
    try:
        body = res.json()
    except ValueError:
        body = None  # 본문이 JSON이 아니면 원문 그대로 노출
    if isinstance(body, dict):
        if body.get("code") in ERROR_CODES:
            detail = f"{body['code']} {ERROR_CODES[body['code']]}"
        elif "error" in body:  # 비표준 형태: { "error": "..." }
            detail = str(body["error"])
        elif "errors" in body:  # 비표준 형태: { "errors": "..." }
            detail = str(body["errors"])
            if "Expecting value" in detail:
                # inputs 누락/형식 오류 가능성이 크다 (SSOT §9-1)
                detail += " — inputs 누락/형식 오류 가능성"
        elif "message" in body:
            detail = str(body["message"])
    raise RuntimeError(f"HTTP {res.status_code}: {detail}")`;

const PY_EXTRACT_JSON_VALUES = `def extract_json_values(buffer):
    """스트림 버퍼에서 완성된 최상위 JSON 값만 잘라 파싱 (SSOT §3.5 — SSE 아님, JSON 조각 스트림).
    중괄호 깊이 추적 — 문자열 내부의 중괄호와 백슬래시 이스케이프는 깊이 계산에서 제외.
    미완성 조각은 그대로 돌려줘 다음 청크와 이어 붙인다."""
    values = []
    depth, in_string, escaped = 0, False, False
    start, consumed = -1, 0
    for i, ch in enumerate(buffer):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"' and depth > 0:
            in_string = True
        elif ch in "{[":
            if depth == 0:
                start = i
            depth += 1
        elif ch in "}]" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    values.append(json.loads(buffer[start:i + 1]))
                except ValueError:
                    pass  # 잡텍스트는 건너뜀
                consumed = i + 1
                start = -1
    return values, buffer[start if start >= 0 else consumed:]`;

const PY_FIND_CONVERSATION_ID = `def find_conversation_id(value):
    """conversationId deep-scan — 스트리밍 응답 스키마 미문서화(SSOT §9-2)로 트리 전체를 탐색.
    실 응답 확인 후 정확한 경로로 고정하기를 권장."""
    if isinstance(value, dict):
        if isinstance(value.get("conversationId"), str):
            return value["conversationId"]
        conv = value.get("conversation")
        if isinstance(conv, dict) and isinstance(conv.get("id"), str):
            return conv["id"]
        for child in value.values():
            found = find_conversation_id(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_conversation_id(child)
            if found:
                return found
    return None`;

const PY_EXTRACT_NODE_ID = `def extract_node_id(value):
    """업로드 응답에서 새 노드 id 추출 — 노드 배열이 래핑돼 있어도 동작하도록 deep-scan"""
    if isinstance(value, dict):
        if isinstance(value.get("id"), str):
            return value["id"]
        for child in value.values():
            found = extract_node_id(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = extract_node_id(child)
            if found:
                return found
    return None`;

/* ---------- 조립 블록 ---------- */

function pyHeadersBlock(ctx: CodegenContext): string {
  const L = ['# 공통 헤더 — API-KEY 필수 (SSOT §3.2)', 'HEADERS = {', '    "API-KEY": API_KEY,'];
  if (ctx.ownUserId) {
    L.push(`    "OWN-USER-ID": encode_own_user_id(${pyStr(ctx.ownUserId)}),  # 비ASCII는 base64: 로 자동 변환`);
  }
  if (ctx.userEmail) L.push(`    "USER-EMAIL": encode_own_user_id(${pyStr(ctx.userEmail)}),`);
  L.push('}');
  return L.join('\n');
}

interface PyCallOpts {
  json?: boolean;
  multipart?: boolean;
  stream?: boolean;
}

/** requests.<method>(...) 호출 라인들 — varName에 응답 저장 */
function pyFetchLines(spec: RequestSpec, pad: string, varName: string, opts: PyCallOpts): string[] {
  const method = spec.method.toLowerCase();
  const L = [`${pad}${varName} = requests.${method}(`];
  L.push(`${pad}    f"{BASE_URL}${pyFStr(pathWithQuery(spec))}",`);
  if (opts.json) {
    L.push(`${pad}    headers={**HEADERS, "Content-Type": "application/json"},  # JSON 본문만 Content-Type 명시 (§7-3)`);
    L.push(`${pad}    json=payload,`);
  } else if (opts.multipart) {
    L.push(`${pad}    headers=HEADERS,  # multipart — Content-Type 직접 지정 금지 (requests가 boundary 자동 설정, §7-3)`);
    L.push(`${pad}    data=data,`);
    L.push(`${pad}    files=files,`);
  } else {
    L.push(`${pad}    headers=HEADERS,`);
  }
  if (opts.stream) L.push(`${pad}    stream=True,  # 응답은 JSON 조각 스트림 (SSE 아님 — SSOT §3.5)`);
  L.push(`${pad})`);
  return L;
}

/** multipart 변수 — data dict(텍스트) + files 리스트 of 튜플, parts 순서 그대로 (§7-7) */
function pyMultipartVars(parts: MultipartPart[], pad: string): string[] {
  const texts = parts.filter((p) => p.kind === 'text');
  const files = parts.filter((p) => p.kind === 'file');
  const L: string[] = [];
  L.push(`${pad}data = {  # 텍스트 파트 — parts 순서 그대로 (§7-7)`);
  for (const p of texts) L.push(`${pad}    ${pyStr(p.name)}: ${pyStr(p.value ?? '')},`);
  L.push(`${pad}}`);
  L.push(`${pad}files = [  # 파일 파트 — 같은 필드명 반복 가능`);
  for (const p of files) {
    const fname = p.file?.name;
    const display = fname ?? 'FILE_PATH';
    const path = fname ? `./${fname}` : 'FILE_PATH';
    L.push(`${pad}    (${pyStr(p.name)}, (${pyStr(display)}, open(${pyStr(path)}, "rb"))),`);
  }
  L.push(`${pad}]`);
  return L;
}

/** 스트림 소비 — iter_content + 증분 utf-8 디코더 (§7-5) */
function pyStreamConsume(pad: string, varName: string, onValue: string[]): string[] {
  const L = [
    `${pad}raise_for_api_error(${varName})`,
    `${pad}decoder = codecs.getincrementaldecoder("utf-8")()  # 한글 멀티바이트가 청크 경계에서 쪼개져도 안전`,
    `${pad}buffer = ""`,
    `${pad}for chunk in ${varName}.iter_content(chunk_size=None):`,
    `${pad}    buffer += decoder.decode(chunk)`,
    `${pad}    values, buffer = extract_json_values(buffer)  # 미완성 조각은 buffer에 유지`,
    `${pad}    for v in values:`,
  ];
  for (const l of onValue) L.push(`${pad}        ${l}`);
  return L;
}

/* --- wrapper: none --- */

function pyNoneMain(spec: RequestSpec): string {
  const L: string[] = [];
  const isJson = spec.body.kind === 'json';
  const isMultipart = spec.body.kind === 'multipart';
  if (spec.body.kind === 'json') {
    L.push(`payload = ${renderPyValue(spec.body.value)}`);
    L.push('');
  } else if (spec.body.kind === 'multipart') {
    L.push(...pyMultipartVars(spec.body.parts, ''));
    L.push('');
  }
  L.push(...pyFetchLines(spec, '', 'res', { json: isJson, multipart: isMultipart, stream: spec.stream }));
  if (spec.stream) {
    L.push(...pyStreamConsume('', 'res', ['print(v)  # JSON 조각 — sync와 동일 포맷 (SSOT §3.5)']));
  } else {
    L.push('raise_for_api_error(res)');
    L.push(
      spec.method === 'DELETE'
        ? 'print("삭제 완료 — HTTP", res.status_code)  # 200 빈 본문 (SSOT §5.10)'
        : 'print(res.json())',
    );
  }
  return L.join('\n');
}

/* --- wrapper: ga-thread-loop (Flow 4) --- */

function pyGaThreadLoop(spec: RequestSpec): string {
  const body = jsonBodyValue(spec);
  const base = { ...omitKeys(body, ['query', 'threadId']), isStateful: true };
  const firstQuery = stringField(body, 'query') ?? '첫 질문을 입력하세요';
  const L: string[] = [];
  L.push('# 멀티턴 베이스 페이로드 — query/threadId는 ask() 인자로 주입');
  L.push(`BASE_PAYLOAD = ${renderPyValue(base)}`);
  L.push('');
  L.push('');
  L.push('# ⚠️ OWN-USER-ID 헤더 없으면 threadId(멀티턴)가 비활성화됩니다 (SSOT §3.2)');
  L.push('def ask(query, thread_id=None):');
  L.push('    """ask(query, thread_id) → {"answer", "threadId"} — 응답의 threadId를 후속 호출에 재사용"""');
  L.push('    payload = {**BASE_PAYLOAD, "query": query}');
  L.push('    if thread_id:');
  L.push('        payload["threadId"] = thread_id  # 첫 호출엔 생략 — 응답이 새 threadId를 발급');
  L.push(...pyFetchLines(spec, '    ', 'res', { json: true, stream: spec.stream }));
  if (spec.stream) {
    L.push('    answer = None');
    L.push('    next_thread_id = thread_id');
    L.push(
      ...pyStreamConsume('    ', 'res', [
        'if isinstance(v, dict):  # JSON 조각 — sync와 동일 포맷 (SSOT §3.5)',
        '    answer = v.get("answer", answer)',
        '    next_thread_id = v.get("threadId", next_thread_id)',
      ]),
    );
    L.push('    return {"answer": answer, "threadId": next_thread_id}');
  } else {
    L.push('    raise_for_api_error(res)');
    L.push('    data = res.json()');
    L.push('    return {"answer": data.get("answer"), "threadId": data.get("threadId")}');
  }
  L.push('');
  L.push('');
  L.push('# 1차 질문 — thread_id 없이 시작');
  L.push(`first = ask(${pyStr(firstQuery)})`);
  L.push('print("답변 1:", first["answer"])');
  L.push('');
  L.push('# 2차 질문 — 1차 응답의 threadId를 재사용해 맥락 유지 (멀티턴)');
  L.push(`second = ask(${pyStr(GA_FOLLOW_UP)}, first["threadId"])`);
  L.push('print("답변 2:", second["answer"])');
  return L.join('\n');
}

/* --- wrapper: conversation-loop (Flow 6) --- */

function pyConversationLoop(spec: RequestSpec): string {
  const parts = multipartParts(spec);
  const extras = parts.filter((p) => !(p.kind === 'text' && (p.name === 'message' || p.name === 'conversationId')));
  const messagePart = parts.find((p) => p.kind === 'text' && p.name === 'message');
  const firstMessage = messagePart?.value || '안녕하세요';
  const L: string[] = [];
  L.push('def send_message(message, conversation_id=None):');
  L.push('    """메시지 전송 + 스트림 소비 + conversationId 회수 (SSOT Flow 6)"""');
  L.push('    data = {"message": message}');
  L.push('    files = []  # 파일 없는 호출은 일반 form 전송 — multipart가 필요하면 (이름, (None, 값)) 텍스트 튜플 사용');
  L.push('    if conversation_id:');
  L.push('        data["conversationId"] = conversation_id  # 기존 대화 이어가기');
  if (extras.length > 0) {
    L.push('    else:');
    L.push('        # 첫 메시지에만 포함 — 현재 입력값의 추가 필드/첨부');
    for (const p of extras) {
      if (p.kind === 'text') {
        L.push(`        data[${pyStr(p.name)}] = ${pyStr(p.value ?? '')}`);
      } else {
        const fname = p.file?.name;
        const display = fname ?? 'FILE_PATH';
        const path = fname ? `./${fname}` : 'FILE_PATH';
        L.push(`        files.append((${pyStr(p.name)}, (${pyStr(display)}, open(${pyStr(path)}, "rb"))))`);
      }
    }
  }
  L.push(...pyFetchLines(spec, '    ', 'res', { multipart: true, stream: true }));
  L.push('    found_id = conversation_id');
  L.push(
    ...pyStreamConsume('    ', 'res', [
      'print(v)  # JSON 조각 — sync와 동일 포맷 (SSOT §3.5)',
      'if not found_id:',
      '    found_id = find_conversation_id(v)',
    ]),
  );
  L.push('    return found_id');
  L.push('');
  L.push('');
  L.push('# 1) conversationId 없이 새 대화 시작 (SSOT Flow 6)');
  L.push(`conversation_id = send_message(${pyStr(firstMessage)})`);
  L.push('if not conversation_id:');
  L.push('    raise RuntimeError("스트림에서 conversationId를 찾지 못했습니다 — 실 응답(raw)을 확인하세요 (SSOT §9-2)")');
  L.push('print("conversationId:", conversation_id)');
  L.push('');
  L.push('# 2) 후속 메시지 루프 — conversationId를 유지한 채 반복 전송');
  L.push(`follow_ups = [${pyStr(CONV_FOLLOW_UP)}]`);
  L.push('for msg in follow_ups:');
  L.push('    send_message(msg, conversation_id)');
  return L.join('\n');
}

/* --- wrapper: kb-replace (Flow 5) --- */

function pyKbReplace(spec: RequestSpec, w: KbReplaceWrapper): string {
  const L: string[] = [];
  L.push(`OLD_NODE_ID = ${pyStr(w.oldNodeId)}  # 교체 대상(구) 노드`);
  L.push(`POLL_INITIAL_S = ${w.pollInitialMs / 1000}  # 폴링 초기 간격(초)`);
  L.push(`POLL_MAX_S = ${w.pollMaxMs / 1000}  # 백오프 최대 간격(초)`);
  L.push(`POLL_TIMEOUT_S = ${w.pollTimeoutMs / 1000}  # 폴링 타임아웃(초)`);
  L.push('');
  L.push('');
  L.push('def delete_node(node_id):');
  L.push('    res = requests.delete(f"{BASE_URL}/webapi/v2/knowledge_base_nodes/{node_id}", headers=HEADERS)');
  L.push('    raise_for_api_error(res)');
  L.push('');
  L.push('');
  L.push('def replace_document():');
  L.push('    """문서 교체 루틴 — 순서: 업로드 → 완료 확인 → 삭제 (역순 금지 — 문서 소실/검색 공백, SSOT Flow 5)"""');
  L.push('    # 1) 새 파일 업로드 (구 노드의 hashtags 승계, 같은 폴더 지정 권장)');
  L.push(...pyMultipartVars(multipartParts(spec), '    '));
  L.push(...pyFetchLines(spec, '    ', 'res', { multipart: true }));
  L.push('    raise_for_api_error(res)');
  L.push('    new_node_id = extract_node_id(res.json())');
  L.push('    if not new_node_id:');
  L.push('        raise RuntimeError("업로드 응답에서 새 노드 id를 찾지 못했습니다")');
  L.push('    print("업로드 완료 — 새 노드:", new_node_id)');
  L.push('');
  L.push('    # 2) ingestion_status 폴링 (SSOT §5.11) — 성공: completed/post_completed, 실패: parsing_fail/post_parsing_fail');
  L.push('    #    initializing/parsing/retrying/post_retrying 등 진행 상태는 계속 대기 (백오프)');
  L.push('    deadline = time.monotonic() + POLL_TIMEOUT_S');
  L.push('    interval = POLL_INITIAL_S');
  L.push('    while True:');
  L.push('        res = requests.get(f"{BASE_URL}/webapi/v2/ingestion_status/{new_node_id}", headers=HEADERS)');
  L.push('        raise_for_api_error(res)');
  L.push('        status = res.json().get("status")');
  L.push('        print("ingestion status:", status)');
  L.push('        if status in ("completed", "post_completed"):');
  L.push('            break  # 성공');
  L.push('        if status in ("parsing_fail", "post_parsing_fail"):');
  L.push('            delete_node(new_node_id)  # 실패 → 새 노드 롤백 삭제 (구 문서는 그대로 유지)');
  L.push('            raise RuntimeError(f"인제스천 실패({status}) — 새 노드를 롤백 삭제했습니다")');
  L.push('        if time.monotonic() >= deadline:');
  L.push('            delete_node(new_node_id)  # 타임아웃 → 롤백');
  L.push('            raise RuntimeError("인제스천 타임아웃 — 새 노드를 롤백 삭제했습니다")');
  L.push('        time.sleep(interval)');
  L.push('        interval = min(interval * 2, POLL_MAX_S)  # 백오프');
  L.push('');
  L.push('    # 3) 성공 → 구 노드 삭제 (여기까지 신·구 문서가 잠시 공존 — 역순 금지)');
  L.push('    delete_node(OLD_NODE_ID)');
  L.push('    print("교체 완료:", OLD_NODE_ID, "→", new_node_id)');
  L.push('    return new_node_id');
  L.push('');
  L.push('');
  L.push('replace_document()');
  return L.join('\n');
}

/* ---------- 조립 ---------- */

function renderPython(plan: CodegenPlan, ctx: CodegenContext): string {
  const { spec, wrapper } = plan;
  const needsEncode = Boolean(ctx.ownUserId || ctx.userEmail);
  const needsStream = spec.stream;
  const needsTime = wrapper.kind === 'kb-replace';

  const imports: string[] = [];
  if (needsEncode) imports.push('import base64');
  if (needsStream) imports.push('import codecs');
  if (needsStream) imports.push('import json');
  imports.push('import os');
  if (needsTime) imports.push('import time');

  const chunks: string[] = [];
  chunks.push(
    [
      '# Python (requests) — 먼저: export ALLI_API_KEY=발급받은키',
      '# 의존성: pip install requests',
      '',
      ...imports,
      '',
      'import requests',
    ].join('\n'),
  );
  chunks.push(
    [
      `BASE_URL = ${pyStr(trimBase(ctx.baseUrl))}`,
      'API_KEY = os.environ["ALLI_API_KEY"]  # 미설정이면 KeyError로 즉시 실패 (fail-fast)',
    ].join('\n'),
  );
  if (needsEncode) chunks.push(PY_ENCODE_OWN_USER_ID);
  chunks.push(pyHeadersBlock(ctx));
  chunks.push(PY_RAISE_FOR_API_ERROR);
  if (needsStream) chunks.push(PY_EXTRACT_JSON_VALUES);

  switch (wrapper.kind) {
    case 'none':
      chunks.push(pyNoneMain(spec));
      break;
    case 'ga-thread-loop':
      chunks.push(pyGaThreadLoop(spec));
      break;
    case 'conversation-loop':
      chunks.push(PY_FIND_CONVERSATION_ID, pyConversationLoop(spec));
      break;
    case 'kb-replace':
      chunks.push(PY_EXTRACT_NODE_ID, pyKbReplace(spec, wrapper));
      break;
  }
  return chunks.join('\n\n\n') + '\n';
}

export function generatePython(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  return {
    variant: 'python',
    setLabel: 'Python',
    title: 'Python (requests)',
    language: 'python',
    code: renderPython(plan, ctx),
  };
}
