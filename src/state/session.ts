/* 접속 세션 (Flow 1에서 설정) — SSOT §4 Flow 1 보안 정책:
   키는 기본 sessionStorage(탭 종료 시 소멸), 영구 저장(localStorage)은 경고 동반 옵트인. */
import { createStore, type Store } from '../lib/store';

export type Region = 'us' | 'ja' | 'custom';

export const REGION_BASE_URLS: Record<Exclude<Region, 'custom'>, string> = {
  us: 'https://backend.alli.ai',
  ja: 'https://backend-ja.alli.ai',
};

export interface SessionConfig {
  region: Region;
  baseUrl: string;
  apiKey: string;
  ownUserId: string;
  userEmail: string;
  /** localStorage 영구 저장 옵트인 (경고 동반) */
  persist: boolean;
  /** GET /v2/projects 검증 통과 여부 */
  validated: boolean;
}

export const emptySession: SessionConfig = {
  region: 'us',
  baseUrl: REGION_BASE_URLS.us,
  apiKey: '',
  ownUserId: '',
  userEmail: '',
  persist: false,
  validated: false,
};

const STORAGE_KEY = 'alli-sdk:session:v1';

function safeParse(raw: string | null): SessionConfig | null {
  if (!raw) return null;
  try {
    return { ...emptySession, ...(JSON.parse(raw) as Partial<SessionConfig>) };
  } catch {
    return null;
  }
}

function load(): SessionConfig {
  return safeParse(sessionStorage.getItem(STORAGE_KEY)) ?? safeParse(localStorage.getItem(STORAGE_KEY)) ?? emptySession;
}

export const session: Store<SessionConfig> = createStore<SessionConfig>(
  typeof sessionStorage === 'undefined' ? emptySession : load(),
);

if (typeof sessionStorage !== 'undefined') {
  session.subscribe((cfg) => {
    const raw = JSON.stringify(cfg);
    sessionStorage.setItem(STORAGE_KEY, raw);
    if (cfg.persist) localStorage.setItem(STORAGE_KEY, raw);
    else localStorage.removeItem(STORAGE_KEY);
  });
}

export function isConnected(cfg: SessionConfig = session.get()): boolean {
  return Boolean(cfg.apiKey) && cfg.validated;
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  session.set(emptySession);
}
