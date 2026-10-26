/**
 * Application menu.
 *
 * The desktop till runs frameless with its own custom title bar, so the
 * default File/Edit/View/Window menu bar is removed entirely.
 *
 * An explicitly empty template is used (rather than `Menu.setApplicationMenu
 * (null)`) because that is the unambiguous, version-proof way to guarantee
 * zero menu items on Windows — no Alt-revealable bar, no default menu.
 *
 * Removing the menu does NOT break text editing: Chromium handles the standard
 * cut/copy/paste/select-all/undo/redo accelerators natively for any focused
 * field, so barcode search, login and form inputs keep their shortcuts. The
 * only accelerators lost are the View/Window roles (reload, devtools, zoom,
 * fullscreen) — intentionally not exposed on a production point-of-sale till.
 */
import {Menu} from 'electron';

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
}
