/* 부트스트랩 — 폰트/스타일 로드, 목 모드 와이어링, 셸 + 라우터 마운트 */
import '@fontsource/saira-condensed/400.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-serif-kr/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { startRouter, type RouteRender } from './lib/router';
import { renderShell } from './ui/shell';
import { isConnected } from './state/session';
import { setFetchImpl } from './state/client';
import * as connect from './flows/connect';
import * as apps from './flows/apps';
import * as run from './flows/run';
import * as multipart from './flows/multipart';
import * as answer from './flows/answer';
import * as replace from './flows/replace';
import * as conversation from './flows/conversation';

const GUARDED = new Set(['/apps', '/run', '/multipart', '/answer', '/replace', '/conversation']);

async function boot(): Promise<void> {
  const mockOn = import.meta.env.MODE === 'mock' || import.meta.env.VITE_ALLI_MOCK === '1';
  if (mockOn) {
    const { createMockFetch } = await import('./mock/mock-fetch');
    setFetchImpl(createMockFetch());
  }

  const root = document.getElementById('app');
  if (!root) throw new Error('#app 루트가 없습니다');

  const shell = renderShell(root);

  const routes: Record<string, RouteRender> = {
    '/connect': connect.render,
    '/apps': apps.render,
    '/run': run.render,
    '/multipart': multipart.render,
    '/answer': answer.render,
    '/replace': replace.render,
    '/conversation': conversation.render,
  };
  if (import.meta.env.DEV) {
    routes['/dev'] = (c) => {
      void import('./ui/dev-gallery').then((m) => m.render(c));
    };
  }

  startRouter(shell.outlet, {
    routes,
    defaultPath: '/connect',
    guard: (path) => (GUARDED.has(path) && !isConnected() ? '/connect' : null),
    onNavigate: (path) => shell.setActive(path),
  });
}

void boot();
