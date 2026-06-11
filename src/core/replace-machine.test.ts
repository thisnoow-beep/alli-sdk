/* Flow 5 Replace 상태 머신 전수 테스트.
   전략: (1) 전이도에 문서된 모든 전이를 개별 검증
        (2) phase × 무효 이벤트 전수 조합 — 리듀서가 total임을 보장
        (3) 시나리오 3종 (해피패스 / parsing_fail→롤백 / 타임아웃→await_decision 3분기)
        (4) retrying/post_retrying이 폴링을 끊지 않는지 */

import { describe, expect, it } from 'vitest';
import type { ReplaceEvent, ReplaceMachineState, ReplacePhase } from './replace-machine';
import { initialReplaceState, isTerminal, replaceReducer } from './replace-machine';

/* ---------- 헬퍼 ---------- */

const START: ReplaceEvent = { type: 'UPLOAD_START', oldNodeId: 'old-1' };
const UP_OK: ReplaceEvent = { type: 'UPLOAD_OK', newNodeId: 'new-1' };

function tick(status: string, elapsedMs = 2000): ReplaceEvent {
  return { type: 'POLL_TICK', status, elapsedMs };
}

function run(events: ReplaceEvent[], from: ReplaceMachineState = initialReplaceState) {
  return events.reduce(replaceReducer, from);
}

/* 각 phase에 도달하는 대표 이벤트 시퀀스 — 직접 객체 조립 대신 리듀서로 도달시켜
   "도달 가능성" 자체도 함께 검증한다 */
const ROUTE: Record<ReplacePhase, ReplaceEvent[]> = {
  idle: [],
  uploading: [START],
  polling: [START, UP_OK],
  await_decision: [START, UP_OK, { type: 'POLL_TIMEOUT' }],
  confirm_rollback: [START, UP_OK, tick('parsing_fail')],
  rolling_back: [START, UP_OK, tick('parsing_fail'), { type: 'ROLLBACK' }],
  rolled_back: [START, UP_OK, tick('parsing_fail'), { type: 'ROLLBACK' }, { type: 'ROLLBACK_OK' }],
  rollback_failed: [
    START,
    UP_OK,
    tick('parsing_fail'),
    { type: 'ROLLBACK' },
    { type: 'ROLLBACK_FAIL', error: 'rb' },
  ],
  confirm_delete_old: [START, UP_OK, tick('completed')],
  deleting_old: [START, UP_OK, tick('completed'), { type: 'CONFIRM_DELETE' }],
  delete_old_failed: [
    START,
    UP_OK,
    tick('completed'),
    { type: 'CONFIRM_DELETE' },
    { type: 'DELETE_OLD_FAIL', error: 'del' },
  ],
  success: [
    START,
    UP_OK,
    tick('completed'),
    { type: 'CONFIRM_DELETE' },
    { type: 'DELETE_OLD_OK' },
  ],
  upload_failed: [START, { type: 'UPLOAD_FAIL', error: 'up' }],
  stopped: [START, UP_OK, { type: 'POLL_TIMEOUT' }, { type: 'STOP' }],
};

const ALL_PHASES = Object.keys(ROUTE) as ReplacePhase[];

function stateAt(phase: ReplacePhase): ReplaceMachineState {
  const s = run(ROUTE[phase]);
  // 라우트 자체가 잘못되면 이후 단언이 무의미하므로 먼저 확인
  expect(s.phase).toBe(phase);
  return s;
}

/* phase별 유효 이벤트 타입 (RESET은 모든 phase에서 유효하므로 별도 처리) */
const VALID: Record<ReplacePhase, ReplaceEvent['type'][]> = {
  idle: ['UPLOAD_START'],
  uploading: ['UPLOAD_OK', 'UPLOAD_FAIL'],
  polling: ['POLL_TICK', 'POLL_TIMEOUT'],
  await_decision: ['CONTINUE_POLLING', 'ROLLBACK', 'STOP'],
  confirm_rollback: ['ROLLBACK', 'STOP'],
  rolling_back: ['ROLLBACK_OK', 'ROLLBACK_FAIL'],
  rolled_back: [],
  rollback_failed: [],
  confirm_delete_old: ['CONFIRM_DELETE', 'STOP'],
  deleting_old: ['DELETE_OLD_OK', 'DELETE_OLD_FAIL'],
  delete_old_failed: ['RETRY_DELETE', 'STOP'],
  success: [],
  upload_failed: [],
  stopped: [],
};

/* RESET 제외 전체 이벤트 샘플 — 무효 이벤트 전수 검사용 */
const ALL_EVENTS: ReplaceEvent[] = [
  { type: 'UPLOAD_START', oldNodeId: 'x' },
  { type: 'UPLOAD_OK', newNodeId: 'y' },
  { type: 'UPLOAD_FAIL', error: 'e' },
  tick('parsing'),
  { type: 'POLL_TIMEOUT' },
  { type: 'CONTINUE_POLLING' },
  { type: 'ROLLBACK' },
  { type: 'CONFIRM_DELETE' },
  { type: 'DELETE_OLD_OK' },
  { type: 'DELETE_OLD_FAIL', error: 'e' },
  { type: 'RETRY_DELETE' },
  { type: 'ROLLBACK_OK' },
  { type: 'ROLLBACK_FAIL', error: 'e' },
  { type: 'STOP' },
];

/* ---------- 문서된 전이 전수 ---------- */

describe('문서된 전이', () => {
  it('idle --UPLOAD_START--> uploading (oldNodeId 기록)', () => {
    const s = replaceReducer(initialReplaceState, START);
    expect(s.phase).toBe('uploading');
    expect(s.ctx.oldNodeId).toBe('old-1');
  });

  it('uploading --UPLOAD_OK--> polling (newNodeId 기록)', () => {
    const s = replaceReducer(stateAt('uploading'), UP_OK);
    expect(s.phase).toBe('polling');
    expect(s.ctx.newNodeId).toBe('new-1');
    expect(s.ctx.oldNodeId).toBe('old-1'); // 기존 ctx 유지
  });

  it('uploading --UPLOAD_FAIL--> upload_failed (error 기록, 터미널)', () => {
    const s = replaceReducer(stateAt('uploading'), { type: 'UPLOAD_FAIL', error: 'network' });
    expect(s.phase).toBe('upload_failed');
    expect(s.ctx.error).toBe('network');
    expect(isTerminal(s.phase)).toBe(true);
  });

  it.each(['completed', 'post_completed'])(
    'polling --POLL_TICK(%s)--> confirm_delete_old',
    (status) => {
      const s = replaceReducer(stateAt('polling'), tick(status, 4000));
      expect(s.phase).toBe('confirm_delete_old');
      // 전이하는 틱에도 통계는 반영되어야 한다
      expect(s.ctx.attempts).toBe(1);
      expect(s.ctx.lastStatus).toBe(status);
      expect(s.ctx.elapsedMs).toBe(4000);
    },
  );

  it.each(['parsing_fail', 'post_parsing_fail'])(
    'polling --POLL_TICK(%s)--> confirm_rollback',
    (status) => {
      const s = replaceReducer(stateAt('polling'), tick(status, 6000));
      expect(s.phase).toBe('confirm_rollback');
      expect(s.ctx.attempts).toBe(1);
      expect(s.ctx.lastStatus).toBe(status);
      expect(s.ctx.elapsedMs).toBe(6000);
    },
  );

  it.each(['initializing', 'parsing', 'post_parsing', 'retrying', 'post_retrying', 'unknown_x'])(
    'polling --POLL_TICK(%s)--> polling 유지 (통계만 갱신)',
    (status) => {
      const s = replaceReducer(stateAt('polling'), tick(status, 2500));
      expect(s.phase).toBe('polling');
      expect(s.ctx.attempts).toBe(1);
      expect(s.ctx.lastStatus).toBe(status);
      expect(s.ctx.elapsedMs).toBe(2500);
    },
  );

  it('polling --POLL_TIMEOUT--> await_decision', () => {
    expect(replaceReducer(stateAt('polling'), { type: 'POLL_TIMEOUT' }).phase).toBe(
      'await_decision',
    );
  });

  it('await_decision --CONTINUE_POLLING--> polling', () => {
    expect(replaceReducer(stateAt('await_decision'), { type: 'CONTINUE_POLLING' }).phase).toBe(
      'polling',
    );
  });

  it('await_decision --ROLLBACK--> rolling_back', () => {
    expect(replaceReducer(stateAt('await_decision'), { type: 'ROLLBACK' }).phase).toBe(
      'rolling_back',
    );
  });

  it('confirm_rollback --ROLLBACK--> rolling_back', () => {
    expect(replaceReducer(stateAt('confirm_rollback'), { type: 'ROLLBACK' }).phase).toBe(
      'rolling_back',
    );
  });

  it('rolling_back --ROLLBACK_OK--> rolled_back (터미널)', () => {
    const s = replaceReducer(stateAt('rolling_back'), { type: 'ROLLBACK_OK' });
    expect(s.phase).toBe('rolled_back');
    expect(isTerminal(s.phase)).toBe(true);
  });

  it('rolling_back --ROLLBACK_FAIL--> rollback_failed (error 기록, 터미널)', () => {
    const s = replaceReducer(stateAt('rolling_back'), { type: 'ROLLBACK_FAIL', error: 'manual' });
    expect(s.phase).toBe('rollback_failed');
    expect(s.ctx.error).toBe('manual');
    expect(isTerminal(s.phase)).toBe(true);
  });

  it('confirm_delete_old --CONFIRM_DELETE--> deleting_old', () => {
    expect(replaceReducer(stateAt('confirm_delete_old'), { type: 'CONFIRM_DELETE' }).phase).toBe(
      'deleting_old',
    );
  });

  it('deleting_old --DELETE_OLD_OK--> success (터미널)', () => {
    const s = replaceReducer(stateAt('deleting_old'), { type: 'DELETE_OLD_OK' });
    expect(s.phase).toBe('success');
    expect(isTerminal(s.phase)).toBe(true);
  });

  it('deleting_old --DELETE_OLD_FAIL--> delete_old_failed (error 기록, 비터미널)', () => {
    const s = replaceReducer(stateAt('deleting_old'), { type: 'DELETE_OLD_FAIL', error: '500' });
    expect(s.phase).toBe('delete_old_failed');
    expect(s.ctx.error).toBe('500');
    expect(isTerminal(s.phase)).toBe(false);
  });

  it('delete_old_failed --RETRY_DELETE--> deleting_old', () => {
    expect(replaceReducer(stateAt('delete_old_failed'), { type: 'RETRY_DELETE' }).phase).toBe(
      'deleting_old',
    );
  });

  it.each(['await_decision', 'confirm_rollback', 'confirm_delete_old', 'delete_old_failed'] as const)(
    '%s --STOP--> stopped (stoppedFrom에 직전 phase 기록)',
    (phase) => {
      const s = replaceReducer(stateAt(phase), { type: 'STOP' });
      expect(s.phase).toBe('stopped');
      expect(s.ctx.stoppedFrom).toBe(phase);
      expect(isTerminal(s.phase)).toBe(true);
    },
  );

  it('모든 phase --RESET--> initialReplaceState', () => {
    for (const phase of ALL_PHASES) {
      const s = replaceReducer(stateAt(phase), { type: 'RESET' });
      expect(s).toEqual(initialReplaceState);
    }
  });
});

/* ---------- 무효 이벤트 전수 무시 (total function) ---------- */

describe('무효 이벤트는 상태를 그대로 반환한다', () => {
  for (const phase of ALL_PHASES) {
    const invalid = ALL_EVENTS.filter((ev) => !VALID[phase].includes(ev.type));
    it(`${phase}: ${invalid.length}종 무효 이벤트 무시`, () => {
      for (const ev of invalid) {
        const before = stateAt(phase);
        const after = replaceReducer(before, ev);
        // 같은 객체 반환 허용 — 핵심은 내용이 변하지 않는 것
        expect(after).toEqual(before);
        expect(after.phase).toBe(phase);
      }
    });
  }

  it('예외를 절대 던지지 않는다 (전 phase × 전 이벤트)', () => {
    for (const phase of ALL_PHASES) {
      for (const ev of [...ALL_EVENTS, { type: 'RESET' } as const]) {
        expect(() => replaceReducer(stateAt(phase), ev)).not.toThrow();
      }
    }
  });
});

/* ---------- 시나리오 3종 ---------- */

describe('시나리오: 해피패스 전체 시퀀스', () => {
  it('업로드 → 폴링(진행 상태 경유) → 성공 확인 → 구 노드 삭제 → success', () => {
    const s = run([
      START,
      UP_OK,
      tick('initializing', 2000),
      tick('parsing', 4500),
      tick('post_parsing', 9500),
      tick('post_completed', 14500),
      { type: 'CONFIRM_DELETE' },
      { type: 'DELETE_OLD_OK' },
    ]);
    expect(s.phase).toBe('success');
    expect(s.ctx).toMatchObject({
      oldNodeId: 'old-1',
      newNodeId: 'new-1',
      attempts: 4,
      elapsedMs: 14500,
      lastStatus: 'post_completed',
    });
    expect(s.ctx.error).toBeUndefined();
    expect(isTerminal(s.phase)).toBe(true);
  });
});

describe('시나리오: parsing_fail → 롤백', () => {
  it('실패 감지 → confirm_rollback → 새 노드 삭제 → rolled_back (구 문서 유지)', () => {
    const failed = run([START, UP_OK, tick('parsing', 2000), tick('parsing_fail', 4000)]);
    expect(failed.phase).toBe('confirm_rollback');
    expect(failed.ctx.attempts).toBe(2);
    expect(failed.ctx.lastStatus).toBe('parsing_fail');

    const s = run([{ type: 'ROLLBACK' }, { type: 'ROLLBACK_OK' }], failed);
    expect(s.phase).toBe('rolled_back');
    // 롤백 대상(새 노드)과 보존 대상(구 노드) 식별자가 ctx에 남아 있어야 한다
    expect(s.ctx.newNodeId).toBe('new-1');
    expect(s.ctx.oldNodeId).toBe('old-1');
  });
});

describe('시나리오: 타임아웃 → await_decision의 3분기', () => {
  const atDecision = () => run([START, UP_OK, tick('parsing', 2000), { type: 'POLL_TIMEOUT' }]);

  it('분기 1: CONTINUE_POLLING → 폴링 재개 후 성공까지 진행 (attempts 누적 유지)', () => {
    const s = run(
      [{ type: 'CONTINUE_POLLING' }, tick('parsing', 602_000), tick('completed', 604_000)],
      atDecision(),
    );
    expect(s.phase).toBe('confirm_delete_old');
    expect(s.ctx.attempts).toBe(3); // 타임아웃 이전 1회 + 재개 후 2회
  });

  it('분기 2: ROLLBACK → rolling_back → rolled_back', () => {
    const s = run([{ type: 'ROLLBACK' }, { type: 'ROLLBACK_OK' }], atDecision());
    expect(s.phase).toBe('rolled_back');
  });

  it('분기 3: STOP → stopped (stoppedFrom=await_decision)', () => {
    const s = replaceReducer(atDecision(), { type: 'STOP' });
    expect(s.phase).toBe('stopped');
    expect(s.ctx.stoppedFrom).toBe('await_decision');
  });
});

/* ---------- retrying은 폴링을 끊지 않는다 ---------- */

describe('retrying 상태의 폴링 지속', () => {
  it('retrying/post_retrying 틱을 거쳐도 polling 유지, 이후 성공 전이 가능', () => {
    const retried = run([
      START,
      UP_OK,
      tick('parsing', 2000),
      tick('retrying', 5000),
      tick('retrying', 10000),
      tick('post_retrying', 15000),
    ]);
    expect(retried.phase).toBe('polling');
    expect(retried.ctx.attempts).toBe(4);
    expect(retried.ctx.lastStatus).toBe('post_retrying');
    expect(retried.ctx.elapsedMs).toBe(15000);

    const s = replaceReducer(retried, tick('completed', 20000));
    expect(s.phase).toBe('confirm_delete_old');
    expect(s.ctx.attempts).toBe(5);
  });
});

/* ---------- isTerminal 전수 ---------- */

describe('isTerminal', () => {
  const TERMINAL: ReplacePhase[] = [
    'success',
    'rolled_back',
    'rollback_failed',
    'upload_failed',
    'stopped',
  ];

  it.each(ALL_PHASES)('%s', (phase) => {
    expect(isTerminal(phase)).toBe(TERMINAL.includes(phase));
  });
});
