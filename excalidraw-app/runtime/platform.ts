export const isDesktopApp = () => import.meta.env.VITE_DESKTOP_APP === "true";

export const isTauriApp = () =>
  isDesktopApp() && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const supportsPWA = () => !isDesktopApp();

export const supportsNativeShare = () => !isDesktopApp() && "share" in navigator;
