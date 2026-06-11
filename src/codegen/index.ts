/* generateArtifacts — 모든 Flow의 코드 생성 진입점.
   반환 순서 고정: [curl, browser, node, python] (3세트 4개). */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';

export function generateArtifacts(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact[] {
  void plan;
  void ctx;
  throw new Error('TODO(M3): generateArtifacts 구현');
}
