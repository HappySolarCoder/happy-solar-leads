/** Capacitor reports connectivity more reliably than WebView navigator.onLine. */
let nativeConnected: boolean | undefined;
export function isDeviceOnline() {
  return (
    nativeConnected ?? (typeof navigator === "undefined" || navigator.onLine)
  );
}
export function updateNativeConnectivity(connected: boolean) {
  nativeConnected = connected;
  window.dispatchEvent(new Event("raydar-network-change"));
}
