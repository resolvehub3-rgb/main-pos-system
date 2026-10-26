'use strict';

/**
 * Windows NSIS packaging for SamTill POS.
 *
 * Produces `release/SamTill-POS-Setup.exe`:
 *  - per-user install by default (no admin rights required on the till PC),
 *    under %LOCALAPPDATA%\Programs\SamTill POS, with a wizard that lets the
 *    operator choose the directory,
 *  - Desktop + Start menu shortcuts ("SamTill POS"),
 *  - userData (login session, shop settings) survives upgrades and
 *    uninstallation (`deleteAppDataOnUninstall: false`),
 *  - x64 target — Windows 10/11 on Intel/AMD (see docs/ELECTRON.md for the
 *    signing checklist and arm64 notes).
 *
 * Only `dist/` (the production web build), `dist-electron/` (bundled main +
 * preload) and `package.json` are packed: the desktop app has no runtime
 * node_modules, so no dev/backend dependency leaks into the installer and no
 * environment secrets are embedded (Vite env values are baked into `dist/`
 * exactly as for the web deployment).
 *
 * Build: `pnpm desktop:dist`
 */
module.exports = {
  appId: 'com.samtill.pos',
  productName: 'SamTill POS',
  copyright: 'Copyright © 2026 SamTill',
  electronVersion: undefined, // taken from devDependencies.electron
  npmRebuild: false,
  asar: true,
  directories: {
    output: 'release',
    buildResources: 'build-resources',
  },
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json', '!node_modules/**'],
  win: {
    icon: 'build-resources/app.ico',
    target: [{target: 'nsis', arch: ['x64']}],
  },
  nsis: {
    artifactName: 'SamTill-POS-Setup.exe',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SamTill POS',
    // Keep %APPDATA%\SamTill POS (session, shop config) on uninstall so a
    // reinstall/upgrade never wipes the till's local data.
    deleteAppDataOnUninstall: false,
    installerIcon: 'build-resources/app.ico',
    uninstallerIcon: 'build-resources/app.ico',
    installerHeaderIcon: 'build-resources/app.ico',
    uninstallDisplayName: 'SamTill POS',
  },
  // No `publish` block on purpose: update *notifications* use the manifest
  // URL baked in at build time (SAMTILL_UPDATE_MANIFEST_URL), and no release
  // feed is published from this repository yet. See docs/ELECTRON.md.
};
