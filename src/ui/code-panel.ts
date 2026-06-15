/* 코드 생성 패널 — 3세트 4개 (JavaScript[브라우저·Node] / Python / curl).
   getPlan()이 현재 폼 상태로 CodegenPlan을 만들어 주면 refresh()가 재생성한다 —
   생성 코드는 항상 "현재 입력값 기준" (SSOT §7). */
import { el, clear } from '../lib/dom';
import { generateArtifacts } from '../codegen';
import type { CodegenContext, CodegenPlan, GeneratedArtifact } from '../codegen/plan';
import { codeBlock } from './code-block';
import { copyButton, segmented, tabsBar } from './widgets';

export interface CodePanelHandle {
  el: HTMLElement;
  refresh(): void;
}

export function codePanel(
  getPlan: () => CodegenPlan | null,
  getCtx: () => CodegenContext,
): CodePanelHandle {
  let artifacts: GeneratedArtifact[] = [];
  let activeSet: 'curl' | 'JavaScript' | 'Python' = 'JavaScript';
  let jsVariant: 'browser' | 'node' = 'browser';

  const body = el('div', { class: 'stack', style: 'gap: 12px;' });
  const root = el(
    'div',
    { class: 'stack', style: 'gap: 16px;' },
    el('div', { class: 't-caption muted' }, '코드 생성 — 현재 입력값 기준'),
    body,
  );

  function activeArtifact(): GeneratedArtifact | undefined {
    if (activeSet === 'JavaScript') return artifacts.find((a) => a.variant === jsVariant);
    if (activeSet === 'curl') return artifacts.find((a) => a.variant === 'curl');
    return artifacts.find((a) => a.variant === 'python');
  }

  function renderBody(): void {
    clear(body);
    if (!artifacts.length) {
      body.appendChild(el('div', { class: 'empty-state' }, '실행 설정을 구성하면 코드가 생성됩니다'));
      return;
    }

    body.appendChild(
      tabsBar(
        [
          { id: 'JavaScript', label: 'JavaScript' },
          { id: 'Python', label: 'Python' },
          { id: 'curl', label: 'curl' },
        ],
        activeSet,
        (id) => {
          activeSet = id as typeof activeSet;
          renderBody();
        },
      ),
    );

    if (activeSet === 'JavaScript') {
      body.appendChild(
        el(
          'div',
          {},
          segmented(
            [
              { value: 'browser', label: '브라우저 (프론트)' },
              { value: 'node', label: 'Node.js (프록시)' },
            ],
            jsVariant,
            (v) => {
              jsVariant = v as typeof jsVariant;
              renderBody();
            },
          ),
        ),
      );
    }

    const art = activeArtifact();
    if (!art) return;
    body.appendChild(
      el(
        'div',
        { class: 'spread' },
        el('span', { class: 't-caption muted' }, art.title),
        copyButton(() => art.code, '코드 복사'),
      ),
    );
    body.appendChild(codeBlock(art.code, art.language));
  }

  function refresh(): void {
    const plan = getPlan();
    if (!plan) {
      artifacts = [];
      renderBody();
      return;
    }
    try {
      artifacts = generateArtifacts(plan, getCtx());
    } catch (e) {
      artifacts = [];
      clear(body);
      body.appendChild(
        el('div', { class: 'empty-state' }, `코드 생성 실패: ${e instanceof Error ? e.message : String(e)}`),
      );
      return;
    }
    renderBody();
  }

  renderBody();
  return { el: root, refresh };
}
