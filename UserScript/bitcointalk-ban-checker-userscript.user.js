// ==UserScript==
// @name         Bitcointalk Banned Users Checker
// @namespace    https://greasyfork.org/users/1613258
// @version      2.0
// @description  Checks if a user is banned on Bitcointalk.
// @author       promise444c5
// @match        https://bitcointalk.org/index.php?action=profile*
// @match        https://bitcointalk.org/index.php?topic=*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      loyce.club
// ==/UserScript==

(function () {
  "use strict";

  const BANNED_LIST_URL = "https://loyce.club/bans/usernames.txt";
  const SIGBAN_LIST_URL = "https://loyce.club/bans/sigbanned.html";
  const CACHE_BANNED_DATA = "bannedUsersData";
  const CACHE_SIGBANNED_DATA = "sigbannedUsersData";
  const CACHE_KEY_TIMESTAMP = "bannedUsersTimestamp";
  const STATUS_STYLE_ID = "bitcointalk-status-style";
  const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // cache for 1 day  (24 hours)

  let bannedUsers = [];
  let sigBannedUsers = [];
  let scriptError = false;

  const parseBannedUsers = (text) => {
    const users = [];
    if (!text) return users;

    text.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        const lastColonIndex = trimmedLine.lastIndexOf(":");
        if (lastColonIndex !== -1) {
          const userId = trimmedLine.substring(0, lastColonIndex).trim();
          const username = trimmedLine.substring(lastColonIndex + 1).trim();
          users.push({ username, userId });
        } else {
          console.warn(
            `Bitcointalk Ban Checker: Skipping malformed line: ${trimmedLine}`,
          );
        }
      }
    });
    return users;
  };

  const parseSigBannedUsers = (html) => {
    if (!html) return [];
    const users = [];
    const decoder = document.createElement("textarea");

    const decodeHtml = (text) => {
      decoder.innerHTML = text;
      return decoder.value.trim();
    };

    // One pass: capture userId, username, and tail content per record
    const rowRegex =
      /(?:^|<br\s*\/?>)\s*(?:<font[^>]*>\s*\d+\.\s*<\/font>\s*)?(\d+)\s*:\s*<a[^>]*action=profile;u=\d+[^>]*>([^<]+)<\/a>([\s\S]*?)(?=<br\s*\/?>|$)/gi;

    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const userId = rowMatch[1];
      const username = decodeHtml(rowMatch[2]);
      const tail = rowMatch[3] || "";

      // Track latest event and latest date (ISO yyyy-mm-dd is lexicographically sortable)
      let latestEventStatus = "active";
      let latestEventDate = null;
      let latestAnyDate = null;

      const dateRegex = /\((\d{4}-\d{2}-\d{2})\)/g;
      let d;
      while ((d = dateRegex.exec(tail)) !== null) {
        const dt = d[1];
        if (!latestAnyDate || dt >= latestAnyDate) latestAnyDate = dt;
      }

      const eventRegex =
        /(applied|removed)(?:\s|<[^>]+>|&nbsp;)*\((\d{4}-\d{2}-\d{2})\)/gi;
      let e;
      while ((e = eventRegex.exec(tail)) !== null) {
        const action = e[1].toLowerCase();
        const dt = e[2];

        // If same date repeats, keep the later occurrence in text order
        if (!latestEventDate || dt >= latestEventDate) {
          latestEventDate = dt;
          latestEventStatus = action === "removed" ? "removed" : "active";
        }
      }

      users.push({
        userId,
        username,
        status: latestEventDate ? latestEventStatus : "active",
        date: latestEventDate || latestAnyDate || null,
      });
    }

    return users;
  };

  /* create status styles for both sigbanned and banned profiles */
  const ensureStatusStyles = () => {
    if (document.getElementById(STATUS_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STATUS_STYLE_ID;
    style.textContent = `
      .banned-user-text {
        text-decoration: line-through;
        color: #dc2626;
      }

      .banned-label {
        background-color: #dc2626;
        color: #ffffff;
        font-size: 10px;
        padding: 1px 4px;
        border-radius: 3px;
        margin-left: 5px;
        font-weight: bold;
        display: inline-block;
        vertical-align: middle;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .banned-message {
        color: #dc2626;
        font-weight: bold;
        margin-top: 5px;
      }

      .sigban-user-text {
        color: #b46d09;
      }

      .sigban-label {
        background-color: #b46d09;
        color: #eae8e8;
        font-size: 10px;
        padding: 1px 4px;
        border-radius: 3px;
        margin-left: 5px;
        font-weight: bold;
        display: inline-block;
        vertical-align: middle;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .sigban-message {
        color: #b46d09;
        font-weight: bold;
        margin-top: 5px;
      }
    `;
    document.head.appendChild(style);
  };

  /* Build an index of users for fast lookup..*/
  const buildUserIndex = (users) => {
    const byUsername = new Map();
    const byUserId = new Map();

    for (const user of users) {
      if (user?.username) byUsername.set(user.username, user);
      if (user?.userId) byUserId.set(String(user.userId), user);
    }

    return { byUsername, byUserId };
  };

  const findMatch = (index, username, userId) => {
    if (userId != null && index.byUserId.has(String(userId))) {
      return index.byUserId.get(String(userId));
    }
    if (username != null && index.byUsername.has(username)) {
      return index.byUsername.get(username);
    }
    return null;
  };

  const getProfileUsernameCell = () => {
    return [...document.querySelectorAll("td.windowbg table td")].find(
      (td) => td.querySelector("b")?.textContent.trim() === "Name:",
    )?.nextElementSibling;
  };

  const decorateProfileUser = (usernameCell, username, config) => {
    if (!usernameCell) return;

    const existingLabel = usernameCell.querySelector(`.${config.labelClass}`);
    if (existingLabel) return;

    usernameCell.textContent = username;
    usernameCell.classList.add(config.textClass);

    const label = document.createElement("span");
    label.className = config.labelClass;
    label.textContent = config.labelText;
    usernameCell.appendChild(label);
  };

  const decorateThreadUsers = (usersIndex, config) => {
    const postElements = document.querySelectorAll(".windowbg, .windowbg2");
    let matchesFound = 0;

    postElements.forEach((post) => {
      const usernameElement = post.querySelector(".poster_info b a");
      if (!usernameElement) return;

      if (usernameElement.dataset.statusApplied === config.statusKey) return;

      const username = usernameElement.textContent.trim();
      const userId = usernameElement.href.match(/u=(\d+)/)?.[1] ?? null;
      const match = findMatch(usersIndex, username, userId);

      if (!match) return;

      config.allowTextDecoration &&
        (usernameElement.style.textDecoration = "line-through");
      usernameElement.style.color = config.color;
      usernameElement.classList.add(config.textClass);
      usernameElement.dataset.statusApplied = config.statusKey;

      const parent = usernameElement.parentNode;
      if (parent && !parent.querySelector(`.${config.labelClass}`)) {
        const label = document.createElement("span");
        label.className = config.labelClass;
        label.textContent = config.labelText;
        parent.insertBefore(label, usernameElement.nextSibling);
      }

      matchesFound++;
    });

    if (matchesFound > 0) {
      console.log(`Bitcointalk Ban Checker: Found ${matchesFound} matches.`);
    }
  };

  /* Apply user status to profile or thread pages */
  const applyUserStatus = (users, config, owner) => {
    if (scriptError || users.length === 0) {
      console.log(`Bitcointalk Ban Checker: No ${config.name} users to check.`);
      return;
    }

    ensureStatusStyles();

    const usersIndex = buildUserIndex(users);
    const currentUrl = window.location.href;
    const isProfilePage = currentUrl.includes("action=profile");
    const isThreadPage = currentUrl.includes("topic=");

    if (isProfilePage) {
      const profileUsernameElement = getProfileUsernameCell();
      if (!profileUsernameElement) return;

      const profileUsername = profileUsernameElement.textContent.trim();
      const profileUserId = currentUrl.match(/u=(\d+)/)?.[1] ?? null;
      const match = findMatch(usersIndex, profileUsername, profileUserId);

      if (!match) return;

      const profileRow = profileUsernameElement.closest("tr");
      const existingMessage = profileRow?.nextElementSibling;

      const messageText =
        config.statusKey === "banned"
          ? `User ${profileUsername} is ${config.name}!`
          : `User ${profileUsername} is currently serving a signature ban warning!`;

      if (
        !existingMessage ||
        !existingMessage.classList.contains(config.messageRowClass)
      ) {
        const messageRow = document.createElement("tr");
        messageRow.className = config.messageRowClass;

        const messageCell = document.createElement("td");
        messageCell.colSpan = 2;

        const message = document.createElement("div");
        message.className = config.messageClass;
        message.textContent = messageText;

        messageCell.appendChild(message);
        messageRow.appendChild(messageCell);

        profileRow?.parentNode?.insertBefore(
          messageRow,
          profileRow.nextSibling,
        );
      }

      decorateProfileUser(profileUsernameElement, profileUsername, config);
      return;
    }

    if (isThreadPage) {
      decorateThreadUsers(usersIndex, config);
    }
  };

  const applyBan = () => {
    applyUserStatus(
      bannedUsers,
      {
        name: "banned",
        statusKey: "banned",
        labelText: "BANNED",
        textClass: "banned-user-text",
        labelClass: "banned-label",
        messageClass: "banned-message",
        messageRowClass: "banned-message-row",
        color: "#dc2626",
        allowTextDecoration: true,
      },
      "Ban",
    );
  };

  const applySigBan = () => {
    applyUserStatus(
      sigBannedUsers,
      {
        name: "sigbanned",
        statusKey: "sigbanned",
        labelText: "SIGBAN",
        textClass: "sigban-user-text",
        labelClass: "sigban-label",
        messageClass: "sigban-message",
        messageRowClass: "sigban-message-row",
        color: "#b46d09",
        allowTextDecoration: false,
      },
      "sigban",
    );
  };

  /* --- Modal for displaying banned and sigbanned users --- */
  const MODAL_STYLE_ID = "bitcointalk-modal-style";
  const MODAL_ID = "bitcointalk-status-modal";

  const ensureModalStyles = () => {
    if (document.getElementById(MODAL_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = MODAL_STYLE_ID;
    style.textContent = `
      :root {
        --bt-modal-primary: #375f82;
        --bt-modal-primary-dark: #27445d;
        --bt-modal-primary-soft: #dbe7f1;
        --bt-modal-surface: #f7fbfe;
        --bt-modal-surface-alt: #eef4f8;
        --bt-modal-border: #c3d2de;
        --bt-modal-text: #173042;
        --bt-modal-muted: #5b7284;
      }

      .bt-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(23, 48, 66, 0.72);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        padding: 16px;
      }

      .bt-modal {
        width: min(920px, 100%);
        max-height: min(85vh, 900px);
        background: linear-gradient(180deg, #ffffff 0%, var(--bt-modal-surface) 100%);
        border: 1px solid var(--bt-modal-border);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(23, 48, 66, 0.28);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .bt-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(135deg, var(--bt-modal-primary), #4e7c9f 72%, #6f95b4);
        border-bottom: 1px solid var(--bt-modal-primary-dark);
      }

      .bt-modal-title {
        font-size: 16px;
        font-weight: 800;
        color: #f8fcff;
      }

      .bt-modal-close {
        border: 0;
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
        border-radius: 999px;
        width: 34px;
        height: 34px;
        cursor: pointer;
        font-size: 18px;
        font-weight: 800;
      }

      .bt-modal-close:hover {
        background: rgba(255, 255, 255, 0.26);
      }

      .bt-modal-tabs {
        display: flex;
        gap: 8px;
        padding: 12px 16px 0;
        background: var(--bt-modal-surface);
        border-bottom: 1px solid var(--bt-modal-border);
      }

      .bt-modal-tab {
        border: 1px solid var(--bt-modal-border);
        background: #ffffff;
        color: var(--bt-modal-text);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        font-weight: 700;
        margin-bottom: 2px;
      }

      .bt-modal-tab.is-active {
        background: var(--bt-modal-primary);
        color: #ffffff;
        border-color: var(--bt-modal-primary);
      }

      .bt-modal-body {
        overflow: auto;
        padding: 16px 20px 20px;
      }

      .bt-modal-panel {
        display: none;
      }

      .bt-modal-panel.is-active {
        display: block;
      }

      .bt-section {
        margin-bottom: 18px;
      }

      .bt-section:last-child {
        margin-bottom: 0;
      }

      .bt-section-title {
        margin: 0 0 10px;
        font-size: 14px;
        font-weight: 800;
        color: var(--bt-modal-text);
      }

      .bt-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }

      .bt-item {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border: 1px solid var(--bt-modal-border);
        border-radius: 10px;
        background: #ffffff;
      }

      .bt-item-main {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .bt-pill {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .bt-pill.banned {
        background: #fee2e2;
        color: #991b1b;
      }

      .bt-pill.sig-active {
        background: #fef3c7;
        color: #92400e;
      }

      .bt-pill.sig-removed {
        background: #e5e7eb;
        color: #374151;
      }

      .bt-meta {
        color: var(--bt-modal-muted);
        font-size: 12px;
      }

      .bt-empty {
        color: var(--bt-modal-muted);
        font-style: italic;
        padding: 10px 0;
      }

      .bt-modal-open-btn {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 999998;
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: linear-gradient(135deg, var(--bt-modal-primary), #4e7c9f);
        color: #ffffff;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(23, 48, 66, 0.24);
      }

      .bt-modal-open-btn:hover {
        background: linear-gradient(135deg, var(--bt-modal-primary-dark), #406784);
      }
    `;
    document.head.appendChild(style);
  }; //end of ensureModalStyles

  const sortByDateDesc = (items) => {
    return [...items].sort((a, b) =>
      (b.date || "").localeCompare(a.date || ""),
    );
  };

  const formatDate = (date) => date || "unknown date";

  /* Create the modal structure and return the backdrop element */
  const createStatusModal = () => {
    ensureModalStyles();

    let backdrop = document.getElementById(MODAL_ID);
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "bt-modal-backdrop";

    backdrop.innerHTML = `
      <div class="bt-modal" role="dialog" aria-modal="true" aria-labelledby="bt-modal-title">
        <div class="bt-modal-header">
          <div class="bt-modal-title" id="bt-modal-title">Latest Ban Logs</div>
          <button class="bt-modal-close" type="button" aria-label="Close modal">×</button>
        </div>

        <div class="bt-modal-tabs">
          <button class="bt-modal-tab is-active" type="button" data-tab="banned">Banned</button>
          <button class="bt-modal-tab" type="button" data-tab="sigbanned">Sigbanned</button>
        </div>

        <div class="bt-modal-body">
          <div class="bt-modal-panel is-active" data-panel="banned"></div>
          <div class="bt-modal-panel" data-panel="sigbanned"></div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeModal = () => {
      backdrop.style.display = "none";
    };

    backdrop
      .querySelector(".bt-modal-close")
      .addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal();
    });

    backdrop.querySelectorAll(".bt-modal-tab").forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        const tabName = tabButton.dataset.tab;

        backdrop.querySelectorAll(".bt-modal-tab").forEach((button) => {
          button.classList.toggle("is-active", button === tabButton);
        });

        backdrop.querySelectorAll(".bt-modal-panel").forEach((panel) => {
          panel.classList.toggle("is-active", panel.dataset.panel === tabName);
        });
      });
    });

    return backdrop;
  }; //end of createStatusModal

  /* Render the banned users panel in the modal */
  const renderBannedModalPanel = () => {
    const modal = createStatusModal();
    const panel = modal.querySelector('[data-panel="banned"]');
    const bannedItems = []; // to be added in future

    panel.innerHTML = `
      <div class="bt-section">
        <h3 class="bt-section-title">Banned Users</h3>
        ${
          bannedItems.length
            ? `
              <ul class="bt-list">
                ${bannedItems
                  .map(
                    (user) => `
                    <a href="https://bitcointalk.org/index.php?action=profile;u=${user.userId}" target="_blank" rel="noopener noreferrer " class="bt-item">
                        <div class="bt-item-main">
                          <span class="bt-pill banned">Banned</span>
                          <strong>${user.username}</strong>
                        </div>
                        <div class="bt-meta">${user.userId} • ${formatDate(user.date)}</div>
                      </a>
                    `,
                  )
                  .join("")}
              </ul>
            `
            : `<div class="bt-empty">No Available logs for now.. You can check the full list on <a href="https://loyce.club/bans/banned.html" target="_blank" rel="noopener noreferrer"><span class="bt-pill" style="text-decoration: underline;">Loyce Club</span></a></div>`
        }
      </div>
    `;
  }; //end of renderBannedModalPanel

  /* Render the sigbanned users panel in the modal */
  const renderSigbannedModalPanel = () => {
    const modal = createStatusModal();
    const panel = modal.querySelector('[data-panel="sigbanned"]');

    const activeSigbans = sortByDateDesc(
      sigBannedUsers.filter((user) => user.status === "active"),
    ).slice(0, 15);

    const removedSigbans = sortByDateDesc(
      sigBannedUsers.filter((user) => user.status === "removed"),
    ).slice(0, 5);

    panel.innerHTML = `
      <div class="bt-section">
        <h3 class="bt-section-title">Sigbanned Users</h3>
        ${
          activeSigbans.length
            ? `
              <ul class="bt-list">
                ${activeSigbans
                  .map(
                    (user) => `
                    <a href="https://bitcointalk.org/index.php?action=profile;u=${user.userId}" target="_blank" rel="noopener" class="bt-item">
                        <div class="bt-item-main">
                          <span class="bt-pill sig-active">Active</span>
                          <strong>${user.username}</strong>
                        </div>
                        <div class="bt-meta">${user.userId} • ${formatDate(user.date)}</div>
                      </a>
                    `,
                  )
                  .join("")}
              </ul>
            `
            : `<div class="bt-empty">No active sigbanned users available.</div>`
        }
      </div>

      <div class="bt-section">
        <h3 class="bt-section-title">Removed Sigbans</h3>
        ${
          removedSigbans.length
            ? `
              <ul class="bt-list">
                ${removedSigbans
                  .map(
                    (user) => `
                    <a href="https://bitcointalk.org/index.php?action=profile;u=${user.userId}" target="_blank" rel="noopener" class="bt-item">
                        <div class="bt-item-main">
                          <span class="bt-pill sig-removed">Removed</span>
                          <strong>${user.username}</strong>
                        </div>
                        <div class="bt-meta">${user.userId} • ${formatDate(user.date)}</div>
                      </a>
                    `,
                  )
                  .join("")}
              </ul>
              <div class="bt-meta" style="margin-top: 8px; font-size: 12px;">Note: Only the latest 15 sigbans & 5 latest removed sigbans are shown.. To see more  visit <a href="https://loyce.club/bans/sigbanned.html" target="_blank" rel="noopener noreferrer"><span class="bt-pill" style="text-decoration: underline;">Loyce Club</span></a> or <a href="https://bitlist.co/analytics/sigbanned" target="_blank" rel="noopener noreferrer"><span class="bt-pill" style="text-decoration: underline;">BitList</span></a></div>
            `
            : `<div class="bt-empty">No removed sigbanned users available.</div>`
        }
      </div>
    `;
  }; //end of renderSigbannedModalPanel

  /* Open the status modal and render both panels */
  const openStatusModal = () => {
    const modal = createStatusModal();
    renderBannedModalPanel();
    renderSigbannedModalPanel();
    modal.style.display = "flex";
  };

  const addStatusModalButton = () => {
    ensureModalStyles();
    if (document.querySelector(".bt-modal-open-btn")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "bt-modal-open-btn";
    button.textContent = "Latest Ban Logs";
    button.addEventListener("click", openStatusModal);
    document.body.appendChild(button);
  }; //end of addStatusModalButton

  /**
   * CustomHeaders class to create headers for GM_xmlhttpRequest
   */
  class HttpRequestOptions {
    constructor(accept, referer, url, handler) {
      this.method = "GET";
      this.headers = {
        "User-Agent": "UserScript/Bitcointalk-Ban-Checker",
        Accept: accept,
        "Accept-Language": "en",
        Referer: referer ?? "https://bitcointalk.org/",
      };
      this.timeout = 5000;
      this.url = url;
      Object.assign(this, handler);
    }
  }

  /*
   ** Fetch and cache list,
   ** Used in the main script execution
   */
  const fetchAndCacheBannedList = () => {
    console.log("Bitcointalk Ban Checker: Fetching fresh banned users list...");

    const requestOptions = new HttpRequestOptions(
      "text/plain",
      "https://bitcointalk.org/",
      BANNED_LIST_URL,
      {
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            const fetchedText = response.responseText;
            bannedUsers = parseBannedUsers(fetchedText);
            GM_setValue(CACHE_BANNED_DATA, fetchedText); // Store raw text
            GM_setValue(CACHE_KEY_TIMESTAMP, Date.now());
            console.log(
              `Bitcointalk Ban Checker: Successfully fetched and cached ${bannedUsers.length} users.`,
            );
            applyBan();
          } else {
            console.error(
              `Bitcointalk Ban Checker: Failed to fetch list. Status: ${response.status}`,
            );
            scriptError = true;
            // use stale cache if available?
            applyBan();
          }
        },

        onerror: (error) => {
          console.error(
            "Bitcointalk Ban Checker: Network error fetching banned users list.",
            error,
          );
          scriptError = true;
        },
      },
    );

    GM_xmlhttpRequest(requestOptions);
  };

  /**
   * Fetch and cache sigban list,
   * Used in the main script execution
   */
  const fetchandCacheSigbanList = () => {
    console.log("Bitcointalk Ban Checker: Fetching fresh sigban list...");
    const requestOptions = new HttpRequestOptions(
      "text/html",
      "https://bitcointalk.org/",
      SIGBAN_LIST_URL,
      {
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            const fetchedHtmlText = response.responseText;
            sigBannedUsers = parseSigBannedUsers(fetchedHtmlText);
            GM_setValue(CACHE_SIGBANNED_DATA, fetchedHtmlText); // Store raw text
            GM_setValue(CACHE_KEY_TIMESTAMP, Date.now());
            console.log(
              `Bitcointalk Ban Checker: Successfully fetched and cached ${sigBannedUsers.length} sigbanned users.`,
            );
            applySigBan();
          } else {
            console.error(
              `Bitcointalk Ban Checker: Failed to fetch sigBan list. Status: ${response.status}`,
            );
            scriptError = true;
            // use stale cache if available?
            applySigBan();
          }
        },

        onerror: (error) => {
          console.error(
            "Bitcointalk Ban Checker: Network error fetching sigban list.",
            error,
          );
          scriptError = true;
        },
      },
    );

    GM_xmlhttpRequest(requestOptions);
  };

  /* --- Main Script Execution ---*/
  const cachedTimestamp = GM_getValue(CACHE_KEY_TIMESTAMP, 0);
  const cachedBannedData = GM_getValue(CACHE_BANNED_DATA, null);
  const cachedSigbanData = GM_getValue(CACHE_SIGBANNED_DATA, null);
  const now = Date.now();

  if (
    cachedBannedData &&
    cachedSigbanData &&
    now - cachedTimestamp < CACHE_DURATION_MS
  ) {
    console.log("Bitcointalk Ban Checker: Using cached banned users list.");
    bannedUsers = parseBannedUsers(cachedBannedData);
    sigBannedUsers = parseSigBannedUsers(cachedSigbanData);
    applyBan();
    applySigBan();
  } else {
    if (cachedBannedData || cachedSigbanData) {
      console.log(
        "Bitcointalk Ban Checker: Cache expired, fetching new banned and sigbanned users list..",
      );
      // Use stale data immediately while fetching in background
      bannedUsers = parseBannedUsers(cachedBannedData);
      sigBannedUsers = parseSigBannedUsers(cachedSigbanData);
      applyBan();
      applySigBan();
      /* Fetch new list in background */
      fetchAndCacheBannedList();
      fetchandCacheSigbanList();
    } else {
      console.log(
        "Bitcointalk Ban Checker: No cache found, fetching banned and sigbanned users list..",
      );
      fetchAndCacheBannedList();
      fetchandCacheSigbanList(); // Fetch sigban list
      applyBan(); // Apply after fetching new data
      applySigBan(); // Apply after fetching new data
    }
  }
  addStatusModalButton();
})();
