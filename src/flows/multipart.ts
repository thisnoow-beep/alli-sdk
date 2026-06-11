/* Flow 3 — 파일 첨부 앱 테스트 (구현: M5) */
import { page } from '../ui/widgets';

export function render(container: HTMLElement): void {
  container.appendChild(page('파일 첨부', 'multipart 구성을 미리보고 대화형 앱을 실행합니다. (구현 예정 — M5)'));
}
