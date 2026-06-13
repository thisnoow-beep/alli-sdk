/* 브라우저 fetch 변형 — SSOT §7.
   API 키 리터럴/placeholder 금지 — 백엔드가 환경변수 ALLI_API_KEY를 읽어 주입한 값
   (globalThis.ALLI_API_KEY)을 참조하고, 블록 주석으로 주입 전제·프록시 권장을 안내 (§7-1).
   본문 빌더는 Node 변형과 공유 (shared.renderJsCode). */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import { renderJsCode } from './shared';

export function generateBrowser(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  return {
    variant: 'browser',
    setLabel: 'JavaScript',
    title: '브라우저 fetch',
    language: 'javascript',
    code: renderJsCode(plan, ctx, 'browser'),
  };
}
