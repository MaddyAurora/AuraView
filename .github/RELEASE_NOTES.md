## What's new in v0.3.1

- Unified images, videos, and browser file downloads in **Downloads**, with combined green progress, five-second completion feedback, average speed, and estimated time remaining when the size is known.
- Added a Downloads hover preview that overlays the page without resizing it. Click the button to pin the full history and resize the page area.
- Added **Show in folder**, **Delete file** (Recycle Bin), and **Download again** actions. Repeated downloads create numbered copies without overwriting existing files.
- Improved Instagram story video downloads, including stories opened from the home feed, and improved main-video identification after advertisements on supported watch pages.
- Image and video download buttons hide after three seconds without pointer movement and return when the pointer moves. Images displayed below 120 pixels in either dimension no longer show a download button.
- Added bookmark HTML import/export compatible with Chrome and Edge, nested folder support, folder deletion, reliable click-to-close behavior, and five-second action feedback.
- Added custom AI Dock entries with editable ports, names, descriptions, and colors, plus deletion and drag reordering. Removed the "LOCAL AI HUB:" prefix.
- Added a gear menu with searchable browsing history, local timestamps, and separate actions to clear browser history, cookies, and website login data. Clearing history preserves cookies, logins, downloaded files, and active transfers.
- Added **Keep URL history**. Turning it off clears saved visits and automatically clears new visits after navigation, on startup, and before normal exit. WebView2 can briefly write visits before cleanup; forced termination can leave records until the next startup. Cookies and logins remain enabled.
- Bookmarks and AI Dock visibility now persist independently across restarts, including changes made with the AI Dock keyboard shortcut. Login-data cleanup preserves bookmarks, AI Dock entries, and toolbar visibility.

## Windows installers

Choose either the **EXE setup** or **MSI installer** from the assets below. Both install AuraView v0.3.1 for Windows x64 and include the video download tools.

Clearing cookies may sign you out. Clearing login sessions also removes website storage and reloads open pages; AuraView preferences are preserved.
