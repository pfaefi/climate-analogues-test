// The text pages (info, methods, about) inside the app (app_test_notes 29.10 point 5).
// They are separate HTML files that also work on their own, but a plain link to them left
// the app and lost its state: «Zurück» then led to the start screen, not to the results. Here
// a click on such a link loads the page's text into the screen "page" of index.html, and
// «Zurück» (or the browser's back button) returns to the screen that was open before, with
// the results, the map and the scroll position unchanged.

const PAGES = ["info.html", "methods.html", "about.html"];

let showScreen = null;        // from main.js
let previous = null;          // { screen, scroll } before the page was opened

// Call once at the start. show(name) shows a screen of index.html; current() names the one
// that is visible now.
export function initPages(show, current) {
  showScreen = show;
  // One listener for all links, also those inside an opened page (e.g. about → methods).
  document.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (link === null) return;
    const file = link.getAttribute("href");
    if (!PAGES.includes(file)) return;
    event.preventDefault();
    openPage(file, current());
  });
  document.getElementById("page-back").addEventListener("click", event => {
    event.preventDefault();
    history.back();           // closes the page via the "popstate" listener below
  });
  // The browser's back button (on phones the usual way back) closes the page.
  window.addEventListener("popstate", () => {
    if (previous !== null) closePage();
  });
}

async function openPage(file, screen) {
  // The text of the page: its <section>, without its own «← Zurück» link (first paragraph).
  const response = await fetch(file);
  const html = await response.text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const section = page.querySelector("section");
  section.querySelector("p").remove();
  document.getElementById("page-content").replaceChildren(...section.childNodes);

  // A page opened from another page (about → methods) keeps the first way back.
  if (previous === null) {
    previous = { screen: screen, scroll: window.scrollY };
    history.pushState({ page: file }, "");
  }
  showScreen("page");
}

function closePage() {
  const back = previous;
  previous = null;
  showScreen(back.screen);
  window.scrollTo(0, back.scroll);
}
