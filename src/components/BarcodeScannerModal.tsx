import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Keyboard, RefreshCw, Loader2, AlertTriangle, ScanLine } from 'lucide-react';
import {
  CameraFacing,
  SCAN_VIEW_CONFIG,
  cameraStartConstraints,
  createBarcodeScanner,
  describeCameraError,
  getCameraSupportProblem,
  requestCameraPermission,
} from '../lib/cameraScanner';

interface BarcodeScannerModalProps {
  /** Called exactly once, with the decoded barcode; the camera is stopped first. */
  onCapture: (barcode: string) => void;
  onClose: () => void;
  /** Back camera on phones by default; laptops usually only have a front one. */
  initialFacing?: CameraFacing;
  title?: string;
  subtitle?: string;
}

type ScanPhase = 'starting' | 'scanning' | 'error';

interface ScannerHandle {
  stop: () => Promise<void>;
  clear: () => void;
}

const CAMERA_REGION_ID = 'samtill-camera-scan-region';

/**
 * Live camera barcode scanner used by the shop owner's product registration
 * and editing screens (cashiers never see this — they scan with physical
 * USB/Bluetooth scanners at the till).
 *
 * Flow: request camera permission → activate the camera → decode until the
 * first barcode is read → stop the camera automatically → hand the barcode to
 * the caller. Closing the modal (or navigating away) also stops the camera.
 */
export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  onCapture,
  onClose,
  initialFacing = 'environment',
  title = 'Scan Barcode',
  subtitle = 'Point the camera at the barcode printed on the product.',
}) => {
  const [phase, setPhase] = useState<ScanPhase>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);

  // Scanner lives outside React state: html5-qrcode owns a live camera
  // stream and must be stopped imperatively, including on unmount.
  const scannerRef = useRef<ScannerHandle | null>(null);
  const mountedRef = useRef(true);
  // A single product barcode may be decoded on consecutive frames before the
  // camera manages to stop — settle once, ignore the rest.
  const settledRef = useRef(false);

  const stopScanner = async (): Promise<void> => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // Already stopped (or never fully started) — clearing is enough.
    }
    try {
      scanner.clear();
    } catch {
      // Region already gone (modal closed) — nothing to clean.
    }
  };

  // Start (or restart, after a camera flip) the scanner.
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setPhase('starting');
      setErrorMessage('');

      const supportProblem = getCameraSupportProblem();
      if (supportProblem) {
        setErrorMessage(supportProblem);
        setPhase('error');
        return;
      }

      try {
        // Ask for permission BEFORE activating the camera so a denial is
        // reported clearly instead of surfacing as an opaque start failure.
        await requestCameraPermission(facing);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : describeCameraError(err));
        setPhase('error');
        return;
      }
      if (cancelled) return;

      try {
        const scanner = await createBarcodeScanner(CAMERA_REGION_ID);
        await scanner.start(
          cameraStartConstraints(facing),
          SCAN_VIEW_CONFIG,
          (decodedText) => {
            if (settledRef.current || !mountedRef.current) return;
            settledRef.current = true;
            const barcode = decodedText.trim();
            // Stop the camera FIRST, then deliver the barcode — the contract
            // is that a successful capture always ends the camera session.
            stopScanner().finally(() => {
              if (mountedRef.current) onCapture(barcode);
            });
          },
          () => {
            // Per-frame "not decoded yet" — expected while aiming.
          },
        );
        if (cancelled) {
          await stopScanner();
          return;
        }
        scannerRef.current = scanner;
        setPhase('scanning');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(describeCameraError(err));
        setPhase('error');
      }
    };

    void start();

    return () => {
      cancelled = true;
      void stopScanner();
    };
    // Restart when the operator flips between front/back cameras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // The camera must die with the modal, however it unmounts.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-[#F28C28]" />
            <h3 className="font-extrabold text-base text-slate-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close barcode scanner"
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs font-medium text-slate-500 mt-3">{subtitle}</p>

        {/* Live camera viewport (html5-qrcode injects the video element) */}
        <div className="relative mt-3 rounded-xl overflow-hidden bg-slate-900 aspect-[4/3] [&_video]:w-full [&_video]:h-full [&_video]:object-cover">
          <div id={CAMERA_REGION_ID} className="w-full h-full" />
          {phase === 'scanning' && (
            <>
              {/* Aim reticle over the live feed */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-28 border-2 border-[#F28C28] rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] flex items-center justify-center">
                  <ScanLine className="w-8 h-8 text-[#F28C28]/70 animate-pulse" />
                </div>
              </div>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-[10px] font-bold">
                Scanning…
              </span>
            </>
          )}
          {phase === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900 text-slate-200">
              <Loader2 className="w-6 h-6 animate-spin text-[#F28C28]" />
              <p className="text-xs font-semibold">Requesting camera permission…</p>
            </div>
          )}
          {phase === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900 text-slate-200 p-5 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <p className="text-xs font-semibold leading-relaxed">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Type barcode instead</span>
          </button>
          <div className="flex items-center gap-2">
            {phase === 'error' && (
              <button
                type="button"
                onClick={() => {
                  settledRef.current = false;
                  setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
                }}
                className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
              >
                Try again
              </button>
            )}
            {phase !== 'error' && (
              <button
                type="button"
                onClick={() => {
                  setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Switch camera</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-slate-400 mt-3 text-center font-medium">
          EAN-13 • EAN-8 • UPC-A • UPC-E • Code 128 • Code 39
        </p>
      </div>
    </div>
  );
};
