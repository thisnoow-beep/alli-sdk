/* Flow 2 허브 — 앱 목록/상세 (SSOT §4 Flow 2의 1·2·4단계, §5.2/§5.3)
   필터 바(검색어 디바운스/유형/공개 여부)로 GET /webapi/v2/apps를 자동 재조회하고,
   행 클릭 시 GET /webapi/v2/apps/{app_id} 상세를 표시 + selectApp으로 다른 화면과 공유한다.
   유형 분기: single_action=답변형(run 가능) / skill·campaign=대화형(run 불가 — §4-2-4) / agent=에이전트형 */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl } from '../core/request-spec';
import type { AppInfo, AppType, ListAppsQuery } from '../core/types';
import { extractAppsList } from '../core/extract';
import { session } from '../state/session';
import { getClient } from '../state/client';
import { selectedApp, selectApp } from '../state/selection';
import { badge, banner, button, checkbox, copyButton, field, page, segmented, spinner, textInput } from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView, type RawData } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';

/* ---- 용어 매핑 (GLOSSARY 빠른 참조 — UI에 skill/캠페인 금지) ---- */

const TYPE_SHORT: Record<string, string> = {
  single_action: '답변형',
  skill: '대화형',
  campaign: '대화형', // campaign = 대화형 앱의 구명칭
  agent: '에이전트형',
};

function typeShortLabel(type: AppType): string {
  return TYPE_SHORT[type] ?? String(type);
}

function typeFullLabel(type: AppType): string {
  const short = TYPE_SHORT[type];
  return short !== undefined ? `${short} 앱` : String(type);
}

function publishedBadge(published: boolean | undefined): HTMLElement {
  return published ? badge('공개됨', 'on') : badge('작성 중', 'default');
}

type AppKind = 'single' | 'conversational' | 'agent' | 'unknown';

function appKind(type: AppType): AppKind {
  if (type === 'single_action') return 'single';
  if (type === 'skill' || type === 'campaign') return 'conversational';
  if (type === 'agent') return 'agent';
  return 'unknown';
}

/* §5.3 상세 응답은 §5.2와 동일 구조의 단건 — 래퍼 키가 미상세하므로 { id, name, type } 객체를 deep-scan */
function findAppObject(v: unknown, depth = 0): AppInfo | null {
  if (depth > 6 || v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findAppObject(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const r = v as Record<string, unknown>;
  if (typeof r['id'] === 'string' && typeof r['name'] === 'string' && typeof r['type'] === 'string') {
    return r as AppInfo;
  }
  for (const child of Object.values(r)) {
    const found = findAppObject(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

const ELLIPSIS_STYLE = 'max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
const DEBOUNCE_MS = 350;

export function render(container: HTMLElement): () => void {
  // ---- 필터/목록 상태 ----
  let searchTerm = '';
  let typeFilter: 'all' | 'single_action' | 'skill' = 'all';
  let publishedOnly = true; // '공개된 앱만' 기본 켬

  let apps: AppInfo[] = [];
  let nextCursor: string | undefined;
  let loadingMode: 'none' | 'reload' | 'more' = 'none';
  let lastError: unknown = null;
  let lastRaw: RawData | null = null;

  let querySeq = 0; // 필터 연타/디바운스 경합 시 늦게 도착한 응답 폐기용
  let detailSeq = 0;
  let detailLoading = false;
  let detailError: unknown = null;
  let debounceId: number | undefined;

  const currentQuery = (cursor?: string): ListAppsQuery => ({
    searchTerm: searchTerm.trim() || undefined,
    type: typeFilter === 'all' ? undefined : typeFilter,
    published: publishedOnly ? true : undefined,
    pageSize: 50,
    cursor,
  });

  // ---- 코드 생성 패널 (현재 필터 상태 기준 목록 조회 코드) ----
  const code = codePanel(
    () => ({ spec: specs.listApps(currentQuery()), wrapper: { kind: 'none' } }),
    () => {
      const cfg = session.get();
      return {
        baseUrl: cfg.baseUrl,
        ownUserId: cfg.ownUserId.trim() || undefined,
        userEmail: cfg.userEmail.trim() || undefined,
      };
    },
  );
  const refreshCode = (): void => code.refresh();

  // ---- 슬롯 ----
  const listSlot = el('div', {});
  const detailSlot = el('div', {});
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

  // ---- 목록 조회 (§5.2) — 필터 변경 시 자동 재조회, cursor 지정 시 다음 페이지 append ----
  async function load(cursor?: string): Promise<void> {
    const seq = ++querySeq;
    loadingMode = cursor === undefined ? 'reload' : 'more';
    lastError = null;
    renderList();

    const spec = specs.listApps(currentQuery(cursor));
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== querySeq) return;
      const extracted = extractAppsList(res.data);
      apps = cursor === undefined ? extracted.apps : [...apps, ...extracted.apps];
      nextCursor = extracted.nextCursor;
      lastRaw = {
        request: { method: spec.method, url: buildUrl(client.cfg.baseUrl, spec), headers: client.buildHeaders(spec) },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
    } catch (e) {
      if (seq !== querySeq) return;
      lastError = e;
    }
    loadingMode = 'none';
    renderList();
    renderRaw();
  }

  function scheduleReload(): void {
    if (debounceId !== undefined) clearTimeout(debounceId);
    debounceId = window.setTimeout(() => {
      debounceId = undefined;
      void load();
    }, DEBOUNCE_MS);
  }

  // ---- 상세 조회 (§5.3) — 행 클릭 시 단건 재조회로 최신 상태 표시 ----
  async function loadDetail(app: AppInfo): Promise<void> {
    const seq = ++detailSeq;
    detailLoading = true;
    detailError = null;
    renderDetail();

    const spec = specs.getApp(app.id);
    try {
      const client = getClient();
      const res = await client.execute(spec);
      if (seq !== detailSeq) return;
      const detail = findAppObject(res.data);
      if (detail !== null) selectApp({ ...app, ...detail });
      lastRaw = {
        request: { method: spec.method, url: buildUrl(client.cfg.baseUrl, spec), headers: client.buildHeaders(spec) },
        status: res.status,
        elapsedMs: res.elapsedMs,
        responseText: res.rawBody,
      };
    } catch (e) {
      if (seq !== detailSeq) return;
      detailError = e;
    }
    detailLoading = false;
    renderDetail();
    renderRaw();
  }

  // ---- 목록 렌더 ----
  function appRow(app: AppInfo, selectedId: string | undefined): HTMLTableRowElement {
    return el(
      'tr',
      {
        class: `selectable${app.id === selectedId ? ' selected' : ''}`,
        onclick: () => {
          selectApp(app);
          renderList();
          renderDetail();
          void loadDetail(app);
        },
      },
      el('td', {}, app.name),
      el('td', {}, badge(typeShortLabel(app.type))),
      el('td', {}, app.category || '—'),
      el('td', {}, publishedBadge(app.published)),
      el('td', { style: ELLIPSIS_STYLE, title: app.description || undefined }, app.description || '—'),
    );
  }

  function renderList(): void {
    clear(listSlot);

    if (loadingMode === 'reload') {
      listSlot.appendChild(
        el('div', { class: 'row' }, spinner(), el('span', { class: 't-caption muted' }, 'GET /webapi/v2/apps 호출 중')),
      );
      return;
    }
    if (lastError !== null) {
      listSlot.append(
        errorPanel(lastError, 'apps'),
        el('div', { style: 'margin-top: 12px;' }, button('다시 시도', { small: true, onClick: () => void load() })),
      );
      return;
    }
    if (apps.length === 0) {
      listSlot.appendChild(el('div', { class: 'empty-state' }, '조건에 맞는 앱이 없습니다 — 검색어나 필터를 조정해 보세요'));
      return;
    }

    const selectedId = selectedApp.get()?.id;
    listSlot.appendChild(
      el(
        'table',
        { class: 'table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, '이름'), el('th', {}, '유형'), el('th', {}, '카테고리'), el('th', {}, '게시'), el('th', {}, '설명')),
        ),
        el('tbody', {}, ...apps.map((app) => appRow(app, selectedId))),
      ),
    );

    const footer = el('div', { class: 'spread', style: 'margin-top: 12px;' }, el('span', { class: 't-caption muted' }, `${apps.length}개 표시`));
    if (nextCursor !== undefined) {
      footer.appendChild(
        button(loadingMode === 'more' ? '불러오는 중…' : '더 보기', {
          small: true,
          variant: 'quiet',
          disabled: loadingMode === 'more',
          onClick: () => {
            if (nextCursor !== undefined) void load(nextCursor);
          },
        }),
      );
    }
    listSlot.appendChild(footer);
  }

  // ---- 상세 패널 + 유형 분기 액션 (§4-2-4) ----
  function actionsFor(kind: AppKind): HTMLElement {
    if (kind === 'single') {
      return el('div', { class: 'row' }, button('실행 화면으로', { onClick: () => (location.hash = '#/run') }));
    }
    if (kind === 'conversational') {
      return el(
        'div',
        { class: 'stack', style: 'gap: 12px;' },
        banner(
          '실행 중간 사용자 입력(선택/메시지)이 필요한 대화형 앱은 run으로 실행할 수 없습니다 — 대화 또는 파일 첨부 플레이그라운드로 테스트하세요',
          'warn',
        ),
        el(
          'div',
          { class: 'row' },
          button('대화로 테스트', { onClick: () => (location.hash = '#/conversation') }),
          button('파일 첨부로 테스트', { onClick: () => (location.hash = '#/multipart') }),
          button('그래도 실행 화면으로', { variant: 'quiet', onClick: () => (location.hash = '#/run') }),
        ),
        el('span', { class: 'field-hint' }, '예외: 문서 업로드 후 LLM 노드를 실행하는 형태의 대화형 앱은 run 실행이 가능합니다'),
      );
    }
    if (kind === 'agent') {
      return el(
        'div',
        { class: 'stack', style: 'gap: 12px;' },
        el('div', {}, badge('에이전트형 앱', 'default')),
        el(
          'div',
          { class: 'row' },
          button('실행 화면으로', { onClick: () => (location.hash = '#/run') }),
          button('대화로 테스트', { onClick: () => (location.hash = '#/conversation') }),
        ),
      );
    }
    // 알 수 없는 유형 — 두 경로 모두 열어둔다
    return el(
      'div',
      { class: 'stack', style: 'gap: 12px;' },
      el('span', { class: 'field-hint' }, '알 수 없는 앱 유형입니다 — 실행 또는 대화로 테스트해 보세요'),
      el(
        'div',
        { class: 'row' },
        button('실행 화면으로', { onClick: () => (location.hash = '#/run') }),
        button('대화로 테스트', { onClick: () => (location.hash = '#/conversation') }),
      ),
    );
  }

  function renderDetail(): void {
    clear(detailSlot);
    const app = selectedApp.get();
    if (app === null) {
      detailSlot.appendChild(el('div', { class: 'empty-state' }, '목록에서 앱을 선택하면 상세 정보가 표시됩니다'));
      return;
    }

    detailSlot.appendChild(
      el(
        'div',
        { class: 'stack', style: 'gap: 12px;' },
        el('div', { class: 't-display-sm' }, app.name),
        el(
          'div',
          { class: 'row' },
          badge(typeFullLabel(app.type)),
          publishedBadge(app.published),
          detailLoading
            ? el('span', { class: 'row', style: 'gap: 8px;' }, spinner(), el('span', { class: 't-caption muted' }, '상세 조회 중'))
            : null,
        ),
        el(
          'div',
          { class: 'row' },
          el('span', { class: 't-caption muted' }, 'ID'),
          el('span', { style: 'font-family: var(--font-mono); font-size: 13px; word-break: break-all;' }, app.id),
          copyButton(() => app.id, 'ID 복사'),
        ),
        el('div', { class: 't-body-sm' }, el('span', { class: 'muted' }, '카테고리 — '), app.category || '없음'),
        app.description
          ? el('p', { class: 't-body-sm', style: 'margin: 0;' }, app.description)
          : el('p', { class: 't-body-sm muted', style: 'margin: 0;' }, '설명 없음'),
        detailError !== null ? errorPanel(detailError, 'apps') : null,
        actionsFor(appKind(app.type)),
      ),
    );
  }

  // ---- 필터 바 ----
  const searchField = field(
    '검색어',
    textInput({
      placeholder: '앱 이름/설명 검색',
      value: searchTerm,
      onInput: (v) => {
        searchTerm = v;
        refreshCode();
        scheduleReload();
      },
    }),
    { hint: '입력을 멈추면 자동 조회됩니다' },
  );
  searchField.style.flex = '1';
  searchField.style.minWidth = '200px';

  const filterBar = el(
    'div',
    { class: 'row', style: 'align-items: flex-end;' },
    searchField,
    field(
      '유형',
      segmented(
        [
          { value: 'all', label: '전체' },
          { value: 'single_action', label: '답변형' },
          { value: 'skill', label: '대화형' },
        ],
        typeFilter,
        (v) => {
          typeFilter = v as typeof typeFilter;
          refreshCode();
          void load();
        },
      ),
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, '공개 여부'),
      checkbox('공개된 앱만', {
        checked: publishedOnly,
        onChange: (v) => {
          publishedOnly = v;
          refreshCode();
          void load();
        },
      }),
    ),
  );

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '앱',
      '프로젝트의 앱 목록을 조회하고 테스트할 앱을 선택합니다. 선택한 앱은 실행/파일 첨부/대화 화면에서 공유됩니다.',
      el(
        'div',
        { class: 'grid-2col' },
        el('div', { class: 'stack' }, filterBar, listSlot),
        el('div', { class: 'stack' }, detailSlot, code.el),
      ),
      el('div', { style: 'margin-top: 24px;' }, rawDetails),
    ),
  );

  renderDetail();
  renderRaw();
  refreshCode();
  void load();

  // cleanup — 디바운스 타이머 해제 + 진행 중 응답 폐기
  return () => {
    if (debounceId !== undefined) clearTimeout(debounceId);
    querySeq++;
    detailSeq++;
  };
}
