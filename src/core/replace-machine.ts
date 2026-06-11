/* Flow 5 (문서 Replace) 상태 머신 — 순수 리듀서. UI/네트워크 없이 테스트 가능.
   SSOT §4 Flow 5: 순서는 반드시 "업로드 → 완료 확인 → 삭제".
   삭제를 먼저 하면 (a) 업로드 실패 시 문서 소실 (b) 인제스천 동안 검색 공백.

   전이도:
   idle --UPLOAD_START--> uploading
   uploading --UPLOAD_OK--> polling | --UPLOAD_FAIL--> upload_failed(터미널, 구 문서 무사)
   polling --POLL_TICK(성공 상태)--> confirm_delete_old
   polling --POLL_TICK(실패 상태)--> confirm_rollback
   polling --POLL_TICK(그 외)--> polling (attempts/lastStatus/elapsedMs 갱신; retrying도 계속)
   polling --POLL_TIMEOUT--> await_decision
   await_decision --CONTINUE_POLLING--> polling | --ROLLBACK--> rolling_back | --STOP--> stopped
   confirm_rollback --ROLLBACK--> rolling_back | --STOP--> stopped
   rolling_back --ROLLBACK_OK--> rolled_back(터미널) | --ROLLBACK_FAIL--> rollback_failed(터미널, 수동 정리 필요)
   confirm_delete_old --CONFIRM_DELETE--> deleting_old | --STOP--> stopped(신규 문서 활성, 공존 경고)
   deleting_old --DELETE_OLD_OK--> success(터미널) | --DELETE_OLD_FAIL--> delete_old_failed
   delete_old_failed --RETRY_DELETE--> deleting_old | --STOP--> stopped
   (모든 상태) --RESET--> idle
   유효하지 않은 이벤트는 상태를 그대로 반환한다 (리듀서는 total). */

import type { KbProcessState } from './types';

export const REPLACE_POLL = {
  initialMs: 2000,
  maxMs: 5000,
  timeoutMs: 600_000,
  success: ['completed', 'post_completed'] as readonly string[],
  failure: ['parsing_fail', 'post_parsing_fail'] as readonly string[],
} as const;

export type ReplacePhase =
  | 'idle'
  | 'uploading'
  | 'polling'
  | 'await_decision'
  | 'confirm_rollback'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_failed'
  | 'confirm_delete_old'
  | 'deleting_old'
  | 'delete_old_failed'
  | 'success'
  | 'upload_failed'
  | 'stopped';

export interface ReplaceCtx {
  oldNodeId?: string;
  newNodeId?: string;
  attempts: number;
  elapsedMs: number;
  lastStatus?: KbProcessState;
  error?: string;
  /** stopped로 끝났을 때 어느 국면에서 멈췄는지 (공존 경고 문구 분기용) */
  stoppedFrom?: ReplacePhase;
}

export interface ReplaceMachineState {
  phase: ReplacePhase;
  ctx: ReplaceCtx;
}

export type ReplaceEvent =
  | { type: 'UPLOAD_START'; oldNodeId: string }
  | { type: 'UPLOAD_OK'; newNodeId: string }
  | { type: 'UPLOAD_FAIL'; error: string }
  | { type: 'POLL_TICK'; status: KbProcessState; elapsedMs: number }
  | { type: 'POLL_TIMEOUT' }
  | { type: 'CONTINUE_POLLING' }
  | { type: 'ROLLBACK' }
  | { type: 'CONFIRM_DELETE' }
  | { type: 'DELETE_OLD_OK' }
  | { type: 'DELETE_OLD_FAIL'; error: string }
  | { type: 'RETRY_DELETE' }
  | { type: 'ROLLBACK_OK' }
  | { type: 'ROLLBACK_FAIL'; error: string }
  | { type: 'STOP' }
  | { type: 'RESET' };

export const initialReplaceState: ReplaceMachineState = {
  phase: 'idle',
  ctx: { attempts: 0, elapsedMs: 0 },
};

export function replaceReducer(state: ReplaceMachineState, ev: ReplaceEvent): ReplaceMachineState {
  void state;
  void ev;
  throw new Error('TODO(M2): replaceReducer 구현');
}

/** 터미널 상태 여부 (UI에서 RESET 외 액션 비활성화) */
export function isTerminal(phase: ReplacePhase): boolean {
  void phase;
  throw new Error('TODO(M2): isTerminal 구현');
}
