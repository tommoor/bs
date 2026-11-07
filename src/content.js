(() => {
  "use strict";

  // Public bearer token embedded in X's own web client. Combined with the
  // user's session cookie and CSRF token it authenticates as the logged-in user.
  const BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/;
  const ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>';

  /** Handles blocked during this page session, lowercased. */
  const blocked = new Set();

  // ---------------------------------------------------------------------------
  // DOM helpers

  function getAuthorHandle(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName) return null;
    const links = [...userName.querySelectorAll("a[href]")];
    const link =
      links.find((a) => a.textContent.trim().startsWith("@")) || links[0];
    const match = link?.getAttribute("href").match(HANDLE_RE);
    return match ? match[1] : null;
  }

  function getOwnHandle() {
    const link = document.querySelector(
      'a[data-testid="AppTabBar_Profile_Link"]'
    );
    const match = link?.getAttribute("href").match(HANDLE_RE);
    return match ? match[1].toLowerCase() : null;
  }

  function getActionBar(article) {
    const reply = article.querySelector('[data-testid="reply"]');
    const group = reply?.closest('[role="group"]');
    return group && group.closest("article") === article ? group : null;
  }

  function waitFor(fn, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        const result = fn();
        if (result) return resolve(result);
        if (Date.now() - start > timeout) {
          return reject(new Error("Timed out waiting for X's UI"));
        }
        setTimeout(poll, 50);
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Blocking

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function callApi(path, handle) {
    const csrf = getCsrfToken();
    if (!csrf) throw new Error("Not logged in");

    const res = await fetch(`${location.origin}/i/api/1.1/${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER}`,
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrf,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
      },
      body: new URLSearchParams({ screen_name: handle }),
    });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.errors?.[0]?.message || message;
      } catch {}
      throw new Error(message);
    }
  }

  /** Fallback: drive X's own "…" menu → Block → Confirm flow. */
  async function blockViaMenu(article) {
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) throw new Error("Tweet menu not found");
    caret.click();
    try {
      const item = await waitFor(() =>
        document.querySelector('[role="menu"] [data-testid="block"]')
      );
      item.click();
      const confirm = await waitFor(() =>
        document.querySelector('[data-testid="confirmationSheetConfirm"]')
      );
      confirm.click();
    } catch (err) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      throw err;
    }
  }

  async function block(handle, article) {
    try {
      await callApi("blocks/create.json", handle);
    } catch (apiError) {
      console.warn("[bs] API block failed, falling back to menu", apiError);
      await blockViaMenu(article);
    }
  }

  // ---------------------------------------------------------------------------
  // Hiding blocked tweets

  function collapse(article, handle) {
    if (article.dataset.bsHidden) return;
    article.dataset.bsHidden = "true";

    const placeholder = document.createElement("div");
    placeholder.className = "bs-placeholder";
    placeholder.dataset.bsHandle = handle.toLowerCase();

    const label = document.createElement("span");
    label.textContent = `Blocked @${handle}`;

    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "Undo";
    undo.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      unblock(handle, undo);
    });

    placeholder.append(label, "·", undo);
    article.style.display = "none";
    article.before(placeholder);
  }

  function collapseAll(handle) {
    const key = handle.toLowerCase();
    for (const article of document.querySelectorAll(
      'article[data-testid="tweet"]'
    )) {
      if (getAuthorHandle(article)?.toLowerCase() === key) {
        collapse(article, handle);
      }
    }
  }

  async function unblock(handle, button) {
    button.disabled = true;
    button.textContent = "Undoing…";
    try {
      await callApi("blocks/destroy.json", handle);
    } catch (err) {
      console.error("[bs] Unblock failed", err);
      button.disabled = false;
      button.textContent = "Undo failed – retry";
      return;
    }

    const key = handle.toLowerCase();
    blocked.delete(key);
    for (const placeholder of document.querySelectorAll(
      `.bs-placeholder[data-bs-handle="${key}"]`
    )) {
      const article = placeholder.nextElementSibling;
      if (article?.dataset.bsHidden) {
        article.style.display = "";
        delete article.dataset.bsHidden;
      }
      placeholder.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Button injection

  async function onClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const article = button.closest("article");
    const handle = article && getAuthorHandle(article);
    if (!handle || button.disabled) return;

    button.disabled = true;
    button.classList.remove("bs-error");
    try {
      await block(handle, article);
      blocked.add(handle.toLowerCase());
      collapseAll(handle);
    } catch (err) {
      console.error("[bs] Block failed", err);
      button.classList.add("bs-error");
      button.title = `Block failed: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }

  function createButton() {
    const wrapper = document.createElement("div");
    wrapper.className = "bs-action";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "bs-button";
    button.title = "Block user";
    button.setAttribute("aria-label", "Block user");
    button.innerHTML = ICON;
    button.addEventListener("click", onClick);

    wrapper.append(button);
    return wrapper;
  }

  function processArticle(article, ownHandle) {
    const handle = getAuthorHandle(article);
    if (!handle) return;
    const key = handle.toLowerCase();

    if (blocked.has(key)) {
      collapse(article, handle);
      return;
    }

    const bar = getActionBar(article);
    if (!bar || bar.querySelector(".bs-action")) return;
    if (key === ownHandle) return;

    bar.append(createButton());
  }

  function scan() {
    const ownHandle = getOwnHandle();
    for (const article of document.querySelectorAll(
      'article[data-testid="tweet"]'
    )) {
      processArticle(article, ownHandle);
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
  });
  scan();
})();
