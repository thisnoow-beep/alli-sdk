/* Node.js (20+) 변형 — SSOT §7.
   API 키는 process.env.ALLI_API_KEY (없으면 throw로 fail-fast, §7-1).
   파일 첨부는 node:fs/promises readFile + Blob — form-data 패키지 금지, Node 20 네이티브만 (§7-7).
   본문 빌더는 브라우저 변형과 공유 (shared.renderJsCode). */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import { renderJsCode } from './shared';

export function generateNode(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact {
  return {
    variant: 'node',
    setLabel: 'JavaScript',
    title: 'Node.js (20+)',
    language: 'javascript',
    code: renderJsCode(plan, ctx, 'node'),
  };
}
