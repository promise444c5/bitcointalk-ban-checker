// ==UserScript==
// @name         Bitcointalk Banned Users Checker
// @namespace    http://tampermonkey.net/
// @version      1.1
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
      console.log("Bitcointalk Ban Checker: Decoded HTML text:", decoder);
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

  const applyBan = () => {
    if (scriptError || bannedUsers.length === 0) {
      console.log(
        "Bitcointalk Ban Checker: Skipping application due to error or empty list.",
      );
      return;
    }

    console.log(
      `Bitcointalk Ban Checker: Applying Ban on ${bannedUsers.length} banned users.`,
    );

    const currentUrl = window.location.href;
    const isProfilePage = currentUrl.includes("action=profile");
    const isThreadPage = currentUrl.includes("topic=");

    // Add CSS style to the page
    const style = document.createElement("style");
    style.textContent = `
            .banned-user-text {
              text-decoration: line-through;
              color: red;
            }
      
            .banned-label {
              background-color: red;
              color: white;
              font-size: 10px;
              padding: 1px 3px;
              border-radius: 3px;
              margin-left: 5px;
              font-weight: bold;
              display: inline-block;
              vertical-align: middle;
            }
          `;
    document.head.appendChild(style);

    if (isProfilePage) {
      console.log("Bitcointalk Ban Checker: Running on profile page.");
      let profileUsernameElement = null;
      // Find the 'Name:' cell and get the next sibling cell which contains the username
      document.querySelectorAll("td.windowbg table td").forEach((td) => {
        const boldElement = td.querySelector("b");
        if (boldElement && boldElement.textContent.trim() === "Name:") {
          profileUsernameElement = td.nextElementSibling;
          console.log(
            "Bitcointalk Ban Checker: Found potential username TD element.",
          );
        }
      });

      if (profileUsernameElement) {
        let profileUsername = profileUsernameElement.textContent.trim();
        console.log(
          `Bitcointalk Ban Checker: Checking profile username: ${profileUsername}`,
        );

        // Check if the username exists in the bannedUsers array
        const isBanned = bannedUsers.find(
          (user) => user.username === profileUsername,
        );

        if (isBanned) {
          let banMessage = `User ${profileUsername} is listed as banned.`;

          // Create and insert the ban status message below the username row
          let banStatusElement = document.createElement("div");
          banStatusElement.style.color = "red";
          banStatusElement.style.fontWeight = "bold";
          banStatusElement.style.marginTop = "5px";
          banStatusElement.textContent = banMessage;

          let usernameRow = profileUsernameElement.closest("tr");
          if (usernameRow && usernameRow.parentNode) {
            let newRow = document.createElement("tr");
            let newCell = document.createElement("td");
            newCell.colSpan = 2;
            newCell.appendChild(banStatusElement);
            newRow.appendChild(newCell);
            usernameRow.parentNode.insertBefore(
              newRow,
              usernameRow.nextSibling,
            );
            console.log(
              "Bitcointalk Ban Checker: Inserted ban status message row.",
            );
          } else {
            console.warn(
              "Bitcointalk Ban Checker: Could not find username row to insert message.",
            );
          }

          // Check if label already exists to prevent duplicates on potential re-runs (though unlikely on profile)
          if (!profileUsernameElement.querySelector(".banned-label")) {
            const bannedLabel = document.createElement("span");
            bannedLabel.textContent = "BANNED";
            bannedLabel.classList.add("banned-label");
            // Append the label to the TD containing the username
            profileUsernameElement.appendChild(bannedLabel);
            console.log(
              "Bitcointalk Ban Checker: Appended BANNED label to username TD.",
            );
            // The following lines attempt to wrap the text and re-append the label,
            profileUsernameElement.childNodes[0].nodeValue =
              profileUsernameElement.childNodes[0].nodeValue + " "; // Add space before label - This assumes first child is text node
            profileUsernameElement.innerHTML = `<span class="banned-user-text">${profileUsername}</span>`; // Wrap text - This overwrites existing content including the label just added
            profileUsernameElement.appendChild(bannedLabel);
          }
        } else {
          console.log(
            `Bitcointalk Ban Checker: User ${profileUsername} is not listed as banned.`,
          );
        }
      } else {
        console.log(
          "Bitcointalk Ban Checker: Could not find username element on profile page using the 'Name:' label.",
        );
      }
    } else if (isThreadPage) {
      console.log("Bitcointalk Ban Checker: Running on thread page.");
      const checkBannedUsersOnThread = () => {
        const postElements = document.querySelectorAll(".windowbg, .windowbg2");
        let bannedFound = 0;

        postElements.forEach((post) => {
          const usernameElement = post.querySelector(".poster_info b a");
          if (!usernameElement) return;

          // Check if style already applied to prevent redundant checks/updates
          if (usernameElement.style.textDecoration === "line-through") return;

          const username = usernameElement.textContent.trim();

          // Check if the username exists in the bannedUsers array
          const isBanned = bannedUsers.find(
            (user) => user.username === username,
          );

          if (isBanned) {
            // Apply styles directly to the <a> tag
            usernameElement.style.textDecoration = "line-through";
            usernameElement.style.color = "red";

            // create a label next to the username link
            if (!usernameElement.parentNode.querySelector(".banned-label")) {
              const bannedLabel = document.createElement("span");
              bannedLabel.textContent = "BANNED";
              bannedLabel.classList.add("banned-label");
              usernameElement.parentNode.insertBefore(
                bannedLabel,
                usernameElement.nextSibling,
              );
              bannedFound++;
              console.log(
                `Bitcointalk Ban Checker: Added BANNED label for ${username}.`,
              );
            }
          }
        });
        if (bannedFound > 0) {
          console.log(
            `Bitcointalk Ban Checker: Found ${bannedFound} banned occurences.`,
          );
        }
      };

      // Initial check
      checkBannedUsersOnThread();
    }
  }; //end applyBan

  const applySigBan = () => {
    if (scriptError || sigBannedUsers.length === 0) {
      console.log("Bitcointalk Ban Checker: No sigbanned users to check.");
      return;
    }
  };

  /**
   * CustomHeaders class to create headers for GM_xmlhttpRequest
   * @param {string} accept
   * @param {string} referer
   * @returns {object} headers
   */
  //Modified options
  class HttpRequestOptions {
    constructor(accept, referer, url, handler) {
      this.method = "GET";
      this.headers = {
        "User-Agent": "UserScript/1.0",
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
            applyBan();
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
  } else {
    if (cachedBannedData || cachedSigbanData) {
      console.log(
        "Bitcointalk Ban Checker: Cache expired, fetching new banned users list.",
      );
      // Use stale data immediately while fetching in background
      bannedUsers = parseBannedUsers(cachedBannedData);
      sigBannedUsers = parseSigBannedUsers(cachedSigbanData);
      applyBan();
      fetchAndCacheBannedList();
      fetchandCacheSigbanList(); // Fetch new list in background
      applyBan(); // Re-apply after fetching new data
    } else {
      console.log(
        "Bitcointalk Ban Checker: No cache found, fetching banned users list.",
      );
      fetchAndCacheBannedList();
      fetchandCacheSigbanList(); // Fetch sigban list
      applyBan(); // Apply after fetching new data
    }
  }
})();
