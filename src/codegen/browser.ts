/* 브라우저 fetch 변형 — SSOT §7 (Model A: 프록시 경유).
   같은 출처의 Node.js 프록시(/api)를 키 없이 호출한다 — API 키는 브라우저에 존재하지 않으며
   별도 Node.js 프록시 서버가 주입한다. 멀티턴/폴링 등 오케스트레이션은 이 클라이언트가 수행.
   본문 빌더는 shared.renderJsCode('browser'). */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import { renderJsCode } from './shared';

export function generateBrowser(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  return {
    variant: 'browser',
    setLabel: 'JavaScript',
    title: '브라우저 (프록시 호출)',
    language: 'javascript',
    code: renderJsCode(plan, ctx, 'browser'),
  };
}
