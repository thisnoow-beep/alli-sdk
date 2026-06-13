/* Flow 5 — 문서 Replace (SSOT §4 Flow 5, §5.8~5.11, §9-5)
   KB 업로드에는 overwrite 시맨틱이 없으므로(§9-5) "업로드 → 완료 확인 → 삭제" 조합으로 교체한다.
   상태 전이는 순수 리듀서(replace-machine.ts)가 전담하고, 이 화면은
   dispatch → renderPhase → runEffects(업로드/폴링/삭제/롤백 부수효과) 드라이버만 담당한다.
   ① 기존 문서 검색(구 노드 선택) ② 새 파일 업로드 폼(해시태그 승계) ③ 실행(스테퍼 + 확인 모달) 3구역. */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl, textPart, filePart, type MultipartPart } from '../core/request-spec';
import type { IngestionStatus, KbNode, KbSearchBody } from '../core/types';
import { extractKbNodes } from '../core/extract';
import {
  REPLACE_POLL,
  initialReplaceState,
  replaceReducer,
  isTerminal,
  type ReplaceEvent,
  type ReplaceMachineState,
  type ReplacePhase,
} from '../core/replace-machine';
import { session } from '../state/session';
import { getClient } from '../state/client';
import { badge, banner, button, checkbox, copyButton, field, page, spinner, textInput } from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView, type RawData } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';
import { stepper } from '../ui/stepper';
import { confirmModal } from '../ui/modal';

const ORDER_WARNING =
  "⚠️ 순서 주의 — '삭제 후 업로드'가 아니라 '업로드 → 완료 확인 → 삭제'. 삭제를 먼저 하면 (a) 업로드 실패 시 문서가 소실되고 (b) 인제스천이 끝날 때까지 검색 공백이 생깁니다.";
const COEXIST_NOTE = '교체 중에는 같은 이름의 문서가 일시적으로 2개 공존합니다.';

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sec(ms: number): number {
  return Math.round(ms / 1000);
}

/** raw 뷰 요청 본문 표시용 — multipart 파트 요약 (§7-3) */
function partsSummary(parts: MultipartPart[]): string {
  return [
    'multipart/form-data — boundary는 전송 시 자동 생성',
    ...parts.map((p) =>
      p.kind === 'text'
        ? `${p.name} (text): ${p.value ?? ''}`
        : `${p.name} (file): ${p.file?.name ?? ''} · ${p.file?.size ?? 0} bytes`,
    ),
  ].join('\n');
}

function processStateBadge(ps: string | undefined): HTMLElement {
  if (!ps) return el('span', { class: 'muted' }, '—');
  if (REPLACE_POLL.success.includes(ps)) return badge(ps, 'success');
  if (REPLACE_POLL.failure.includes(ps)) return badge(ps, 'warn');
  return badge(ps, 'default');
}

export function render(container: HTMLElement): () => void {
  // ---- ① 검색 상태 ----
  let searchTerm = '';
  let searching = false;
  let searchError: unknown = null;
  let nodes: KbNode[] = [];
  let searchSeq = 0;
  let oldNode: KbNode | null = null;

  // ---- ② 업로드 폼 상태 ----
  let file: File | null = null;
  let fileName = '';
  let hashtagsText = '';
  let targetFolderId = '';
  let useLayout = true;
  let useImageDescription = true;
  let useOcr = false;
  let autoAdvance = false; // 켜면 확인 모달 없이 진행 — 생성 코드의 무인 동작과 동일

  // ---- ③ 상태 머신 + 폴링 드라이버 ----
  let state: ReplaceMachineState = initialReplaceState;
  let runSeq = 0; // RESET/화면 이탈 후 도착한 비동기 결과 폐기용
  let pollTimer: number | undefined;
  let pollBusy = false;
  let pollDelay: number = REPLACE_POLL.initialMs;
  let pollStartedAt = 0;
  let lastError: unknown = null; // 업로드/삭제/롤백 실패의 원본 에러 (errorPanel용)
  let lastPollError: unknown = null; // 폴링 tick 일시 오류 — 다음 tick에서 재시도
  let lastRaw: RawData | null = null;

  const parseHashtags = (): string[] =>
    hashtagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  /** 업로드 parts — 실행·코드 생성이 이 한 함수를 공유한다 (패리티) */
  const buildParts = (): MultipartPart[] => [
    ...textPart('fileName', fileName.trim()),
    ...(file ? [filePart('file', file)] : []),
    ...parseHashtags().flatMap((tag) => textPart('hashtags', tag)), // §5.9 — 태그당 파트 반복
    ...textPart('targetFolderId', targetFolderId.trim()),
    ...textPart('useLayout', useLayout ? 'true' : 'false'),
    ...textPart('useImageDescription', useImageDescription ? 'true' : 'false'),
    ...textPart('useOcr', useOcr ? 'true' : 'false'),
  ];

  // ---- 코드 생성 패널 — 구 노드 + 파일이 준비되면 kb-replace 래퍼(폴링 루프 포함) ----
  const code = codePanel(
    () => {
      if (!oldNode || !file) return null;
      return {
        spec: specs.kbUpload(buildParts()),
        wrapper: {
          kind: 'kb-replace',
          oldNodeId: oldNode.id,
          pollInitialMs: REPLACE_POLL.initialMs,
          pollMaxMs: REPLACE_POLL.maxMs,
          pollTimeoutMs: REPLACE_POLL.timeoutMs,
        },
      };
    },
    () => {
      const cfg = session.get();
      return {
        baseUrl: cfg.baseUrl,
        ownUserId: cfg.ownUserId.trim() || undefined,
        userEmail: cfg.userEmail.trim() || undefined,
      };
    },
  );

  // ---- 슬롯 ----
  const searchSlot = el('div', {});
  const selectionSlot = el('div', {});
  const phaseSlot = el('div', {});
  const rawSlot = el('div', {});
  const rawDetails = el(
    'details',
    {},
    el('summary', { class: 't-caption muted', style: 'cursor: pointer; user-select: none;' }, 'Raw 요청/응답 — 마지막 호출'),
    el('div', { style: 'margin-top: 12px;' }, rawSlot),
  );
  rawDetails.style.display = 'none';

  function renderRaw(): void {
    clear(rawSlot);
    if (lastRaw === null) {
      rawDetails.style.display = 'none';
      return;
    }
    rawDetails.style.display = '';
    rawSlot.appendChild(rawView(lastRaw));
  }

  // ---- 스테퍼 (4단계) ----
  const steps = stepper([
    { id: 'select', title: '기존 문서 선택' },
    { id: 'upload', title: '새 파일 업로드' },
    { id: 'ingest', title: '인제스천 대기' },
    { id: 'delete', title: '구 문서 삭제' },
  ]);

  // ---- ① 기존 문서 검색 (§5.8) ----
  const searchBody = (): KbSearchBody => ({
    filter_: { searchTerm: searchTerm.trim() || undefined, nodeType: ['file'] },
    limit: 10,
  });

  async function search(): Promise<void> {
    const seq = ++searchSeq;
    searching = true;
    searchError = null;
    renderSearch();

    const body = searchBody();
    const spec = specs.kbSearch(body);
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== searchSeq) return;
      nodes = extractKbNodes(res.data).nodes;
      lastRaw = {
        request: {
          method: spec.method,
          url: buildUrl(client.cfg.baseUrl, spec),
          headers: client.buildHeaders(spec),
          body: JSON.stringify(body, null, 2),
        },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
    } catch (e) {
      if (seq !== searchSeq) return;
      searchError = e;
    }
    searching = false;
    renderSearch();
    renderRaw();
  }

  function selectOldNode(node: KbNode): void {
    if (state.phase !== 'idle') return; // 교체 진행 중에는 구 노드 변경 금지
    oldNode = node;
    hashtagsText = (node.hashtags ?? []).join(', '); // §4-5-2 — 구 노드 해시태그 승계
    hashtagsInput.value = hashtagsText;
    renderSearch();
    renderSelection();
    renderPhase();
    code.refresh();
  }

  function nodeRow(node: KbNode): HTMLTableRowElement {
    return el(
      'tr',
      { class: `selectable${node.id === oldNode?.id ? ' selected' : ''}`, onclick: () => selectOldNode(node) },
      el('td', {}, node.name ?? '(이름 없음)'),
      el('td', { style: 'font-family: var(--font-mono); font-size: 12px; word-break: break-all;' }, node.id),
      el(
        'td',
        {},
        node.hashtags?.length
          ? el('div', { class: 'row', style: 'flex-wrap: wrap; gap: 4px;' }, ...node.hashtags.map((t) => badge(`#${t}`)))
          : '—',
      ),
      el('td', {}, node.status ? badge(node.status, node.status === 'on' ? 'on' : 'default') : '—'),
      el('td', {}, processStateBadge(node.processState)),
    );
  }

  function renderSearch(): void {
    clear(searchSlot);
    if (searching) {
      searchSlot.appendChild(
        el('div', { class: 'row' }, spinner(), el('span', { class: 't-caption muted' }, 'POST /webapi/v2/knowledge_base_nodes/search 호출 중')),
      );
      return;
    }
    if (searchError !== null) {
      searchSlot.append(
        errorPanel(searchError, 'kb'),
        el('div', { style: 'margin-top: 12px;' }, button('다시 시도', { small: true, onClick: () => void search() })),
      );
      return;
    }
    if (nodes.length === 0) {
      searchSlot.appendChild(el('div', { class: 'empty-state' }, '검색 결과가 없습니다 — 검색어를 바꿔 다시 시도하세요'));
      return;
    }
    searchSlot.appendChild(
      el(
        'table',
        { class: 'table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, '이름'), el('th', {}, 'ID'), el('th', {}, '해시태그'), el('th', {}, 'status'), el('th', {}, 'processState')),
        ),
        el('tbody', {}, ...nodes.map((n) => nodeRow(n))),
      ),
    );
  }

  function renderSelection(): void {
    clear(selectionSlot);
    if (!oldNode) {
      selectionSlot.appendChild(el('span', { class: 't-caption muted' }, '교체할 기존 문서(구 노드)를 아래 목록에서 선택하세요'));
      return;
    }
    selectionSlot.appendChild(
      el(
        'div',
        { class: 'row', style: 'flex-wrap: wrap;' },
        badge('구 노드 선택됨', 'on'),
        el('span', { class: 't-body-sm' }, oldNode.name ?? '(이름 없음)'),
        el('span', { class: 't-caption muted', style: 'font-family: var(--font-mono); word-break: break-all;' }, oldNode.id),
        copyButton(() => oldNode?.id ?? '', 'ID 복사'),
        ...(oldNode.hashtags ?? []).map((t) => badge(`#${t}`)),
      ),
    );
  }

  // ---- ② 업로드 폼 컨트롤 ----
  const fileNameInput = textInput({
    mono: true,
    placeholder: '예: 취업규칙_v3.pdf',
    value: fileName,
    onInput: (v) => {
      fileName = v;
      renderPhase();
      code.refresh();
    },
  }) as HTMLInputElement;

  const fileInput = el('input', {
    type: 'file',
    class: 'input',
    onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0] ?? null;
      file = f;
      if (f) {
        fileName = f.name; // 파일 선택 시 자동 채움 (수정 가능)
        fileNameInput.value = f.name;
      }
      renderPhase();
      code.refresh();
    },
  });

  const hashtagsInput = textInput({
    mono: true,
    placeholder: '인사규정, 회계 (쉼표 구분)',
    value: hashtagsText,
    onInput: (v) => {
      hashtagsText = v;
      code.refresh();
    },
  }) as HTMLInputElement;

  const targetFolderInput = textInput({
    mono: true,
    placeholder: '비우면 루트에 업로드',
    value: targetFolderId,
    onInput: (v) => {
      targetFolderId = v;
      code.refresh();
    },
  });

  // ---- ③ 실행 — 머신 드라이버 ----
  function stopPolling(): void {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  function dispatch(ev: ReplaceEvent): void {
    const prev = state.phase;
    state = replaceReducer(state, ev);
    if (ev.type === 'RESET') {
      stopPolling();
      runSeq++;
      lastError = null;
      lastPollError = null;
    }
    renderPhase();
    runEffects(prev);
  }

  /** phase 진입 시 1회성 부수효과 실행 — polling만 tick마다 재스케줄 */
  function runEffects(prevPhase: ReplacePhase): void {
    switch (state.phase) {
      case 'uploading':
        if (prevPhase !== 'uploading') void doUpload();
        break;
      case 'polling':
        if (prevPhase !== 'polling') {
          // 진입(UPLOAD_OK/CONTINUE_POLLING)마다 간격·경과 시계 초기화
          pollDelay = REPLACE_POLL.initialMs;
          pollStartedAt = Date.now();
          lastPollError = null;
        }
        schedulePoll();
        break;
      case 'confirm_delete_old':
        if (prevPhase !== 'confirm_delete_old') {
          if (autoAdvance) dispatch({ type: 'CONFIRM_DELETE' }); // 무인 동작 — 생성 코드와 동일
          else void confirmDeleteOld();
        }
        break;
      case 'confirm_rollback':
        if (prevPhase !== 'confirm_rollback') {
          if (autoAdvance) dispatch({ type: 'ROLLBACK' });
          else void confirmRollback();
        }
        break;
      case 'deleting_old':
        if (prevPhase !== 'deleting_old') void doDeleteOld(); // RETRY_DELETE 재진입 포함
        break;
      case 'rolling_back':
        if (prevPhase !== 'rolling_back') void doRollback();
        break;
      default:
        break;
    }
  }

  async function doUpload(): Promise<void> {
    const seq = runSeq;
    const parts = buildParts();
    const spec = specs.kbUpload(parts);
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== runSeq) return;
      lastRaw = {
        request: {
          method: spec.method,
          url: buildUrl(client.cfg.baseUrl, spec),
          headers: client.buildHeaders(spec),
          body: partsSummary(parts),
        },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
      renderRaw();
      const newId = extractKbNodes(res.data).nodes[0]?.id;
      if (newId === undefined) {
        dispatch({ type: 'UPLOAD_FAIL', error: '업로드 응답에서 새 노드 id를 찾지 못했습니다 — 응답 형식이 예상과 다릅니다. Raw 뷰에서 응답 본문을 확인하세요' });
        return;
      }
      dispatch({ type: 'UPLOAD_OK', newNodeId: newId });
    } catch (e) {
      if (seq !== runSeq) return;
      lastError = e;
      dispatch({ type: 'UPLOAD_FAIL', error: msg(e) });
    }
  }

  function schedulePoll(): void {
    if (pollTimer !== undefined || pollBusy) return;
    pollTimer = window.setTimeout(() => void pollTick(), pollDelay);
  }

  async function pollTick(): Promise<void> {
    pollTimer = undefined;
    if (state.phase !== 'polling') return;
    const newNodeId = state.ctx.newNodeId;
    if (newNodeId === undefined) return;

    // 타임아웃 판정 — REPLACE_POLL.timeoutMs 초과 시 사용자 결정으로 이관
    if (Date.now() - pollStartedAt > REPLACE_POLL.timeoutMs) {
      dispatch({ type: 'POLL_TIMEOUT' });
      return;
    }

    const seq = runSeq;
    const spec = specs.ingestionStatus(newNodeId);
    pollBusy = true;
    try {
      const client = getClient();
      const res = await client.execute(spec);
      pollBusy = false;
      if (seq !== runSeq || state.phase !== 'polling') return;
      lastRaw = {
        request: { method: spec.method, url: buildUrl(client.cfg.baseUrl, spec), headers: client.buildHeaders(spec) },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
      renderRaw();
      lastPollError = null;
      const status = ((res.data ?? {}) as IngestionStatus).status ?? 'unknown';
      pollDelay = Math.min(Math.round(pollDelay * 1.5), REPLACE_POLL.maxMs); // 2s → ×1.5 → 최대 5s
      dispatch({ type: 'POLL_TICK', status, elapsedMs: Date.now() - pollStartedAt });
    } catch (e) {
      pollBusy = false;
      if (seq !== runSeq || state.phase !== 'polling') return;
      // 일시 오류로 간주하고 계속 폴링 — 지속되면 타임아웃이 await_decision으로 보낸다
      lastPollError = e;
      pollDelay = Math.min(Math.round(pollDelay * 1.5), REPLACE_POLL.maxMs);
      renderPhase();
      schedulePoll();
    }
  }

  async function confirmDeleteOld(): Promise<void> {
    const seq = runSeq;
    const name = oldNode?.name ?? '(이름 없음)';
    const ok = await confirmModal({
      danger: true,
      title: '구 문서 삭제',
      body: `구 노드(${name} / ${state.ctx.oldNodeId ?? ''}) 삭제 — 새 문서 인제스천 완료 확인됨`,
      confirmLabel: '삭제',
    });
    if (seq !== runSeq || state.phase !== 'confirm_delete_old') return;
    dispatch(ok ? { type: 'CONFIRM_DELETE' } : { type: 'STOP' });
  }

  async function confirmRollback(): Promise<void> {
    const seq = runSeq;
    const ok = await confirmModal({
      danger: true,
      title: '롤백 — 새 노드 삭제',
      body: `인제스천 실패(상태 ${state.ctx.lastStatus ?? '—'}) — 새 노드(${state.ctx.newNodeId ?? ''})를 삭제합니다. 구 문서는 그대로 유지됩니다.`,
      confirmLabel: '롤백',
    });
    if (seq !== runSeq || state.phase !== 'confirm_rollback') return;
    dispatch(ok ? { type: 'ROLLBACK' } : { type: 'STOP' });
  }

  async function doDeleteOld(): Promise<void> {
    const seq = runSeq;
    const id = state.ctx.oldNodeId;
    if (id === undefined) {
      dispatch({ type: 'DELETE_OLD_FAIL', error: '구 노드 id가 없습니다' });
      return;
    }
    const spec = specs.kbDelete(id);
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== runSeq) return;
      lastRaw = {
        request: { method: spec.method, url: buildUrl(client.cfg.baseUrl, spec), headers: client.buildHeaders(spec) },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
      renderRaw();
      dispatch({ type: 'DELETE_OLD_OK' });
    } catch (e) {
      if (seq !== runSeq) return;
      lastError = e;
      dispatch({ type: 'DELETE_OLD_FAIL', error: msg(e) });
    }
  }

  async function doRollback(): Promise<void> {
    const seq = runSeq;
    const id = state.ctx.newNodeId;
    if (id === undefined) {
      dispatch({ type: 'ROLLBACK_FAIL', error: '새 노드 id가 없습니다' });
      return;
    }
    const spec = specs.kbDelete(id);
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== runSeq) return;
      lastRaw = {
        request: { method: spec.method, url: buildUrl(client.cfg.baseUrl, spec), headers: client.buildHeaders(spec) },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
      renderRaw();
      dispatch({ type: 'ROLLBACK_OK' });
    } catch (e) {
      if (seq !== runSeq) return;
      lastError = e;
      dispatch({ type: 'ROLLBACK_FAIL', error: msg(e) });
    }
  }

  // ---- 실행 컨트롤 ----
  const startBtn = button('교체 시작', {
    onClick: () => {
      if (state.phase !== 'idle' || !oldNode || !file || !fileName.trim()) return;
      lastError = null;
      lastPollError = null;
      dispatch({ type: 'UPLOAD_START', oldNodeId: oldNode.id });
    },
  });

  function updateStartBtn(): void {
    startBtn.disabled = !(state.phase === 'idle' && oldNode !== null && file !== null && fileName.trim() !== '');
  }

  // ---- 스테퍼 상태 매핑 ----
  function renderSteps(): void {
    const { phase, ctx } = state;
    const pollDetail = `상태 ${ctx.lastStatus ?? '—'} · ${ctx.attempts}회 시도 · ${sec(ctx.elapsedMs)}초 경과`;
    const newLabel = `새 노드 ${ctx.newNodeId ?? '—'}`;

    steps.reset();
    if (oldNode) steps.setState('select', 'done', `${oldNode.name ?? '(이름 없음)'} · ${oldNode.id}`);
    else steps.setState('select', 'active', '아래 검색에서 교체할 문서를 선택하세요');

    switch (phase) {
      case 'idle':
        if (file) steps.setState('upload', 'pending', `${fileName.trim() || file.name} 준비됨`);
        break;
      case 'uploading':
        steps.setState('upload', 'active', `${fileName.trim()} 업로드 중`);
        break;
      case 'upload_failed':
        steps.setState('upload', 'failed', ctx.error ?? '');
        break;
      case 'polling':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'active', pollDetail);
        break;
      case 'await_decision':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'active', `${pollDetail} — 타임아웃, 결정 대기`);
        break;
      case 'confirm_rollback':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'failed', pollDetail);
        steps.setState('delete', 'pending', '롤백 확인 대기 (새 노드 삭제)');
        break;
      case 'rolling_back':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'failed', pollDetail);
        steps.setState('delete', 'active', '롤백 — 새 노드 삭제 중');
        break;
      case 'rolled_back':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'failed', pollDetail);
        steps.setState('delete', 'done', '롤백 — 새 노드 삭제됨 (구 문서 유지)');
        break;
      case 'rollback_failed':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'failed', pollDetail);
        steps.setState('delete', 'failed', '새 노드 삭제 실패 — 수동 정리 필요');
        break;
      case 'confirm_delete_old':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'done', pollDetail);
        steps.setState('delete', 'active', autoAdvance ? '자동 진행' : '삭제 확인 대기');
        break;
      case 'deleting_old':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'done', pollDetail);
        steps.setState('delete', 'active', 'DELETE 호출 중');
        break;
      case 'delete_old_failed':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'done', pollDetail);
        steps.setState('delete', 'failed', ctx.error ?? '');
        break;
      case 'success':
        steps.setState('upload', 'done', newLabel);
        steps.setState('ingest', 'done', pollDetail);
        steps.setState('delete', 'done', '구 노드 삭제됨');
        break;
      case 'stopped': {
        const from = ctx.stoppedFrom;
        steps.setState('upload', 'done', newLabel);
        if (from === 'confirm_delete_old' || from === 'delete_old_failed') {
          steps.setState('ingest', 'done', pollDetail);
          steps.setState('delete', 'failed', '중단됨 — 구 문서 유지');
        } else if (from === 'confirm_rollback') {
          steps.setState('ingest', 'failed', `${pollDetail} — 중단됨`);
        } else {
          steps.setState('ingest', 'failed', '타임아웃 후 중단됨');
        }
        break;
      }
    }
  }

  // ---- phase별 실행 영역 렌더 ----
  function renderPhase(): void {
    renderSteps();
    updateStartBtn();
    clear(phaseSlot);
    const { phase, ctx } = state;

    switch (phase) {
      case 'idle':
        phaseSlot.appendChild(
          el(
            'span',
            { class: 't-caption muted' },
            '구 문서와 새 파일을 선택하고 "교체 시작"을 누르세요 — 업로드 → 인제스천 확인 → 삭제 순으로 진행됩니다.',
          ),
        );
        break;
      case 'uploading':
        phaseSlot.appendChild(
          el('div', { class: 'row' }, spinner(), el('span', { class: 't-caption muted' }, 'POST /webapi/v2/knowledge_base_nodes/upload 호출 중')),
        );
        break;
      case 'polling':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            el(
              'div',
              { class: 'row' },
              spinner(),
              el('span', { class: 't-caption muted' }, `GET /webapi/v2/ingestion_status/${ctx.newNodeId ?? ''} 폴링 중 — 다음 호출 ${sec(pollDelay)}초 후`),
            ),
            lastPollError !== null
              ? el(
                  'div',
                  { class: 'stack', style: 'gap: 8px;' },
                  errorPanel(lastPollError, 'kb'),
                  el('span', { class: 't-caption muted' }, '폴링 일시 오류 — 다음 폴링에서 재시도합니다 (지속되면 타임아웃 후 결정 화면으로 이동)'),
                )
              : null,
          ),
        );
        break;
      case 'await_decision':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner(
              `폴링 타임아웃 — ${Math.round(REPLACE_POLL.timeoutMs / 60000)}분 동안 인제스천이 끝나지 않았습니다 (마지막 상태 ${ctx.lastStatus ?? '—'}). 어떻게 할까요?`,
              'warn',
            ),
            el(
              'div',
              { class: 'row', style: 'flex-wrap: wrap;' },
              button('계속 폴링', { onClick: () => dispatch({ type: 'CONTINUE_POLLING' }) }),
              button('롤백 (새 노드 삭제)', { variant: 'warn', onClick: () => dispatch({ type: 'ROLLBACK' }) }),
              button('중단', { variant: 'quiet', onClick: () => dispatch({ type: 'STOP' }) }),
            ),
          ),
        );
        break;
      case 'confirm_rollback':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner(`인제스천 실패 — 상태 ${ctx.lastStatus ?? '—'}. 구 문서는 아직 그대로입니다.`, 'warn'),
            el('span', { class: 't-caption muted' }, '확인 모달에서 롤백(새 노드 삭제) 여부를 선택하세요 — 취소하면 중단됩니다.'),
          ),
        );
        break;
      case 'rolling_back':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'row' },
            spinner(),
            el('span', { class: 't-caption muted' }, `DELETE /webapi/v2/knowledge_base_nodes/${ctx.newNodeId ?? ''} 호출 중 (롤백 — 새 노드 삭제)`),
          ),
        );
        break;
      case 'confirm_delete_old':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner(`인제스천 완료 — 상태 ${ctx.lastStatus ?? '—'}. 새 문서가 활성화되었습니다.`, 'success'),
            autoAdvance
              ? null
              : el('span', { class: 't-caption muted' }, '확인 모달에서 구 문서 삭제를 승인하세요 — 취소하면 두 문서가 공존한 채 중단됩니다.'),
          ),
        );
        break;
      case 'deleting_old':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'row' },
            spinner(),
            el('span', { class: 't-caption muted' }, `DELETE /webapi/v2/knowledge_base_nodes/${ctx.oldNodeId ?? ''} 호출 중 (구 문서 삭제)`),
          ),
        );
        break;
      case 'delete_old_failed':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner('구 문서 삭제 실패 — 새 문서는 활성 상태입니다. 같은 이름의 문서 2개가 공존 중입니다.', 'warn'),
            lastError !== null ? errorPanel(lastError, 'kb') : el('span', { class: 't-caption muted' }, ctx.error ?? ''),
            el(
              'div',
              { class: 'row' },
              button('재시도', { onClick: () => dispatch({ type: 'RETRY_DELETE' }) }),
              button('중단', { variant: 'quiet', onClick: () => dispatch({ type: 'STOP' }) }),
            ),
          ),
        );
        break;
      case 'success':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner(`교체 완료 — 새 노드 ${ctx.newNodeId ?? ''} 활성, 구 노드 삭제됨`, 'success'),
            ctx.newNodeId !== undefined
              ? el('div', { class: 'row' }, el('span', { class: 't-caption muted' }, '새 노드 ID'), copyButton(() => ctx.newNodeId ?? '', 'ID 복사'))
              : null,
          ),
        );
        break;
      case 'rolled_back':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner('롤백 완료 — 구 문서 유지, 새 노드 삭제됨', 'default'),
          ),
        );
        break;
      case 'rollback_failed':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            banner(`새 노드 삭제 실패 — 대시보드에서 수동 정리 필요: ${ctx.newNodeId ?? ''}`, 'warn'),
            lastError !== null ? errorPanel(lastError, 'kb') : null,
          ),
        );
        break;
      case 'upload_failed':
        phaseSlot.appendChild(
          el(
            'div',
            { class: 'stack', style: 'gap: 12px;' },
            lastError !== null ? errorPanel(lastError, 'kb') : banner(`업로드 실패 — ${ctx.error ?? ''}`, 'warn'),
            banner('구 문서는 무사합니다 — 삭제 전에 실패했기 때문입니다 ("업로드 → 확인 → 삭제" 순서의 이유).', 'default'),
          ),
        );
        break;
      case 'stopped': {
        const from = ctx.stoppedFrom;
        let note: HTMLElement;
        if (from === 'confirm_delete_old' || from === 'delete_old_failed') {
          note = banner(
            '중단됨 — 새 문서가 활성화된 채 구 문서가 남아 있습니다. 같은 이름의 문서 2개가 공존합니다 (정리: 대시보드 또는 처음부터 다시 진행).',
            'warn',
          );
        } else if (from === 'confirm_rollback') {
          note = banner(
            `중단됨 — 인제스천 실패한 새 노드(${ctx.newNodeId ?? ''})가 삭제되지 않고 남아 있습니다. 대시보드에서 정리하세요. 구 문서는 유지됩니다.`,
            'warn',
          );
        } else if (from === 'await_decision') {
          note = banner(
            `중단됨 — 인제스천이 끝나지 않은 새 노드(${ctx.newNodeId ?? ''})가 남아 있습니다. 나중에 완료되면 같은 이름의 문서 2개가 공존합니다.`,
            'warn',
          );
        } else {
          note = banner('중단됨', 'warn');
        }
        phaseSlot.appendChild(el('div', { class: 'stack', style: 'gap: 12px;' }, note));
        break;
      }
    }

    // 터미널 상태 공통 — RESET 외 액션 없음, '처음부터'로 폴링 정리 + idle 복귀
    if (isTerminal(phase)) {
      phaseSlot.appendChild(
        el('div', { style: 'margin-top: 12px;' }, button('처음부터', { variant: 'quiet', onClick: () => dispatch({ type: 'RESET' }) })),
      );
    }
  }

  // ---- ① 검색 바 ----
  const searchInput = textInput({
    placeholder: '문서 이름 검색 — 예: 취업규칙',
    value: searchTerm,
    onInput: (v) => {
      searchTerm = v;
    },
    onEnter: () => void search(),
  });
  const searchField = field('검색어', searchInput, {
    hint: 'POST /webapi/v2/knowledge_base_nodes/search — filter_.searchTerm + nodeType: ["file"], limit 10',
  });
  searchField.style.flex = '1';
  searchField.style.minWidth = '200px';

  // ---- 레이아웃 (3구역) ----
  container.appendChild(
    page(
      '문서 교체',
      '문서 업로드 API에는 덮어쓰기(overwrite) 기능이 없습니다 — "업로드 → 완료 확인 → 삭제" 조합으로 개정 문서를 안전하게 교체합니다.',
      el(
        'div',
        { class: 'stack', style: 'gap: 16px;' },
        el('div', { class: 't-title-sm' }, '① 기존 문서 검색'),
        el('div', { class: 'row', style: 'align-items: flex-end;' }, searchField, button('검색', { onClick: () => void search() })),
        selectionSlot,
        searchSlot,
      ),
      el(
        'div',
        { class: 'grid-2col', style: 'margin-top: 32px;' },
        el(
          'div',
          { class: 'stack' },
          el('div', { class: 't-title-sm' }, '② 새 파일 업로드'),
          field('파일 (단일)', fileInput, { hint: 'PDF/Word/PPT/Excel/HTML/TXT' }),
          field('fileName', fileNameInput, {
            hint: "파일 선택 시 자동 채움 — 수정 가능. 데모: 'fail'을 포함하면 인제스천 실패(parsing_fail) → 롤백 경로를 볼 수 있습니다",
          }),
          field('hashtags', hashtagsInput, { hint: '쉼표 구분 — 구 노드 선택 시 자동 승계됩니다' }),
          field('targetFolderId (옵션)', targetFolderInput, { hint: '구 문서와 같은 폴더를 지정하면 위치가 유지됩니다' }),
          checkbox('useLayout — 레이아웃 분석', {
            checked: useLayout,
            onChange: (v) => {
              useLayout = v;
              code.refresh();
            },
          }),
          checkbox('useImageDescription — 이미지 설명 생성', {
            checked: useImageDescription,
            onChange: (v) => {
              useImageDescription = v;
              code.refresh();
            },
          }),
          checkbox('useOcr — OCR 처리', {
            checked: useOcr,
            onChange: (v) => {
              useOcr = v;
              code.refresh();
            },
          }),
        ),
        el(
          'div',
          { class: 'stack' },
          el('div', { class: 't-title-sm' }, '③ 실행'),
          banner(ORDER_WARNING, 'warn'),
          banner(COEXIST_NOTE, 'default'),
          checkbox('자동 진행 — 확인 모달 없이 진행 (생성 코드의 무인 동작과 동일)', {
            checked: autoAdvance,
            onChange: (v) => {
              autoAdvance = v;
              renderPhase();
            },
          }),
          el('div', {}, startBtn),
          steps.el,
          phaseSlot,
          code.el,
        ),
      ),
      el('div', { style: 'margin-top: 24px;' }, rawDetails),
    ),
  );

  renderSelection();
  renderPhase();
  renderRaw();
  code.refresh();
  void search();

  // cleanup — 폴링 타이머 정리 + 진행 중 비동기 결과 폐기
  return () => {
    runSeq++;
    searchSeq++;
    stopPolling();
  };
}
