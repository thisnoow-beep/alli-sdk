/* Flow 2 허브 — 앱 목록/상세 (구현: M4) */
import { page } from '../ui/widgets';

export function render(container: HTMLElement): void {
  container.appendChild(page('앱', '앱 목록을 조회하고 테스트할 앱을 선택합니다. (구현 예정 — M4)'));
}
