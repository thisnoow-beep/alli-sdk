import { describe, it, expect } from 'vitest';
import {
  deepFindConversationId,
  extractRunMessages,
  extractStreamText,
  extractAppsList,
  extractKbNodes,
} from './extract';

/* DraftJS 픽스처 — extract와 draftjs의 연동 검증용 */
const draftFixture = JSON.stringify({
  blocks: [
    { key: 'k1', text: '안녕하세요.', type: 'unstyled', depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} },
    { key: 'k2', text: '무엇을 도와드릴까요?', type: 'unstyled', depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} },
  ],
  entityMap: {},
});
const draftText = '안녕하세요.\n무엇을 도와드릴까요?';

/** obj를 n겹의 { nested: ... }로 감싼다 — 깊이 경계 테스트용 */
function wrap(obj: unknown, n: number): unknown {
  let cur = obj;
  for (let i = 0; i < n; i++) cur = { nested: cur };
  return cur;
}

describe('deepFindConversationId', () => {
  it('직접 키 매칭 (대소문자 무시)', () => {
    expect(deepFindConversationId({ conversationId: 'c1' })).toBe('c1');
    expect(deepFindConversationId({ conversation_id: 'c2' })).toBe('c2');
    expect(deepFindConversationId({ ConvID: 'c3' })).toBe('c3');
    expect(deepFindConversationId({ CONVERSATIONID: 'c4' })).toBe('c4');
  });

  it("'conversation' 객체의 string 'id'도 매칭 (§5.4 result.conversation)", () => {
    expect(deepFindConversationId({ result: { conversation: { id: 'c5', state: 'open' } } })).toBe('c5');
  });

  it('배열도 순회한다', () => {
    expect(deepFindConversationId({ items: [{ foo: 1 }, { conversation_id: 'c6' }] })).toBe('c6');
    expect(deepFindConversationId([[{ convId: 'c7' }]])).toBe('c7');
  });

  it('빈 문자열 값은 건너뛰고 다음 후보를 찾는다', () => {
    expect(deepFindConversationId({ conversationId: '', inner: { convId: 'c8' } })).toBe('c8');
  });

  it('깊이 8까지는 찾고, 그보다 깊으면 undefined', () => {
    expect(deepFindConversationId(wrap({ conversationId: 'deep' }, 8))).toBe('deep');
    expect(deepFindConversationId(wrap({ conversationId: 'too-deep' }, 9))).toBe(undefined);
  });

  it('없으면 undefined (스칼라/null 입력 포함)', () => {
    expect(deepFindConversationId({ foo: { bar: 1 } })).toBe(undefined);
    expect(deepFindConversationId(null)).toBe(undefined);
    expect(deepFindConversationId('text')).toBe(undefined);
    // string이 아닌 값은 매칭하지 않음
    expect(deepFindConversationId({ conversationId: 123 })).toBe(undefined);
  });
});

describe('extractRunMessages', () => {
  it('v2 result.responses[]에서 message 추출 — 빈 message는 스킵, 객체는 JSON.stringify', () => {
    const resp = {
      result: {
        responses: [
          { id: 'r1', message: '첫 응답', completed: true },
          { id: 'r2', message: '' }, // 빈 message → 스킵
          { id: 'r3' }, // message 없음 → 스킵
          { id: 'r4', message: { rich: true } }, // string 아님 → JSON.stringify
        ],
      },
    };
    expect(extractRunMessages(resp)).toEqual([
      { text: '첫 응답', viaDraftJs: false },
      { text: '{"rich":true}', viaDraftJs: false },
    ]);
  });

  it('DraftJS JSON 문자열 message는 plain text로 추출 (viaDraftJs: true)', () => {
    const resp = { result: { responses: [{ message: draftFixture }] } };
    expect(extractRunMessages(resp)).toEqual([{ text: draftText, viaDraftJs: true }]);
  });

  it('레거시 result.choices[] — string 원소와 {message|text} 객체 원소 모두 지원', () => {
    const resp = {
      result: {
        choices: ['평문 답변', { message: '객체 message' }, { text: '객체 text' }],
      },
    };
    expect(extractRunMessages(resp)).toEqual([
      { text: '평문 답변', viaDraftJs: false },
      { text: '객체 message', viaDraftJs: false },
      { text: '객체 text', viaDraftJs: false },
    ]);
  });

  it('responses[]가 있으면 choices[]보다 우선 (§9-3)', () => {
    const resp = {
      result: {
        responses: [{ message: 'v2 응답' }],
        choices: ['레거시 응답'],
      },
    };
    expect(extractRunMessages(resp)).toEqual([{ text: 'v2 응답', viaDraftJs: false }]);
  });

  it('빈/이상 응답이면 빈 배열', () => {
    expect(extractRunMessages({})).toEqual([]);
    expect(extractRunMessages({ result: {} })).toEqual([]);
    expect(extractRunMessages(null)).toEqual([]);
    expect(extractRunMessages('text')).toEqual([]);
  });
});

describe('extractStreamText', () => {
  it("키 'message'|'text'|'answer'의 string 값을 BFS로 찾는다", () => {
    expect(extractStreamText({ message: '안녕' })).toBe('안녕');
    expect(extractStreamText({ delta: { text: '조각' } })).toBe('조각');
    expect(extractStreamText({ result: { answer: '답변' } })).toBe('답변');
    expect(extractStreamText({ chunks: [{ message: '배열 안' }] })).toBe('배열 안');
  });

  it('얕은 후보가 깊은 후보보다 먼저 (BFS)', () => {
    expect(extractStreamText({ message: '얕음', nested: { text: '깊음' } })).toBe('얕음');
  });

  it('DraftJS JSON 문자열 값은 plain text로 추출', () => {
    expect(extractStreamText({ message: draftFixture })).toBe(draftText);
  });

  it('value 자체가 string이어도 처리 (DraftJS 포함)', () => {
    expect(extractStreamText('그냥 문자열 조각')).toBe('그냥 문자열 조각');
    expect(extractStreamText(draftFixture)).toBe(draftText);
  });

  it('후보가 없으면 null', () => {
    expect(extractStreamText({ status: 'ok', count: 3 })).toBe(null);
    expect(extractStreamText({ message: 42 })).toBe(null); // string 아닌 값은 무시
    expect(extractStreamText(null)).toBe(null);
    expect(extractStreamText(undefined)).toBe(null);
  });
});

describe('extractAppsList', () => {
  const apps = [
    { id: 'a1', name: '요약 앱', type: 'single_action' },
    { id: 'a2', name: '상담 앱', type: 'skill', cursor: 'cur-a2' },
  ];

  it('{ result: { apps } } 래퍼에서 추출 — nextCursor는 마지막 앱의 cursor', () => {
    const out = extractAppsList({ result: { apps } });
    expect(out.apps).toHaveLength(2);
    expect(out.apps[0]).toMatchObject({ id: 'a1', name: '요약 앱', type: 'single_action' });
    expect(out.nextCursor).toBe('cur-a2');
  });

  it('{ apps } 직접 래퍼도 동작하고, 목록 레벨 cursor가 항목 cursor보다 우선', () => {
    const out = extractAppsList({ apps, cursor: 'list-cursor' });
    expect(out.apps).toHaveLength(2);
    expect(out.nextCursor).toBe('list-cursor');
  });

  it('응답 루트가 배열이어도 동작', () => {
    const out = extractAppsList([{ id: 'a3', name: 'x', type: 'agent' }]);
    expect(out.apps).toHaveLength(1);
    expect(out.nextCursor).toBe(undefined);
  });

  it('id/name/type 셋 다 없으면 앱 배열로 보지 않음', () => {
    expect(extractAppsList({ items: [{ id: 'x', name: 'y' }] }).apps).toEqual([]);
  });

  it('빈/이상 응답이면 빈 배열', () => {
    expect(extractAppsList({}).apps).toEqual([]);
    expect(extractAppsList({ apps: [] }).apps).toEqual([]);
    expect(extractAppsList(null).apps).toEqual([]);
  });
});

describe('extractKbNodes', () => {
  it("'id' + (nodeType|processState|hashtags 중 하나)인 객체 배열을 deep-scan", () => {
    const out = extractKbNodes({
      result: {
        nodes: [
          { id: 'n1', name: 'doc.pdf', nodeType: 'file', processState: 'completed' },
          { id: 'n2', name: 'folder', nodeType: 'folder', cursor: 'cur-n2' },
        ],
      },
    });
    expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(out.nextCursor).toBe('cur-n2');
  });

  it('processState나 hashtags만 있어도 매칭', () => {
    expect(extractKbNodes({ items: [{ id: 'n3', processState: 'parsing' }] }).nodes).toHaveLength(1);
    expect(extractKbNodes({ items: [{ id: 'n4', hashtags: ['계약'] }] }).nodes).toHaveLength(1);
  });

  it('목록 레벨 cursor가 항목 cursor보다 우선', () => {
    const out = extractKbNodes({
      nodes: [{ id: 'n5', nodeType: 'file', cursor: 'item-cur' }],
      cursor: 'list-cur',
    });
    expect(out.nextCursor).toBe('list-cur');
  });

  it('id만 있는 객체 배열은 KB 노드로 보지 않음', () => {
    expect(extractKbNodes({ items: [{ id: 'x' }, { id: 'y' }] }).nodes).toEqual([]);
  });

  it('빈/이상 응답이면 빈 배열', () => {
    expect(extractKbNodes({}).nodes).toEqual([]);
    expect(extractKbNodes(null).nodes).toEqual([]);
  });
});
