/**
 * Camera-based barcode scanning for product registration (shop owner only).
 *
 * Wraps `html5-qrcode` (which bundles the ZXing decoder locally — no CDN, no
 * network, so camera scanning works on an offline till) behind a small API:
 *
 * 1. `getCameraSupportProblem()` — cheap capability check for the UI.
 * 2. `requestCameraPermission()` — asks for camera access BEFORE the scanner
 *    is activated and translates the browser's raw errors into messages a
 *    shop owner can act on ("permission denied", "camera busy", …).
 * 3. `loadBarcodeScanner()` — dynamic import so the ~400 kB decoder never
 *    blocks the POS bundle; the PWA caches the chunk on first use.
 *
 * The library is browser-only: nothing here runs at module load, so importing
 * it from a component is safe in tests and SSR.
 */

/** Camera direction: back camera on a phone, front camera on a laptop. */
export type CameraFacing = 'environment' | 'user';

interface Html5QrcodeModule {
  Html5Qrcode: new (
    elementId: string,
    config: { formatsToSupport: number[]; verbose: boolean },
  ) => Html5QrcodeInstance;
  Html5QrcodeSupportedFormats: Record<string, number>;
}

interface Html5QrcodeInstance {
  start(
    camera: string | MediaTrackConstraints,
    config: { fps: number; qrbox?: { width: number; height: number } },
    onSuccess: (decodedText: string) => void,
    onError: (error: string | Error) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  clear(): void;
}

/** Every symbology the POS registers — order matters for decode priority. */
const REQUIRED_FORMAT_NAMES = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
] as const;

let scannerModulePromise: Promise<Html5QrcodeModule> | null = null;

/** Dynamic-imports (and caches) the decoder module. */
export async function loadBarcodeScanner(): Promise<Html5QrcodeModule> {
  if (!scannerModulePromise) {
    // Vite splits this into its own chunk; the service worker caches it under
    // /assets/* after the first load, so offline tills keep camera scanning.
    scannerModulePromise = import('html5-qrcode').then((mod) => mod as unknown as Html5QrcodeModule);
  }
  return scannerModulePromise;
}

/**
 * Returns `null` when camera scanning can run in this browser, otherwise a
 * message explaining why not (shown to the owner instead of a dead button).
 */
export function getCameraSupportProblem(): string | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext
      ? 'This browser cannot access the camera for scanning.'
      : 'Camera scanning needs a secure connection (HTTPS or localhost).';
  }
  return null;
}

/** Maps a raw getUserMedia / scanner failure to a shop-owner-facing message. */
export function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access for this app in your browser settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Use a USB/Bluetooth scanner or type the barcode instead.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy in another app. Close it and try again.';
    case 'OverconstrainedError':
      return 'The selected camera does not support the requested mode. Try the other camera.';
    case 'SecurityError':
      return 'The browser blocked camera access on this page. Open the app over HTTPS or localhost.';
    default:
      return err instanceof Error && err.message
        ? `Camera could not start: ${err.message}`
        : 'Camera could not start. Use a USB/Bluetooth scanner or type the barcode instead.';
  }
}

/**
 * Requests camera permission up-front, before the scanner is activated, and
 * returns once access is granted. Throws an Error with an owner-readable
 * message when permission is denied or no camera exists — the caller shows
 * that message and falls back to manual entry.
 *
 * The probe stream is released immediately; the scanner opens its own stream
 * right after, and the browser does not re-prompt because the permission is
 * already granted for this page session.
 */
export async function requestCameraPermission(facing: CameraFacing): Promise<void> {
  if (getCameraSupportProblem()) {
    throw new Error(getCameraSupportProblem() ?? 'Camera unavailable.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    throw new Error(describeCameraError(err));
  }
}

/** Creates a decoder restricted to the POS symbologies. */
export async function createBarcodeScanner(elementId: string): Promise<Html5QrcodeInstance> {
  const mod = await loadBarcodeScanner();
  const formats = REQUIRED_FORMAT_NAMES
    .map((name) => mod.Html5QrcodeSupportedFormats[name])
    .filter((value): value is number => typeof value === 'number');
  return new mod.Html5Qrcode(elementId, { formatsToSupport: formats, verbose: false });
}

/**
 * Camera stream constraints for continuous shelf scanning: rear camera by
 * default (phones), moderate frame rate so low-end till tablets keep up.
 */
export function cameraStartConstraints(facing: CameraFacing): MediaTrackConstraints {
  return { facingMode: facing };
}

/** Frame-rate / viewport settings for the live scan region. */
export const SCAN_VIEW_CONFIG = { fps: 10, qrbox: { width: 260, height: 160 } };
