/* 앱 셸 — 56px 투명 상단 바(좌: 내비, 중앙: 워드마크, 우: 세션 상태) + 아울렛 + 푸터 */
import { el } from '../lib/dom';
import { session, isConnected, clearSession } from '../state/session';
import { isMockMode } from '../state/client';
import { badge, button, maskKey } from './widgets';

const NAV_ITEMS: { path: string; label: string }[] = [
  { path: '/setup', label: '초기 설정' },
  { path: '/connect', label: '연결' },
  { path: '/apps', label: '앱' },
  { path: '/answer', label: '답변 생성' },
  { path: '/replace', label: '문서 교체' },
];

export interface Shell {
  outlet: HTMLElement;
  setActive(path: string): void;
}

export function renderShell(root: HTMLElement): Shell {
  const links = NAV_ITEMS.map((item) =>
    el('a', { href: `#${item.path}`, 'data-path': item.path }, item.label),
  );

  const status = el('div', { class: 'topnav-status' });

  const nav = el(
    'nav',
    { class: 'topnav' },
    el('div', { class: 'topnav-links' }, ...links),
    el('a', { class: 'topnav-wordmark t-wordmark', href: '#/connect' }, 'ALLI SDK'),
    status,
  );

  const outlet = el('main', {});

  const footer = el(
    'footer',
    { class: 'footer' },
    'ALLI SDK — 사내 ERP 개발자용 Alli API 플레이그라운드 · API 키는 이 브라우저 세션에만 보관됩니다',
  );

  root.append(nav, outlet, footer);

  session.subscribe((cfg) => {
    status.replaceChildren();
    if (isMockMode()) status.appendChild(badge('목 모드', 'warn'));
    if (isConnected(cfg)) {
      status.appendChild(
        badge(`${cfg.region === 'custom' ? 'CUSTOM' : cfg.region.toUpperCase()} · ${maskKey(cfg.apiKey)}`, 'on'),
      );
      status.appendChild(
        button('연결 해제', {
          small: true,
          variant: 'quiet',
          onClick: () => {
            clearSession();
            location.hash = '#/connect';
          },
        }),
      );
    } else {
      status.appendChild(badge('미연결'));
    }
  });

  return {
    outlet,
    setActive(path: string) {
      // /run, /multipart, /conversation은 앱 허브 진입이므로 '앱' 탭을 활성으로 유지
      const alias =
        path === '/run' || path === '/multipart' || path === '/conversation' ? '/apps' : path;
      for (const a of links) a.classList.toggle('active', a.dataset.path === alias);
    },
  };
}
