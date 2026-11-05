# Instagram Non-Followers Manager

A browser-console script that shows which accounts you follow don't follow you back, and lets you unfollow the ones you pick, with safe random delays and a final verification step.

It runs entirely in your own browser, using your own logged-in Instagram session. No server, no extension, no third-party service: nothing is sent anywhere except to `instagram.com`.

> **Disclaimer:** This script uses Instagram's unofficial web endpoints. They can change or break at any time, and automating actions may violate [Instagram's Terms of Use](https://help.instagram.com/581066165581870). Use it at your own risk. The authors are not responsible for blocked actions, restrictions or account suspensions.

## Features

- Lists every account you follow that doesn't follow you back
- Search by username or full name
- Sort A → Z, Z → A, or in Instagram's own order
- Filter: all / public only / private only, and hide verified accounts
- Bulk selection: "Select visible", "Clear selection", and shift-click range selection
- Safe unfollowing with random delays (5–10 s or 10–20 s) and a confirmation dialog with a summary and time estimate
- Progress bar with remaining-time estimate, plus a **Stop** button
- **Refresh** button to reload followers and following at any time
- **Automatic verification:** after unfollowing, the script re-downloads your following list and confirms the accounts are really gone. A green banner tells you when it is safe to close the panel
- Warns you before closing or reloading the tab while an operation is running
- Optional: import `following.json` from Instagram's data export to see real "followed on" dates and sort by them

## Usage

1. Log in at <https://www.instagram.com> in your desktop browser.
2. Open DevTools (`F12`, or `Ctrl+Shift+I` / `Cmd+Option+I`) and go to the **Console** tab.
3. Copy the whole contents of [`instagram-nonfollowers.js`](./instagram-nonfollowers.js), paste it into the console and press **Enter**.
4. Wait for the lists to load. The panel shows progress and an estimated time.
5. Select the accounts you want to unfollow and press **Unfollow selected**.
6. Pick a delay profile, confirm, and **keep the tab open**. When the green **"DONE & VERIFIED"** banner appears, it is safe to close the panel.

If the browser warns you about pasting into the console, follow its instructions (some browsers ask you to type `allow pasting` first). Only ever paste code you have read and trust.

## Banner states

| Banner | Meaning |
| --- | --- |
| 🟠 Working / Verifying | An operation is in progress. Do **not** close the panel or the tab. |
| 🟢 Done & verified | Every unfollow was confirmed against Instagram's data. Safe to close. |
| 🔴 Verification problems | Some accounts are still in your following list. They reappear in the list; wait a minute and try again, or press Refresh. |
| 🔵 Stopped early | The run ended before finishing. Verified accounts are listed, the rest stay selected so you can continue. |

## Importing follow dates (optional)

Instagram's web API doesn't expose when you followed someone. To see real dates:

1. In Instagram, go to **Settings → Accounts Center → Your information and permissions → Download your information**.
2. Request your data in **JSON** format (the Followers and Following section is enough).
3. Unzip the export and find `following.json`.
4. In the panel, click **Import following.json (dates)**.

Two extra sort options appear: *Followed: oldest first* and *newest first*.

## Tips for staying safe

- Keep batches small: **a few dozen accounts per day** is much safer than hundreds at once.
- Prefer the **Safe** delay profile (10–20 s between unfollows).
- If Instagram shows an "action blocked" message, stop and wait for a day or more before trying again.
- Always check the confirmation list before you press the final button.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Please run this on https://www.instagram.com" | Open `https://www.instagram.com` (with `www.`) and run the script there. |
| "You do not appear to be logged in" | Log in, reload the page and run the script again. |
| `HTTP 429` while loading | You are rate limited. Wait a while and press Refresh. |
| "token not found" while unfollowing | Manually follow or unfollow any account on Instagram itself once (outside the panel), then try again. |
| Nothing happens after an update by Instagram | The unofficial endpoints probably changed. Open an issue. |

## How it works

1. Reads your session cookies (`ds_user_id`, `csrftoken`) to call Instagram's web endpoints as you.
2. Downloads your followers and following in pages of 100, with short random pauses.
3. Compares both lists by user ID to find non-followers.
4. Unfollows the selected accounts one by one through `friendships/destroy`, waiting a random delay between each.
5. Re-downloads your following list and checks that none of the unfollowed accounts are still there.

When you close the panel, the script restores the browser's original `fetch` and `XMLHttpRequest`.

## Contributing

Issues and pull requests are welcome, especially when Instagram changes its endpoints.

## License

[MIT](./LICENSE)
