/* Flow 6 — 대화형 앱 멀티턴 (SSOT §4 Flow 6, §5.5/§5.12/§5.13, §9-2)
   run_conversation을 conversationId와 함께 반복 호출하며 채팅처럼 누적 표시한다.
   스트림 스키마 미문서화(§9-2) 대응: json 조각마다 extractStreamText로 APP 텍스트를,
   deepFindConversationId로 대화 ID를 deep-scan — 못 찾으면 "대화 ID 직접 입력" 폴백.
   서버 이력(§5.12 단건 + §5.13 chats 페이저)은 스키마 미검증이라 실시간 탭과 병합하지 않는다. */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl, textPart, filePart, type MultipartPart } from '../core/request-spec';
import { deepFindConversationId, extractStreamText } from '../core/extract';
import type { ChatMessage } from '../core/types';
import { session } from '../state/session';
import { getClient } from '../state/client';
import { selectedApp } from '../state/selection';
import { badge, banner, button, copyButton, field, page, spinner, tabsBar, textInput } from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView, type RawData } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';
import { fileDrop } from '../ui/file-drop';

/** 대화 ID 공유 규약 — 파일 첨부 화면(#/multipart)이 저장하고 이 화면이 초기값으로 읽는다 */
const LAST_CONV_KEY = 'alli-sdk:last-conversation-id:v1';

/* API 용어 → 화면 용어 (GLOSSARY §1 — UI에 skill/캠페인 노출 금지) */
const TYPE_LABELS: Record<string, string> = {
  single_action: '답변형 앱',
  skill: '대화형 앱',
  campaign: '대화형 앱',
  agent: '에이전트형 앱',
};

type InputMode = 'text' | 'choices' | 'form' | 'file';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** result 래퍼가 있으면 벗긴다 — §5.12/5.13 응답 스키마 미검증 대응 */
function rootOf(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const result = data['result'];
  return isRecord(result) ? result : data;
}

/** 응답에서 챗 배열 추출 — 'chats' 키 우선, 없으면 message/sender 키를 가진 객체 배열 폴백 */
function findChats(data: unknown): ChatMessage[] {
  const root = rootOf(data);
  if (root === null) return [];
  const chats = root['chats'];
  if (Array.isArray(chats)) return chats as ChatMessage[];
  for (const v of Object.values(root)) {
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((item) => isRecord(item) && ('message' in item || 'sender' in item))
    ) {
      return v as ChatMessage[];
    }
  }
  return [];
}

/** 챗 message → 표시 텍스트 — extractStreamText가 DraftJS 폴백(tryExtractDraftJs)을 포함한다 (§3.4) */
function chatText(message: unknown): string {
  const text = extractStreamText(message);
  if (text !== null) return text;
  if (message === undefined || message === null) return '';
  return typeof message === 'string' ? message : JSON.stringify(message);
}

/** sender → USER/APP 캡션 (스키마 미검증 — 문자열화 후 휴리스틱 판정) */
function senderWho(sender: unknown): 'USER' | 'APP' {
  const s = typeof sender === 'string' ? sender : JSON.stringify(sender ?? '');
  return /user|customer/i.test(s) ? 'USER' : 'APP';
}

/** 채팅 행 — 말풍선 금지, 헤어라인 행 + USER/APP 캡션 (components.css .chat-row) */
function chatRow(who: 'USER' | 'APP', text: string): HTMLElement {
  return el(
    'div',
    { class: `chat-row${who === 'USER' ? ' from-user' : ''}` },
    el('div', { class: 'chat-who' }, who),
    el('div', { class: 'chat-body' }, text),
  );
}

/** raw 뷰 요청 본문 표시용 — multipart 파트 요약 */
function partsSummary(parts: MultipartPart[]): string {
  return [
    'multipart/form-data — boundary는 전송 시 자동 생성 (§7-3)',
    ...parts.map((p) =>
      p.kind === 'text'
        ? `${p.name} (text): ${p.value ?? ''}`
        : `${p.name} (file): ${p.file?.name ?? ''} · ${p.file?.size ?? 0} bytes`,
    ),
  ].join('\n');
}

export function render(container: HTMLElement): void | (() => void) {
  const selected = selectedApp.get();

  // 앱 미선택 — empty-state + 이동 버튼만 (공통 동작 규칙)
  if (!selected) {
    container.appendChild(
      page(
        '대화',
        '대화형 앱과 메시지를 주고받으며 멀티턴을 테스트합니다.',
        el(
          'div',
          { class: 'empty-state' },
          el('p', {}, '선택된 앱이 없습니다 — 먼저 앱 화면에서 테스트할 앱을 선택하세요.'),
          el('div', { style: 'margin-top: 16px;' }, button('#/apps로 이동', { onClick: () => (location.hash = '#/apps') })),
        ),
      ),
    );
    return;
  }

  // 호이스팅되는 내부 함수(send 등)에서도 non-null로 쓰도록 별도 const에 고정
  const app = selected;

  // ---- 폼 상태 ----
  // 초기 conversationId: 파일 첨부 화면이 저장한 마지막 대화 ID를 이어받는다
  let conversationId = '';
  try {
    conversationId = sessionStorage.getItem(LAST_CONV_KEY) ?? '';
  } catch {
    /* sessionStorage 불가 환경 — 빈 값으로 시작 */
  }
  let manualId = conversationId;
  let inputMode: InputMode = 'text';
  let message = '';
  let choices = '';
  let formJson = '';
  let running = false;
  let activeAbort: AbortController | null = null;

  const files = fileDrop({ onChange: () => code.refresh() });

  /** parts 빌드 — 전송·코드 생성이 같은 결과를 공유한다 (현재 모드 기준) */
  const buildParts = (): MultipartPart[] => {
    const parts: MultipartPart[] = [...textPart('conversationId', conversationId.trim())];
    if (inputMode === 'text') parts.push(...textPart('message', message.trim()));
    else if (inputMode === 'choices') parts.push(...textPart('choices', choices.trim()));
    else if (inputMode === 'form') parts.push(...textPart('sendFormInput', formJson.trim()));
    else parts.push(...files.getFiles().map((p) => filePart(p.fieldName, p.file)));
    return parts;
  };

  // ---- 코드 생성 패널 (멀티턴 루프 래퍼 — SSOT §7-7) ----
  const code = codePanel(
    () => ({ spec: specs.runConversation(app.id, buildParts()), wrapper: { kind: 'conversation-loop' } }),
    () => {
      const cfg = session.get();
      return {
        baseUrl: cfg.baseUrl,
        ownUserId: cfg.ownUserId.trim() || undefined,
        userEmail: cfg.userEmail.trim() || undefined,
      };
    },
  );

  // ---- 채팅 영역 (실시간) ----
  let chatCount = 0;
  const chatEmpty = el('div', { class: 'empty-state' }, '메시지를 보내면 대화가 여기에 누적됩니다');
  const chatList = el('div', { style: 'max-height: 480px; overflow-y: auto;' }, chatEmpty);

  function addRow(who: 'USER' | 'APP', text: string): HTMLElement {
    if (chatCount === 0) clear(chatList);
    chatCount += 1;
    const row = chatRow(who, text);
    chatList.appendChild(row);
    chatList.scrollTop = chatList.scrollHeight;
    return row;
  }

  // 스트림 수신 중 APP 행 누적 — 누적형(이전 텍스트로 시작)이면 마지막 행 교체, 아니면 새 행
  // (stream-view.ts의 휴리스틱을 채팅 행으로 직접 구현 — §9-2 실제 프레이밍 미확정 대응)
  let turnTexts: string[] = [];
  let turnRows: HTMLElement[] = [];

  function pushAppText(text: string): void {
    const last = turnTexts[turnTexts.length - 1];
    const lastRow = turnRows[turnRows.length - 1];
    if (last !== undefined && lastRow !== undefined && text.startsWith(last)) {
      turnTexts[turnTexts.length - 1] = text;
      const body = lastRow.querySelector('.chat-body');
      if (body) body.textContent = text;
      chatList.scrollTop = chatList.scrollHeight;
    } else {
      turnTexts.push(text);
      turnRows.push(addRow('APP', text));
    }
  }

  // ---- conversationId 칩 + 직접 입력 폴백 ----
  const convSlot = el('div', { class: 'row', style: 'flex-wrap: wrap;' });

  const manualInput = textInput({
    mono: true,
    placeholder: '스트림에서 ID를 못 찾았을 때 직접 입력',
    value: manualId,
    onInput: (v) => {
      manualId = v;
    },
    onEnter: () => applyManualId(),
  }) as HTMLInputElement;

  function saveConvId(id: string): void {
    try {
      sessionStorage.setItem(LAST_CONV_KEY, id); // 파일 첨부 화면과 공유하는 규약 키
    } catch {
      /* sessionStorage 불가 환경 — 표시만 유지 */
    }
  }

  function renderConvChip(): void {
    clear(convSlot);
    if (conversationId) {
      convSlot.append(
        badge('conversationId', 'on'),
        el('span', { class: 't-body-sm', style: 'font-family: var(--font-mono); word-break: break-all;' }, conversationId),
        copyButton(() => conversationId),
      );
    } else {
      convSlot.appendChild(badge('새 대화'));
    }
    convSlot.appendChild(
      button('새 대화', {
        small: true,
        variant: 'quiet',
        title: '대화 ID와 채팅 기록을 비우고 새로 시작합니다',
        onClick: resetConversation,
      }),
    );
  }

  function adoptConversationId(id: string): void {
    conversationId = id;
    manualId = id;
    manualInput.value = id;
    saveConvId(id);
    renderConvChip();
    code.refresh();
  }

  function applyManualId(): void {
    const v = manualId.trim();
    if (!v) return;
    adoptConversationId(v);
  }

  function resetConversation(): void {
    conversationId = '';
    manualId = '';
    manualInput.value = '';
    try {
      sessionStorage.removeItem(LAST_CONV_KEY);
    } catch {
      /* 무시 */
    }
    chatCount = 0;
    turnTexts = [];
    turnRows = [];
    clear(chatList);
    chatList.appendChild(chatEmpty);
    renderConvChip();
    code.refresh();
  }

  const manualField = field(
    '대화 ID 직접 입력 (폴백)',
    el('div', { class: 'row' }, manualInput, button('적용', { small: true, onClick: applyManualId })),
    { hint: '스트림 응답 스키마가 문서화돼 있지 않아(§9-2) ID를 자동으로 못 찾을 수 있습니다 — Raw 뷰에서 확인해 입력하세요' },
  );

  // ---- 입력 영역: tabsBar 4모드 ----
  const messageInput = textInput({
    area: true,
    rows: 3,
    placeholder: '사용자 메시지 — Enter로 전송 (Shift+Enter 줄바꿈)',
    value: message,
    onInput: (v) => {
      message = v;
      code.refresh();
    },
  }) as HTMLTextAreaElement;
  // textarea는 widgets의 onEnter가 무시하므로 직접 처리 — Enter 전송, Shift+Enter 줄바꿈
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  const choicesError = el('span', { class: 'field-error', style: 'display: none;' });
  const choicesInput = textInput({
    mono: true,
    placeholder: '[0]',
    value: choices,
    onInput: (v) => {
      choices = v;
      choicesError.style.display = 'none';
      code.refresh();
    },
    onEnter: () => void send(),
  });

  const formError = el('span', { class: 'field-error', style: 'display: none;' });
  const formInput = textInput({
    area: true,
    rows: 4,
    mono: true,
    placeholder: '{"name": "홍길동"}',
    value: formJson,
    onInput: (v) => {
      formJson = v;
      formError.style.display = 'none';
      code.refresh();
    },
  });

  const textPanel = field('message', messageInput, { hint: '대화의 사용자 발화로 전송됩니다' });
  const choicesPanel = el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label' }, 'choices'),
    choicesInput,
    el('span', { class: 'field-hint' }, '버튼/선택지 인덱스 — JSON 배열 문자열, 예: [0] 또는 [0, 1]'),
    choicesError,
  );
  const formPanel = el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label' }, 'sendFormInput'),
    formInput,
    el('span', { class: 'field-hint' }, '폼 제출 데이터 — JSON 문자열 (전송 전에 JSON 파싱을 검증합니다)'),
    formError,
  );
  const filePanel = field('파일 첨부', files.el, {
    hint: '파일별로 form 필드(files 일반 / media_files 미디어 / form_files 폼)를 지정합니다',
  });

  const modePanels: Record<InputMode, HTMLElement> = {
    text: textPanel,
    choices: choicesPanel,
    form: formPanel,
    file: filePanel,
  };

  function showModePanel(): void {
    for (const [m, panel] of Object.entries(modePanels)) {
      panel.style.display = m === inputMode ? '' : 'none';
    }
  }

  const inputTabs = tabsBar(
    [
      { id: 'text', label: '텍스트' },
      { id: 'choices', label: '선택지' },
      { id: 'form', label: '폼 제출' },
      { id: 'file', label: '파일' },
    ],
    inputMode,
    (id) => {
      inputMode = id as InputMode;
      showModePanel();
      code.refresh();
    },
  );

  // ---- 전송/상태/raw ----
  const statusRow = el('div', { class: 'row' });
  const errorSlot = el('div', {});
  const rawSlot = el('div', {});
  const sendBtn = button('전송', { onClick: () => void send() });
  const stopBtn = button('중지', { small: true, variant: 'warn', onClick: () => activeAbort?.abort() });

  /** 마지막 전송의 rawView — 접기 토글 */
  function showRaw(data: RawData): void {
    clear(rawSlot);
    const body = el('div', { style: 'display: none;' }, rawView(data));
    const toggle = button('Raw 보기', {
      small: true,
      variant: 'quiet',
      onClick: () => {
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        toggle.textContent = hidden ? 'Raw 닫기' : 'Raw 보기';
      },
    });
    rawSlot.append(
      el('div', { class: 'spread' }, el('span', { class: 't-caption muted' }, '마지막 전송 Raw'), toggle),
      body,
    );
  }

  async function send(): Promise<void> {
    if (running) return;
    clear(errorSlot);

    // ---- 모드별 검증 + USER 행 표시 문자열 ----
    let userLabel: string;
    if (inputMode === 'text') {
      if (!message.trim()) {
        errorSlot.appendChild(banner('전송할 메시지를 입력하세요', 'warn'));
        return;
      }
      userLabel = message.trim();
    } else if (inputMode === 'choices') {
      const v = choices.trim();
      let ok = false;
      if (v) {
        try {
          ok = Array.isArray(JSON.parse(v));
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        choicesError.textContent = 'JSON 배열 문자열이어야 합니다 — 예: [0] 또는 [0, 1]';
        choicesError.style.display = '';
        return;
      }
      userLabel = `choices: ${v}`;
    } else if (inputMode === 'form') {
      const v = formJson.trim();
      let ok = v !== '';
      if (ok) {
        try {
          JSON.parse(v);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        formError.textContent = 'JSON 파싱 실패 — 올바른 JSON 문자열을 입력하세요 (예: {"name": "홍길동"})';
        formError.style.display = '';
        return;
      }
      userLabel = `sendFormInput: ${v}`;
    } else {
      const picked = files.getFiles();
      if (!picked.length) {
        errorSlot.appendChild(banner('첨부할 파일을 선택하세요', 'warn'));
        return;
      }
      userLabel = `파일: ${picked.map((p) => p.file.name).join(', ')}`;
    }

    // 전송 직전 parts 확정 — 이후 입력을 비워도 이 요청에는 영향 없음
    const parts = buildParts();
    const spec = specs.runConversation(app.id, parts);

    running = true;
    sendBtn.disabled = true;
    clear(statusRow);
    statusRow.append(spinner(), el('span', { class: 't-caption muted' }, '스트리밍 수신 중'), stopBtn);

    // USER 행 즉시 추가 + 이번 턴의 APP 누적 상태 리셋
    addRow('USER', userLabel);
    turnTexts = [];
    turnRows = [];

    // 채팅 UX — 텍스트·파일 입력은 전송 후 비운다
    if (inputMode === 'text') {
      message = '';
      messageInput.value = '';
      code.refresh();
    } else if (inputMode === 'file') {
      files.clear();
    }

    const ac = new AbortController();
    activeAbort = ac;

    let chunkNo = 0;
    let transcript = '';
    let elapsedMs: number | undefined;

    try {
      const client = getClient();
      for await (const ev of client.executeStream(spec, ac.signal)) {
        if (ev.type === 'done') {
          elapsedMs = ev.elapsedMs;
          continue;
        }
        chunkNo += 1;
        transcript += `── #${chunkNo} (${ev.type === 'garbage' ? 'garbage' : 'json'}) ──\n${ev.raw}\n`;
        if (ev.type === 'json') {
          const text = extractStreamText(ev.value);
          if (text !== null && text !== '') pushAppText(text);
          // §9-2: 스키마 미문서화 — 미보유 시 json 값마다 deep-scan으로 conversationId 채택
          if (!conversationId) {
            const id = deepFindConversationId(ev.value);
            if (id !== undefined) adoptConversationId(id);
          }
        }
      }
      clear(statusRow);
      statusRow.appendChild(el('span', { class: 't-caption success-text' }, '수신 완료'));
      if (!conversationId) {
        errorSlot.appendChild(
          banner('스트림에서 conversationId를 찾지 못했습니다 — 직접 입력하거나 Raw 뷰에서 확인하세요', 'warn'),
        );
        manualInput.focus(); // 수동 입력 폴백 강조
      }
      showRaw({
        request: {
          method: spec.method,
          url: buildUrl(client.cfg.baseUrl, spec),
          headers: client.buildHeaders(spec),
          body: partsSummary(parts),
        },
        elapsedMs,
        streamTranscript: transcript,
      });
    } catch (e) {
      clear(statusRow);
      if (e instanceof Error && e.name === 'AbortError') {
        statusRow.appendChild(el('span', { class: 't-caption warn-text' }, '중지됨'));
      } else {
        errorSlot.appendChild(errorPanel(e, 'conversation'));
      }
    } finally {
      running = false;
      sendBtn.disabled = false;
      activeAbort = null;
    }
  }

  // ---- 서버 이력 탭 (§5.12 단건 + §5.13 chats 페이저 — 실시간과 병합하지 않음) ----
  const historyPanel = el('div', { class: 'stack' });
  let historyPageNo = 1;

  function renderHistory(): void {
    clear(historyPanel);
    const id = conversationId.trim();
    if (!id) {
      historyPanel.appendChild(
        el('div', { class: 'empty-state' }, '대화 ID가 없습니다 — 먼저 메시지를 보내거나 대화 ID를 직접 입력하세요'),
      );
      return;
    }

    const metaSlot = el('div', { class: 'stack', style: 'gap: 12px;' });
    const chatsSlot = el('div', {});

    const pageInput = textInput({
      type: 'number',
      mono: true,
      value: String(historyPageNo),
      onInput: (v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1) historyPageNo = n;
      },
      onEnter: () => void loadPage(historyPageNo),
    }) as HTMLInputElement;
    pageInput.min = '1';
    pageInput.style.maxWidth = '80px';

    const prevBtn = button('이전', {
      small: true,
      variant: 'quiet',
      onClick: () => {
        if (historyPageNo <= 1) return;
        historyPageNo -= 1;
        pageInput.value = String(historyPageNo);
        void loadPage(historyPageNo);
      },
    });
    const nextBtn = button('다음', {
      small: true,
      variant: 'quiet',
      onClick: () => {
        historyPageNo += 1;
        pageInput.value = String(historyPageNo);
        void loadPage(historyPageNo);
      },
    });
    const loadBtn = button('조회', { small: true, onClick: () => void loadPage(historyPageNo) });

    async function loadMeta(): Promise<void> {
      clear(metaSlot);
      metaSlot.appendChild(
        el('div', { class: 'row' }, spinner(), el('span', { class: 't-caption muted' }, 'GET /webapi/v2/conversations/{id} 호출 중')),
      );
      try {
        const client = getClient();
        const res = await client.execute(specs.getConversation(id));
        clear(metaSlot);
        const root = rootOf(res.data);
        const state = root !== null && typeof root['state'] === 'string' ? root['state'] : '';
        const chats = findChats(res.data);
        metaSlot.append(
          el(
            'div',
            { class: 'row', style: 'flex-wrap: wrap;' },
            badge(`HTTP ${res.status}`, 'success'),
            state ? badge(`state: ${state}`) : null,
            badge(`최근 챗 ${chats.length}개`),
          ),
          chats.length > 0
            ? el('div', {}, ...chats.map((c) => chatRow(senderWho(c?.sender), chatText(c?.message))))
            : el('div', { class: 'empty-state' }, '챗이 없습니다'),
        );
      } catch (e) {
        clear(metaSlot);
        metaSlot.appendChild(errorPanel(e, 'conversation'));
      }
    }

    async function loadPage(pageNo: number): Promise<void> {
      clear(chatsSlot);
      chatsSlot.appendChild(
        el('div', { class: 'row' }, spinner(), el('span', { class: 't-caption muted' }, `chats?pageNo=${pageNo} 호출 중`)),
      );
      try {
        const client = getClient();
        const res = await client.execute(specs.getConversationChats(id, pageNo));
        clear(chatsSlot);
        const chats = findChats(res.data);
        chatsSlot.append(
          el('div', { class: 't-caption muted' }, `페이지 ${pageNo} — 챗 ${chats.length}개`),
          chats.length > 0
            ? el('div', {}, ...chats.map((c) => chatRow(senderWho(c?.sender), chatText(c?.message))))
            : el('div', { class: 'empty-state' }, '이 페이지에는 챗이 없습니다'),
        );
      } catch (e) {
        clear(chatsSlot);
        chatsSlot.appendChild(errorPanel(e, 'conversation'));
      }
    }

    historyPanel.append(
      el('div', { class: 't-caption muted' }, '대화 단건 — 메타 + 최근 챗 20개 (§5.12)'),
      metaSlot,
      el('div', { class: 'hairline-top', style: 'padding-top: 16px;' }, el('div', { class: 't-caption muted' }, '대화 전체 메시지 — pageNo 페이징 (§5.13)')),
      el('div', { class: 'row' }, el('span', { class: 'field-label' }, 'pageNo'), pageInput, prevBtn, nextBtn, loadBtn),
      chatsSlot,
    );

    void loadMeta(); // 탭을 열 때마다 단건 조회 — 스트리밍으로 놓친 메시지 검증용
  }

  // ---- 실시간 / 서버 이력 탭 ----
  const livePanel = el(
    'div',
    { class: 'stack' },
    chatList,
    statusRow,
    inputTabs,
    textPanel,
    choicesPanel,
    formPanel,
    filePanel,
    el('div', {}, sendBtn),
    errorSlot,
  );

  const viewBody = el('div', {}, livePanel);
  const viewTabs = tabsBar(
    [
      { id: 'live', label: '실시간' },
      { id: 'history', label: '서버 이력' },
    ],
    'live',
    (id) => {
      clear(viewBody);
      if (id === 'history') {
        renderHistory();
        viewBody.appendChild(historyPanel);
      } else {
        viewBody.appendChild(livePanel);
      }
    },
  );

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '대화',
      '대화형 앱과 메시지를 주고받으며 멀티턴을 테스트합니다 (POST /webapi/v2/apps/{app_id}/run_conversation 반복 — 응답은 항상 스트리밍).',
      el(
        'div',
        { class: 'grid-2col' },
        el(
          'div',
          { class: 'stack' },
          el(
            'div',
            { class: 'row', style: 'flex-wrap: wrap;' },
            badge(`선택 앱: ${app.name}`, 'on'),
            badge(TYPE_LABELS[String(app.type)] ?? String(app.type)),
            button('다른 앱 선택', { small: true, variant: 'quiet', onClick: () => (location.hash = '#/apps') }),
          ),
          app.type === 'single_action'
            ? banner('대화 실행(run_conversation)은 대화형 앱 전용입니다 — 답변형 앱은 결과가 다를 수 있지만 진행은 가능합니다', 'warn')
            : null,
          convSlot,
          manualField,
          viewTabs,
          viewBody,
        ),
        el('div', { class: 'stack' }, rawSlot, code.el),
      ),
    ),
  );

  renderConvChip();
  showModePanel();
  code.refresh();

  // 라우트 이탈 시 진행 중 스트림 중단
  return () => {
    activeAbort?.abort();
  };
}
