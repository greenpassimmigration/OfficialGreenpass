// src/components/StudentQrScannerModal.jsx
import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Camera } from "lucide-react";
import { extractStudentRefFromScannedText } from "@/lib/studentQR";

function Modal({ open, title, onClose, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl border">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full hover:bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function StudentQrScannerModal({
  open,
  onClose,
  title = "Scan Student QR",
  onSubmitToken,
  busy = false,
  successText = "",
  errorText = "",
}) {
  const [starting, setStarting] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraSupported, setCameraSupported] = useState(true);

  const qrRegionIdRef = useRef(`student-qr-reader-${Math.random().toString(36).slice(2)}`);
  const qrScannerRef = useRef(null);
  const handledTokenRef = useRef("");

  const stopScanner = async () => {
    try {
      const scanner = qrScannerRef.current;
      if (scanner) {
        const state = scanner.getState?.();
        if (state === 2 || state === 3) {
          await scanner.stop().catch(() => {});
        }
        await scanner.clear().catch(() => {});
      }
    } catch {}
    qrScannerRef.current = null;
  };

  const handleClose = async () => {
    await stopScanner();
    setStarting(false);
    setManualValue("");
    handledTokenRef.current = "";
    onClose?.();
  };

  const handleResolvedValue = async (rawValue) => {
    const token = extractStudentRefFromScannedText(rawValue);
    if (!token) return;
    if (busy) return;
    if (handledTokenRef.current === token) return;

    handledTokenRef.current = token;

    try {
      await onSubmitToken?.(token);
    } catch {
      handledTokenRef.current = "";
    }
  };

  useEffect(() => {
    if (!open) return;

    const startScanner = async () => {
      setStarting(true);

      try {
        const hasCamera =
          typeof navigator !== "undefined" &&
          !!navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === "function";

        if (!hasCamera) {
          setCameraSupported(false);
          return;
        }

        setCameraSupported(true);
        await stopScanner();

        const scanner = new Html5Qrcode(qrRegionIdRef.current);
        qrScannerRef.current = scanner;

        const config = {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.7778,
          rememberLastUsedCamera: true,
        };

        const onScan = async (decodedText) => {
          await handleResolvedValue(decodedText);
        };

        try {
          await scanner.start({ facingMode: { exact: "environment" } }, config, onScan, () => {});
        } catch {
          try {
            await scanner.start({ facingMode: "user" }, config, onScan, () => {});
          } catch {
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || !cameras.length) {
              throw new Error("No camera found on this device.");
            }
            await scanner.start(cameras[0].id, config, onScan, () => {});
          }
        }
      } finally {
        setStarting(false);
      }
    };

    startScanner();

    return () => {
      stopScanner();
    };
  }, [open]);

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          Scan the student QR using your camera, or paste the student QR link/token manually.
        </div>

        <div className="overflow-hidden rounded-2xl border bg-black">
          <div className="relative aspect-video w-full">
            <div id={qrRegionIdRef.current} className="h-full w-full" />

            {!cameraSupported ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/70 px-4 text-center">
                <Camera className="h-8 w-8 mb-3" />
                <div className="text-sm">Live camera QR scan is not supported here.</div>
                <div className="text-xs text-white/70 mt-1">
                  Use the manual token/link input below.
                </div>
              </div>
            ) : null}

            {starting ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting camera…
                </div>
              </div>
            ) : null}

            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {errorText ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorText}
          </div>
        ) : null}

        {successText ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {successText}
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium">Manual QR token / link</label>
          <div className="flex gap-2">
            <Input
              className="rounded-xl"
              placeholder="Paste student_ref link or token here..."
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualValue.trim()) {
                  handleResolvedValue(manualValue);
                }
              }}
            />
            <Button
              type="button"
              className="rounded-xl"
              disabled={busy || !manualValue.trim()}
              onClick={() => handleResolvedValue(manualValue)}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" className="rounded-xl" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}