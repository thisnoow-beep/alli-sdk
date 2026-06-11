/* Flow 2 실행 — 앱 테스트 실행 (구현: M4) */
import { page } from '../ui/widgets';

export function render(container: HTMLElement): void {
  container.appendChild(page('앱 실행', '선택한 앱을 sync/stream으로 실행합니다. (구현 예정 — M4)'));
}
