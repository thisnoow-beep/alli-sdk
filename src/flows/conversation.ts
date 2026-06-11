/* Flow 6 — 대화형 앱 멀티턴 (구현: M7) */
import { page } from '../ui/widgets';

export function render(container: HTMLElement): void {
  container.appendChild(page('대화', '대화형 앱과 메시지를 주고받으며 테스트합니다. (구현 예정 — M7)'));
}
