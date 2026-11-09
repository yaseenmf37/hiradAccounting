"use client";

import { Download, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getActiveOfflineWorkspace } from "@/lib/offline-storage";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return (
    "prompt" in event &&
    typeof event.prompt === "function" &&
    "userChoice" in event
  );
}

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getConnectionStatus() {
  return navigator.onLine;
}

export default function PwaControls() {
  const online = useSyncExternalStore(
    subscribeToConnection,
    getConnectionStatus,
    () => true
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null
  );
  const [storageError, setStorageError] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState<
    "pending" | "complete" | "error" | "unavailable" | null
  >(null);
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      if (!isInstallPromptEvent(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => setInstallPrompt(null);
    const handleStorageError = () => setStorageError(true);
    const handleStorageReady = () => setStorageError(false);
    let active = true;
    const refreshSnapshotStatus = () => {
      void getActiveOfflineWorkspace()
        .then((workspace) => {
          if (!active) return;
          setSnapshotStatus(
            workspace ? workspace.snapshotStatus ?? "unavailable" : null
          );
        })
        .catch((error: unknown) => {
          console.error("Offline snapshot status could not be loaded:", error);
        });
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("hirad-offline-storage-error", handleStorageError);
    window.addEventListener("hirad-offline-storage-ready", handleStorageReady);
    window.addEventListener("hirad-offline-snapshot-updated", refreshSnapshotStatus);
    window.addEventListener("hirad-offline-storage-ready", refreshSnapshotStatus);
    refreshSnapshotStatus();

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((serviceWorkerRegistration) => {
          setRegistration(serviceWorkerRegistration);
          setUpdateReady(Boolean(serviceWorkerRegistration.waiting));
          if (navigator.onLine) {
            void serviceWorkerRegistration.update().catch((error: unknown) => {
              console.error("Service worker update check failed:", error);
            });
            void navigator.serviceWorker.ready.then((readyRegistration) => {
              readyRegistration.active?.postMessage({
                type: "CACHE_OFFLINE_SHELL",
              });
            }).catch((error: unknown) => {
              console.error("Offline workspace shell setup failed:", error);
            });
          }

          serviceWorkerRegistration.addEventListener("updatefound", () => {
            const installing = serviceWorkerRegistration.installing;
            installing?.addEventListener("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                setUpdateReady(true);
              }
            });
          });
        })
        .catch((error: unknown) => {
          console.error("Service worker registration failed:", error);
        });
    }

    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("hirad-offline-storage-error", handleStorageError);
      window.removeEventListener("hirad-offline-storage-ready", handleStorageReady);
      window.removeEventListener("hirad-offline-snapshot-updated", refreshSnapshotStatus);
      window.removeEventListener("hirad-offline-storage-ready", refreshSnapshotStatus);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  function applyUpdate() {
    if (!registration?.waiting) return;

    const reloadAfterUpdate = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reloadAfterUpdate, {
      once: true,
    });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <div className="flex min-h-8 items-center justify-between gap-2 border-b border-[#222d38] bg-[#0b0f14] px-4 py-1 text-[11px] text-slate-400">
      <span className="inline-flex items-center gap-1.5" role="status">
        {online ? (
          <>
            <Wifi aria-hidden="true" className="size-3 text-emerald-400" />
            آنلاین
          </>
        ) : (
          <>
            <WifiOff aria-hidden="true" className="size-3 text-amber-400" />
            آفلاین
          </>
        )}
      </span>
      <span className="flex items-center gap-2">
        {snapshotStatus && (
          <span role="status" className="hidden text-slate-400 sm:inline">
            اطلاعات آفلاین:{" "}
            {snapshotStatus === "complete"
              ? "آماده"
              : snapshotStatus === "pending"
                ? "در حال دریافت"
                : snapshotStatus === "error"
                  ? "دریافت ناموفق"
                  : "آماده‌سازی نشده"}
          </span>
        )}
        {storageError && (
          <span role="status" className="text-amber-400">
            ذخیرهٔ آفلاین ناموفق بود
          </span>
        )}
        {installPrompt && (
          <button
            type="button"
            onClick={installApp}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-emerald-300 transition hover:bg-[#18222d]"
          >
            <Download aria-hidden="true" className="size-3" />
            نصب برنامه
          </button>
        )}
        {updateReady && (
          <button
            type="button"
            onClick={applyUpdate}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-emerald-300 transition hover:bg-[#18222d]"
          >
            <RefreshCw aria-hidden="true" className="size-3" />
            دریافت نسخه جدید
          </button>
        )}
      </span>
    </div>
  );
}
