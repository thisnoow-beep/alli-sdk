/* 앱 허브(#/apps)에서 선택한 앱 — 실행/파일 첨부/대화 화면이 공유.
   새로고침에도 유지되도록 sessionStorage 미러. */
import { createStore, type Store } from '../lib/store';
import type { AppInfo } from '../core/types';

const KEY = 'alli-sdk:selected-app:v1';

function load(): AppInfo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AppInfo) : null;
  } catch {
    return null;
  }
}

export const selectedApp: Store<AppInfo | null> = createStore<AppInfo | null>(
  typeof sessionStorage === 'undefined' ? null : load(),
);

if (typeof sessionStorage !== 'undefined') {
  selectedApp.subscribe((app) => {
    if (app) sessionStorage.setItem(KEY, JSON.stringify(app));
    else sessionStorage.removeItem(KEY);
  });
}

export function selectApp(app: AppInfo | null): void {
  selectedApp.set(app);
}
