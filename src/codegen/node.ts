/* Node.js (20+) 변형 — SSOT §7 (Model A: 리버스 프록시).
   플로우 무관 범용 프록시 — 브라우저의 /api/* 요청을 Alli로 포워딩하며 API-KEY를 주입한다.
   키는 이 서버에만 존재(process.env.ALLI_API_KEY, 없으면 fail-fast, §7-1) — 브라우저로 내려가지 않음.
   외부 패키지 불필요(내장 http/fetch/stream). 본문 빌더는 shared.renderJsCode('node') → renderNodeProxy. */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import { renderJsCode } from './shared';

export function generateNode(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  return {
    variant: 'node',
    setLabel: 'JavaScript',
    title: 'Node.js 프록시 (20+)',
    language: 'javascript',
    code: renderJsCode(plan, ctx, 'node'),
  };
}
