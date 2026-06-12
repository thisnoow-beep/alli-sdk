/* 임시 점검 스크립트 — 대표 아티팩트를 출력해 육안 검증 (npx vite-node scripts/dump-artifacts.ts) */
import { generateArtifacts } from '../src/codegen';
import { specs } from '../src/core/endpoints';

const kbReplace = generateArtifacts(
  {
    spec: specs.kbUpload([
      { name: 'fileName', kind: 'text', value: '취업규칙_v3.pdf' },
      { name: 'file', kind: 'file', file: new File(['x'], '취업규칙_v3.pdf') },
      { name: 'hashtags', kind: 'text', value: '인사규정' },
      { name: 'useLayout', kind: 'text', value: 'true' },
    ]),
    wrapper: { kind: 'kb-replace', oldNodeId: 'kb-001', pollInitialMs: 2000, pollMaxMs: 5000, pollTimeoutMs: 600000 },
  },
  { baseUrl: 'https://backend.alli.ai', ownUserId: '홍길동' },
);

const convLoop = generateArtifacts(
  {
    spec: specs.runConversation('app-doc-101', [
      { name: 'message', kind: 'text', value: '이 문서를 요약해줘' },
      { name: 'files', kind: 'file', file: new File(['x'], '계약서.pdf') },
    ]),
    wrapper: { kind: 'conversation-loop' },
  },
  { baseUrl: 'https://backend.alli.ai', ownUserId: 'EMP12345' },
);

const pick = (arts: ReturnType<typeof generateArtifacts>, v: string) =>
  arts.find((a) => a.variant === v)?.code ?? '(없음)';

console.log('════════ kb-replace · Python ════════\n' + pick(kbReplace, 'python'));
console.log('\n════════ conversation-loop · Node ════════\n' + pick(convLoop, 'node'));
