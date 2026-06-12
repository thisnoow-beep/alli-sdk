/* 브라우저 fetch 변형 — SSOT §7.
   API 키는 placeholder("YOUR_API_KEY") + "운영 브라우저 코드에 키 금지" 블록 경고 주석 (§7-1).
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
