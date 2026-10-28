// Usage data (app_plan.md §10 point 5, §10a): anonymous events, no cookies, no user ID.
// Nothing is sent while APP_SETTINGS.events.endpoint is null; the events are then only
// written to the browser console, so that they can be checked during development.

export function sendEvent(name, data = {}) {
  const endpoint = window.APP_SETTINGS.events.endpoint;
  const event = { event: name, time: new Date().toISOString().slice(0, 10), ...data };
  if (endpoint === null) {
    console.debug("event (not sent):", event);
    return;
  }
  // sendBeacon also works while the page is being closed.
  navigator.sendBeacon(endpoint, JSON.stringify(event));
}
