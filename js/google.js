// Loads the Google Maps JavaScript API once, only when it is needed (play and results
// screens), so that the start page costs no Google quota (app_plan.md §10).
// The browser key comes from config.local.js (written from ~/.Renviron by script 22,
// not in Git); for publication it is replaced by a key restricted to the public domain.

let loading = null;

export function loadGoogleMaps() {
  if (loading !== null) return loading;
  loading = new Promise((resolve, reject) => {
    const key = window.LOCAL_CONFIG && window.LOCAL_CONFIG.googleMapsKey;
    if (!key) {
      reject(new Error("No Google Maps key (app/config.local.js; run scripts/22_prototype_data.R)"));
      return;
    }
    window.onGoogleMapsReady = () => resolve(window.google);
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + key + "&v=weekly&loading=async"
      + "&language=" + window.APP_SETTINGS.language + "&callback=onGoogleMapsReady";
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded"));
    document.head.append(script);
  });
  return loading;
}
