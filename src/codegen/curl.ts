/* curl 변형 생성기 — SSOT §7.
   - API 키는 "$ALLI_API_KEY" 환경변수 참조 + 상단 안내 주석 (§7-1)
   - OWN-USER-ID/USER-EMAIL은 셸에서 분기할 수 없으므로 생성 시점에 core의
     encodeOwnUserId로 미리 인코딩한 리터럴을 넣는다 (§7-2)
   - stream이면 --no-buffer + "JSON 조각 스트림" 주석 (§7-5)
   - kb-replace는 jq 의존 없는 bash 스크립트 (grep/sed로 id·status 추출) */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import type { MultipartPart, RequestSpec } from '../core/request-spec';
import { encodeOwnUserId } from '../core/encoding';
import type { KbReplaceWrapper } from './shared';
import {
  CONV_FOLLOW_UP,
  ERROR_TABLE_LINES,
  GA_FOLLOW_UP,
  jsonBodyValue,
  multipartParts,
  omitKeys,
  pathWithQuery,
  shDouble,
  shQuote,
  stringField,
  trimBase,
} from './shared';

const STREAM_COMMENT = '# 응답은 JSON 조각 스트림 (SSE 아님 — SSOT §3.5): 청크를 누적하며 JSON 단위로 파싱해 소비';
const BASE64_COMMENT = "# 비ASCII OWN-USER-ID는 base64: 인코딩 (echo -n '값' | base64)";

/** 상단 공통 주석 + BASE_URL 상수 (§7-1, §7-4) */
function prelude(ctx: CodegenContext, extra: string[] = []): string[] {
  const L = ['# 먼저: export ALLI_API_KEY=발급받은키'];
  L.push(...ERROR_TABLE_LINES.map((l) => '# ' + l));
  if (ctx.ownUserId || ctx.userEmail) L.push(BASE64_COMMENT);
  L.push(...extra);
  L.push(`BASE_URL=${shQuote(trimBase(ctx.baseUrl))}`);
  return L;
}

/** -H 인자들 — API-KEY 필수, JSON 본문일 때만 Content-Type (§7-2, §7-3) */
function headerArgs(ctx: CodegenContext, json: boolean): string[] {
  const L = ['-H "API-KEY: $ALLI_API_KEY"'];
  if (ctx.ownUserId) L.push('-H ' + shQuote('OWN-USER-ID: ' + encodeOwnUserId(ctx.ownUserId)));
  if (ctx.userEmail) L.push('-H ' + shQuote('USER-EMAIL: ' + encodeOwnUserId(ctx.userEmail)));
  if (json) L.push("-H 'Content-Type: application/json'");
  return L;
}

function joinCmd(segs: string[]): string {
  return segs.join(' \\\n  ');
}

function curlHead(spec: RequestSpec): string {
  let s = 'curl';
  if (spec.stream) s += ' --no-buffer';
  if (spec.method !== 'GET') s += ` -X ${spec.method}`;
  s += ` "$BASE_URL${shDouble(pathWithQuery(spec))}"`;
  return s;
}

/** -F 인자들 — parts 순서 그대로 1:1, 파일은 @./파일명 (§7-7) */
function fParts(parts: MultipartPart[]): string[] {
  return parts.map((p) => {
    if (p.kind === 'text') return '-F ' + shQuote(`${p.name}=${p.value ?? ''}`);
    const fname = p.file?.name;
    return '-F ' + shQuote(`${p.name}=@${fname ? `./${fname}` : 'FILE_PATH'}`);
  });
}

/* --- wrapper: none --- */

function curlNone(spec: RequestSpec, ctx: CodegenContext): string {
  const out = prelude(ctx);
  out.push('');
  if (spec.stream) out.push(STREAM_COMMENT);
  const segs = [curlHead(spec), ...headerArgs(ctx, spec.body.kind === 'json')];
  if (spec.body.kind === 'json') {
    segs.push('--data-raw ' + shQuote(JSON.stringify(spec.body.value, null, 2)));
  } else if (spec.body.kind === 'multipart') {
    out.push('# multipart — Content-Type 직접 지정 금지 (-F가 boundary 자동 설정, §7-3)');
    segs.push(...fParts(spec.body.parts));
  }
  out.push(joinCmd(segs));
  return out.join('\n') + '\n';
}

/* --- wrapper: ga-thread-loop (Flow 4) --- */

function curlGaThreadLoop(spec: RequestSpec, ctx: CodegenContext): string {
  const body = jsonBodyValue(spec);
  const base = { ...omitKeys(body, ['query', 'threadId']), isStateful: true };
  const firstQuery = stringField(body, 'query') ?? '첫 질문을 입력하세요';
  const first = { query: firstQuery, ...base };
  const second = { query: GA_FOLLOW_UP, ...base, threadId: '__THREAD_ID__' };

  const out = prelude(ctx, ['# ⚠️ OWN-USER-ID 헤더 없으면 threadId(멀티턴)가 비활성화됩니다 (SSOT §3.2)']);
  out.push('');
  if (spec.stream) out.push(STREAM_COMMENT);
  out.push('# 1차 호출 — threadId 없이 질문, 응답의 threadId를 확인');
  out.push(joinCmd([curlHead(spec), ...headerArgs(ctx, true), '--data-raw ' + shQuote(JSON.stringify(first, null, 2))]));
  out.push('');
  out.push('# 2차 호출 — 1차 응답의 threadId를 재사용해 맥락 유지 (멀티턴)');
  out.push("THREAD_ID='1차_응답의_threadId'");
  const secondRaw = shQuote(JSON.stringify(second, null, 2)).replace('"__THREAD_ID__"', '"\'"$THREAD_ID"\'"');
  out.push(joinCmd([curlHead(spec), ...headerArgs(ctx, true), '--data-raw ' + secondRaw]));
  return out.join('\n') + '\n';
}

/* --- wrapper: conversation-loop (Flow 6) --- */

function curlConversationLoop(spec: RequestSpec, ctx: CodegenContext): string {
  const parts = multipartParts(spec).filter((p) => !(p.kind === 'text' && p.name === 'conversationId'));
  const out = prelude(ctx);
  out.push('');
  out.push(STREAM_COMMENT);
  out.push('# 1차 호출 — conversationId 없이 새 대화 시작.');
  out.push('# 스트림에서 conversationId 확인 (위치는 스키마 미문서화 — 실 응답으로 검증, SSOT §9-2)');
  out.push(joinCmd([curlHead(spec), ...headerArgs(ctx, false), ...fParts(parts)]));
  out.push('');
  out.push('# 2차 호출 — 확보한 conversationId로 후속 메시지 전송 (반복)');
  out.push("CONV_ID='1차_스트림에서_확보한_conversationId'");
  out.push(
    joinCmd([
      curlHead(spec),
      ...headerArgs(ctx, false),
      '-F "conversationId=$CONV_ID"',
      '-F ' + shQuote(`message=${CONV_FOLLOW_UP}`),
    ]),
  );
  return out.join('\n') + '\n';
}

/* --- wrapper: kb-replace (Flow 5) — bash 스크립트 --- */

function curlKbReplace(spec: RequestSpec, ctx: CodegenContext, w: KbReplaceWrapper): string {
  const parts = multipartParts(spec);
  const initialS = Math.max(1, Math.round(w.pollInitialMs / 1000));
  const maxS = Math.max(1, Math.round(w.pollMaxMs / 1000));
  const timeoutS = Math.max(1, Math.round(w.pollTimeoutMs / 1000));
  const L: string[] = [];
  L.push('#!/usr/bin/env bash');
  L.push('# bash / Git Bash / WSL용');
  L.push('# 먼저: export ALLI_API_KEY=발급받은키');
  L.push('# 문서 교체 루틴 — 순서: 업로드 → 완료 확인 → 삭제 (역순 금지 — 문서 소실/검색 공백, SSOT Flow 5)');
  L.push(...ERROR_TABLE_LINES.map((l) => '# ' + l));
  if (ctx.ownUserId || ctx.userEmail) L.push(BASE64_COMMENT);
  L.push('set -euo pipefail');
  L.push('');
  L.push(`BASE_URL=${shQuote(trimBase(ctx.baseUrl))}`);
  L.push(`OLD_NODE_ID=${shQuote(w.oldNodeId)} # 교체 대상(구) 노드`);
  L.push(`POLL_INTERVAL=${initialS} # 폴링 초기 간격(초)`);
  L.push(`POLL_MAX=${maxS} # 백오프 최대 간격(초)`);
  L.push(`POLL_TIMEOUT=${timeoutS} # 폴링 타임아웃(초)`);
  L.push(`AUTH=(${headerArgs(ctx, false).join(' ')})`);
  L.push('');
  L.push('# 1) 새 파일 업로드 (구 노드의 hashtags 승계, 같은 폴더 지정 권장)');
  L.push('# multipart — Content-Type 직접 지정 금지 (-F가 boundary 자동 설정, §7-3)');
  L.push(
    joinCmd([
      'UPLOAD_RES=$(curl -sS -X POST "$BASE_URL' + shDouble(pathWithQuery(spec)) + '" "${AUTH[@]}"',
      ...fParts(parts),
    ]) + ')',
  );
  L.push('echo "$UPLOAD_RES"');
  L.push('');
  L.push('# 새 노드 id 추출 — jq 의존 없이 grep/sed로 첫 "id" 값을 뽑는다');
  L.push(
    `NEW_NODE_ID=$(printf '%s' "$UPLOAD_RES" | grep -o '"id" *: *"[^"]*"' | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/' || true)`,
  );
  L.push('if [ -z "$NEW_NODE_ID" ]; then');
  L.push('  echo "업로드 응답에서 새 노드 id를 찾지 못했습니다" >&2');
  L.push('  exit 1');
  L.push('fi');
  L.push('echo "업로드 완료 — 새 노드: $NEW_NODE_ID"');
  L.push('');
  L.push('# 2) ingestion_status 폴링 (SSOT §5.11) — 성공: completed/post_completed, 실패: parsing_fail/post_parsing_fail');
  L.push('#    initializing/parsing/retrying/post_retrying 등 진행 상태는 계속 대기 (백오프)');
  L.push('ELAPSED=0');
  L.push('INTERVAL=$POLL_INTERVAL');
  L.push('while true; do');
  L.push('  STATUS_RES=$(curl -sS "${AUTH[@]}" "$BASE_URL/webapi/v2/ingestion_status/$NEW_NODE_ID")');
  L.push(
    `  STATUS=$(printf '%s' "$STATUS_RES" | grep -o '"status" *: *"[^"]*"' | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/' || true)`,
  );
  L.push('  echo "ingestion status: $STATUS (${ELAPSED}s)"');
  L.push('  case "$STATUS" in');
  L.push('    completed|post_completed)');
  L.push('      break ;; # 성공');
  L.push('    parsing_fail|post_parsing_fail)');
  L.push('      # 실패 → 새 노드 롤백 삭제 (구 문서는 그대로 유지)');
  L.push('      curl -sS -X DELETE "${AUTH[@]}" "$BASE_URL/webapi/v2/knowledge_base_nodes/$NEW_NODE_ID" > /dev/null');
  L.push('      echo "인제스천 실패($STATUS) — 새 노드를 롤백 삭제했습니다" >&2');
  L.push('      exit 1 ;;');
  L.push('  esac');
  L.push('  if [ "$ELAPSED" -ge "$POLL_TIMEOUT" ]; then');
  L.push('    curl -sS -X DELETE "${AUTH[@]}" "$BASE_URL/webapi/v2/knowledge_base_nodes/$NEW_NODE_ID" > /dev/null');
  L.push('    echo "인제스천 타임아웃 — 새 노드를 롤백 삭제했습니다" >&2');
  L.push('    exit 1');
  L.push('  fi');
  L.push('  sleep "$INTERVAL"');
  L.push('  ELAPSED=$((ELAPSED + INTERVAL))');
  L.push('  INTERVAL=$((INTERVAL * 2)) # 백오프');
  L.push('  if [ "$INTERVAL" -gt "$POLL_MAX" ]; then INTERVAL=$POLL_MAX; fi');
  L.push('done');
  L.push('');
  L.push('# 3) 성공 → 구 노드 삭제 (여기까지 신·구 문서가 잠시 공존 — 역순 금지)');
  L.push('curl -sS -X DELETE "${AUTH[@]}" "$BASE_URL/webapi/v2/knowledge_base_nodes/$OLD_NODE_ID"');
  L.push('echo "교체 완료: $OLD_NODE_ID → $NEW_NODE_ID"');
  return L.join('\n') + '\n';
}

export function generateCurl(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  const { spec, wrapper } = plan;
  let code: string;
  switch (wrapper.kind) {
    case 'none':
      code = curlNone(spec, ctx);
      break;
    case 'ga-thread-loop':
      code = curlGaThreadLoop(spec, ctx);
      break;
    case 'conversation-loop':
      code = curlConversationLoop(spec, ctx);
      break;
    case 'kb-replace':
      code = curlKbReplace(spec, ctx, wrapper);
      break;
  }
  return { variant: 'curl', setLabel: 'curl', title: 'curl', language: 'bash', code };
}
