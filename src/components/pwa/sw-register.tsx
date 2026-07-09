"use client";

import { useEffect } from "react";

// Registers the service worker in production so the dashboard is installable
// and keeps working (with an offline fallback) once added to a home screen.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  return null;
}
