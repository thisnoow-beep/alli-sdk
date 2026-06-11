/* Flow 5 — 문서 Replace (구현: M6) */
import { page } from '../ui/widgets';

export function render(container: HTMLElement): void {
  container.appendChild(page('문서 교체', '업로드 → 완료 확인 → 삭제 순서로 문서를 안전하게 교체합니다. (구현 예정 — M6)'));
}
