/**
 * Electron preload — the ONLY bridge between the sandboxed renderer and the
 * operating system.
 *
 * Exposes the minimal, explicitly approved desktop capability set declared in
 * `src/types/desktop.ts` on `window.samtillDesktop`. No raw ipcRenderer, no
 * Node.js APIs, no filesystem access, no shell execution: every channel below
 * is a named operation that `electron/ipc.ts` validates on the other side.
 *
 * Runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
 */
import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron';
import type {CustomerDisplayState} from '../src/types/index';
import type {DesktopApi, DesktopDisplayInfo, UpdateStatus} from '../src/types/desktop';

/** Subscribe to a main→renderer event; returns an unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: DesktopApi = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  listDisplays: () => ipcRenderer.invoke('display:list'),
  openCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:open'),
  closeCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:close'),
  getCustomerDisplayState: () => ipcRenderer.invoke('customerDisplay:getState'),
  setCustomerDisplayState: (state: CustomerDisplayState) =>
    ipcRenderer.invoke('customerDisplay:setState', state),
  onCustomerDisplayState: (cb) => subscribe<CustomerDisplayState>('customerDisplay:state', cb),
  onDisplaysChanged: (cb) => subscribe<DesktopDisplayInfo[]>('display:changed', cb),
  onCustomerDisplayOpened: (cb) => subscribe<void>('customerDisplay:opened', cb),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>('update:status', cb),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onWindowMaximizedChanged: (cb) => subscribe<boolean>('window:maximized-changed', cb),
};

contextBridge.exposeInMainWorld('samtillDesktop', api);
