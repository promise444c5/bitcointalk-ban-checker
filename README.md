# Bitcointalk-ban-checker

## Key Features

- **Banned User Highlighting:** Automatically scans BitcoinTalk forum threads and user profiles (`action=profile`) for usernames present in a known banned list.
- **Sigban Support:** Parses the sigbanned list and tracks both active sigbans and removed sigbans using the latest event timestamp.
- **Visual Indicators:** Applies distinct styling for banned users and sigbanned users, with separate labels.
- **External List Source:** Fetches the banned list from `https://loyce.club/bans/usernames.txt` and the sigbanned HTML list from `https://loyce.club/bans/sigbanned.html`.
- **Modal Viewer:** Adds a sticky button that opens a modal with two tabs: banned users and sigbanned users.
- **Sigban Breakdown:** The sigbanned tab splits entries into active sigbanned users and removed sigbanned users.
- **Cross-Browser Compatibility (Extension):** Designed to work on both Chrome (and Chromium-based browsers) and Firefox.
- **User Script Adaptable:** The core content script logic for identifying and styling users can be extracted and used within user script managers like Tampermonkey or Greasemonkey.

## How it Works

1.  **Fetching:** The script fetches the banned and sigbanned lists from Loyce Club and caches them.
2.  **Parsing:** The sigbanned parser extracts `userId`, `username`, `status`, and the latest `date` from each record.
3.  **Scanning:** The content script scans page content, profile pages, and thread posts for matching usernames.
4.  **Matching & Styling:** It compares found usernames against the cached lists and applies the appropriate styling when a match is found.
5.  **Modal Display:** The sticky button opens a modal that shows the latest banned users and the active/removed sigbanned breakdown on demand.

## Installation

- **Browser Extension:**
  - Load the extension directory as an unpacked extension via your browser's extension management page (`chrome://extensions` or `about:debugging`). Note that sigbanned functionality is yet to be available in the extension version.
- **User Script (Adaptation):**
  - Requires a user script manager (e.g., Tampermonkey, Greasemonkey).
  - Adapt the `bitcointalk-ban-checker-userscript.user.js` logic into a user script.

## Notes

- The banned list format is expected to be `userId:username`.
- The sigbanned list is parsed from HTML and uses the latest event in each row to determine whether a user is active or removed.
- The modal is only created when the user clicks the sticky button, keeping the page lighter on initial load.
- The script requires permissions to access `bitcointalk.org` and `loyce.club`, store user preferences, and interact with tabs or injected UI as needed.

#### Check [releases](https://github.com/promise444c5/bitcointalk-ban-checker/releases) for assets.
