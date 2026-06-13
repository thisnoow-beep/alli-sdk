/* 부트스트랩 — 폰트/스타일 로드, 목 모드 와이어링, 셸 + 라우터 마운트 */
import '@fontsource/saira-condensed/400.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/highlight.css';

import { startRouter, type RouteRender } from './lib/router';
import { renderShell } from './ui/shell';
import { setFetchImpl } from './state/client';
import * as setup from './flows/setup';
import * as connect from './flows/connect';
import * as apps from './flows/apps';
import * as run from './flows/run';
import * as multipart from './flows/multipart';
import * as answer from './flows/answer';
import * as replace from './flows/replace';
import * as conversation from './flows/conversation';

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
    '/setup': setup.render,
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

  // 미연결이어도 화면 탐색은 허용 — API 호출 시점에 각 화면이 연결 여부를 안내한다
  // 첫 진입은 초기 설정 가이드 — 생성 코드의 전제(환경변수 ALLI_API_KEY)를 사전 안내
  startRouter(shell.outlet, {
    routes,
    defaultPath: '/setup',
    onNavigate: (path) => shell.setActive(path),
  });
}

void boot();
