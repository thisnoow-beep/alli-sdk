/* generateArtifacts — 모든 Flow의 코드 생성 진입점 (SSOT §7).
   반환 순서 고정: [curl, browser, node, python] (3세트 4개).
   JavaScript는 Model A — browser=같은 출처 프록시(/api) 호출(키 없음),
   node=플로우 무관 리버스 프록시(키 주입). curl/python은 Alli 직접 호출.
   API 키는 ctx에 존재하지 않으며 어떤 변형에도 리터럴로 삽입되지 않는다 (§7-1). */

import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import { generateCurl } from './curl';
import { generateBrowser } from './browser';
import { generateNode } from './node';
import { generatePython } from './python';

export function generateArtifacts(plan: CodegenPlan, ctx: CodegenContext): GeneratedArtifact[] {
  return [generateCurl(plan, ctx), generateBrowser(plan, ctx), generateNode(plan, ctx), generatePython(plan, ctx)];
}
