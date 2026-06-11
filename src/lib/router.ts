/* 해시 라우터 — 정적 경로 7개면 충분하므로 파라미터 매칭 없음.
   라우트 렌더 함수는 cleanup 함수를 반환할 수 있다. */
import { clear } from './dom';

export type RouteRender = (container: HTMLElement) => void | (() => void);

export interface RouterOptions {
  routes: Record<string, RouteRender>;
  defaultPath: string;
  /** 리다이렉트할 경로를 반환하면 이동, null이면 통과 */
  guard?: (path: string) => string | null;
  onNavigate?: (path: string) => void;
}

export interface Router {
  navigate(path: string): void;
  current(): string;
}

export function startRouter(outlet: HTMLElement, opts: RouterOptions): Router {
  let cleanup: (() => void) | void;
  let currentPath = '';

  function normalize(hash: string): string {
    const p = hash.replace(/^#/, '');
    return p === '' || p === '/' ? opts.defaultPath : p;
  }

  function render(): void {
    const path = normalize(location.hash);
    const redirect = opts.guard?.(path);
    if (redirect && redirect !== path) {
      location.hash = `#${redirect}`;
      return;
    }
    if (typeof cleanup === 'function') cleanup();
    clear(outlet);
    currentPath = path;
    const route = opts.routes[path];
    cleanup = route
      ? route(outlet)
      : opts.routes[opts.defaultPath]?.(outlet);
    opts.onNavigate?.(path);
    outlet.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  render();

  return {
    navigate(path: string) {
      if (normalize(location.hash) === path) render();
      else location.hash = `#${path}`;
    },
    current: () => currentPath,
  };
}
