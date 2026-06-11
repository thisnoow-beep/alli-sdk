/* 미문서화 응답에서 데이터를 견고하게 추출하는 헬퍼들.
   §9-2 (run_conversation 스트림 스키마 미문서화)·§9-3 (run 응답 이중 형태) 대응.
   Gate G1(실 API 검증)에서 실제 경로가 확정되면 우선 경로를 고정하되 deep-scan은 폴백으로 유지. */

import type { AppInfo, KbNode } from './types';
import { tryExtractDraftJs } from './draftjs';

export interface ExtractedMessage {
  text: string;
  /** DraftJS JSON에서 추출된 텍스트인지 (배지 표시용) */
  viaDraftJs: boolean;
}

/* ---------- 내부 공통 유틸 ---------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface BfsEntry {
  node: unknown;
  depth: number;
}

/** BFS로 "모든 원소가 matches를 통과하는 비어있지 않은 배열"을 찾는다 (목록 deep-scan 공용) */
function deepFindMatchingArray(
  root: unknown,
  maxDepth: number,
  matches: (item: unknown) => boolean,
): Record<string, unknown>[] | null {
  const queue: BfsEntry[] = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every(matches)) {
        return node as Record<string, unknown>[]; // matches가 객체임을 보장
      }
      if (depth < maxDepth) for (const item of node) queue.push({ node: item, depth: depth + 1 });
    } else if (isRecord(node)) {
      if (depth < maxDepth) {
        for (const v of Object.values(node)) queue.push({ node: v, depth: depth + 1 });
      }
    }
  }
  return null;
}

/** 목록 레벨 'cursor' string 탐색 — 찾은 목록 배열 내부(항목별 cursor)는 건너뛴다 */
function findListCursor(root: unknown, foundArr: unknown, maxDepth: number): string | undefined {
  const queue: BfsEntry[] = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (node === foundArr) continue; // 항목 cursor와 목록 cursor를 혼동하지 않도록 배열 내부 제외
    if (Array.isArray(node)) {
      if (depth < maxDepth) for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    if (!isRecord(node)) continue;
    const cursor = node['cursor'];
    if (typeof cursor === 'string' && cursor !== '') return cursor;
    if (depth < maxDepth) {
      for (const v of Object.values(node)) queue.push({ node: v, depth: depth + 1 });
    }
  }
  return undefined;
}

/** 폴백: 마지막 항목의 cursor (커서 페이징 응답에서 항목별 cursor만 줄 때) */
function lastItemCursor(arr: Record<string, unknown>[]): string | undefined {
  const last = arr[arr.length - 1];
  const cursor = last?.['cursor'];
  return typeof cursor === 'string' && cursor !== '' ? cursor : undefined;
}

/* ---------- conversationId ---------- */

const CONV_ID_KEYS = new Set(['conversationid', 'conversation_id', 'convid']);

/** BFS(최대 깊이 8)로 conversationId를 찾는다.
    매칭(대소문자 무시): 키 'conversationId' | 'conversation_id' | 'convId',
    또는 키 'conversation' 아래 객체의 string 'id'. 첫 번째 비어있지 않은 문자열 반환. */
export function deepFindConversationId(value: unknown): string | undefined {
  const MAX_DEPTH = 8;
  const queue: BfsEntry[] = [{ node: value, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (Array.isArray(node)) {
      if (depth < MAX_DEPTH) for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    if (!isRecord(node)) continue;
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (CONV_ID_KEYS.has(key) && typeof v === 'string' && v !== '') return v;
      if (key === 'conversation' && isRecord(v)) {
        const id = v['id'];
        if (typeof id === 'string' && id !== '') return id;
      }
    }
    if (depth < MAX_DEPTH) {
      for (const v of Object.values(node)) queue.push({ node: v, depth: depth + 1 });
    }
  }
  return undefined;
}

/* ---------- run 응답 메시지 ---------- */

/** message 값 1개 → ExtractedMessage. 비어있으면(undefined/null/'') null = 스킵 */
function toExtractedMessage(message: unknown): ExtractedMessage | null {
  if (message === undefined || message === null) return null;
  if (typeof message === 'string') {
    if (message === '') return null;
    const draft = tryExtractDraftJs(message); // DraftJS JSON 문자열 폴백 (§3.4)
    if (draft !== null) return { text: draft, viaDraftJs: true };
    return { text: message, viaDraftJs: false };
  }
  // string이 아닌 message(객체 등)는 Raw에 가깝게 JSON 문자열로
  return { text: JSON.stringify(message), viaDraftJs: false };
}

/** run 응답(§5.4)에서 메시지들 추출 — result.responses[](v2)와 result.choices[](레거시) 모두 대응.
    각 message 문자열은 tryExtractDraftJs를 먼저 시도. */
export function extractRunMessages(runResponse: unknown): ExtractedMessage[] {
  if (!isRecord(runResponse)) return [];
  // result 래퍼가 없는 응답도 방어적으로 허용
  const result = isRecord(runResponse['result']) ? (runResponse['result'] as Record<string, unknown>) : runResponse;
  const out: ExtractedMessage[] = [];

  const responses = result['responses'];
  if (Array.isArray(responses) && responses.length > 0) {
    // v2 우선 (§9-3)
    for (const item of responses) {
      const message = isRecord(item) ? item['message'] : item;
      const m = toExtractedMessage(message);
      if (m !== null) out.push(m);
    }
    return out;
  }

  const choices = result['choices'];
  if (Array.isArray(choices)) {
    // 레거시 — 원소가 string이거나 { message | text } 객체
    for (const item of choices) {
      const message = isRecord(item) ? (item['message'] ?? item['text']) : item;
      const m = toExtractedMessage(message);
      if (m !== null) out.push(m);
    }
  }
  return out;
}

/* ---------- 스트림 텍스트 ---------- */

/** 같은 객체 안에 여러 후보 키가 있으면 이 우선순위로 선택 */
const STREAM_TEXT_KEYS = ['message', 'text', 'answer'] as const;

/** 스트림 JSON 조각에서 사람이 읽을 텍스트 후보 추출 (후보 키: message, text, answer — BFS).
    문자열 값은 tryExtractDraftJs 먼저 시도. 없으면 null. */
export function extractStreamText(value: unknown): string | null {
  // 조각 자체가 string인 경우도 처리 (§9-2 — 스키마 미문서화)
  if (typeof value === 'string') {
    if (value === '') return null;
    return tryExtractDraftJs(value) ?? value;
  }
  const MAX_DEPTH = 8;
  const queue: BfsEntry[] = [{ node: value, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (Array.isArray(node)) {
      if (depth < MAX_DEPTH) for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    if (!isRecord(node)) continue;
    for (const key of STREAM_TEXT_KEYS) {
      const v = node[key];
      if (typeof v === 'string' && v !== '') {
        return tryExtractDraftJs(v) ?? v;
      }
    }
    if (depth < MAX_DEPTH) {
      for (const v of Object.values(node)) queue.push({ node: v, depth: depth + 1 });
    }
  }
  return null;
}

/* ---------- 목록 정규화 ---------- */

const LIST_MAX_DEPTH = 6;

function isAppItem(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['type'] === 'string'
  );
}

/** 앱 목록 응답 정규화 — 목록 래퍼 키가 OpenAPI에 미상세하므로
    deep-scan으로 { id, name, type }을 가진 객체 배열을 찾는다. nextCursor는 마지막 항목의 cursor. */
export function extractAppsList(resp: unknown): { apps: AppInfo[]; nextCursor?: string } {
  const arr = deepFindMatchingArray(resp, LIST_MAX_DEPTH, isAppItem);
  if (arr === null) return { apps: [] };
  const apps = arr as unknown as AppInfo[];
  const nextCursor = findListCursor(resp, arr, LIST_MAX_DEPTH) ?? lastItemCursor(arr);
  return nextCursor !== undefined ? { apps, nextCursor } : { apps };
}

function isKbNodeItem(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v['id'] === 'string' &&
    ('nodeType' in v || 'processState' in v || 'hashtags' in v)
  );
}

/** KB 검색 응답 정규화 — { id, nodeType? }를 가진 객체 배열을 deep-scan */
export function extractKbNodes(resp: unknown): { nodes: KbNode[]; nextCursor?: string } {
  const arr = deepFindMatchingArray(resp, LIST_MAX_DEPTH, isKbNodeItem);
  if (arr === null) return { nodes: [] };
  const nodes = arr as unknown as KbNode[];
  const nextCursor = findListCursor(resp, arr, LIST_MAX_DEPTH) ?? lastItemCursor(arr);
  return nextCursor !== undefined ? { nodes, nextCursor } : { nodes };
}
