/* 세션 설정으로 AlliClient를 구성하는 팩토리.
   목 모드(--mode mock 또는 VITE_ALLI_MOCK=1)에서는 main.ts가 setFetchImpl로 목 fetch를 주입한다. */
import { AlliClient, type AlliConfig } from '../core/client';
import { session } from './session';

let injectedFetch: typeof fetch | undefined;

export function setFetchImpl(f: typeof fetch): void {
  injectedFetch = f;
}

export function isMockMode(): boolean {
  return injectedFetch !== undefined;
}

/** 세션 저장 전의 임의 설정으로 클라이언트 생성 — Flow 1(연결 검증) 전용 */
export function makeClient(cfg: AlliConfig): AlliClient {
  return new AlliClient(cfg, injectedFetch);
}

export function getClient(): AlliClient {
  const cfg = session.get();
  if (!cfg.apiKey) throw new Error('연결 설정이 없습니다 — 연결 화면에서 API 키를 설정하세요');
  return new AlliClient(
    {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      ownUserId: cfg.ownUserId || undefined,
      userEmail: cfg.userEmail || undefined,
    },
    injectedFetch,
  );
}
