## What's new in v0.3.3

- Added built-in ad blocking, enabled by default, with a persistent **Ad blocking** switch in the gear Settings menu.
- Blocks ad and tracker requests and hides matching page elements using Brave's native Rust filtering engine, EasyList, and EasyPrivacy. Bundled lists work offline; validated background updates retain existing protection if a download fails.
- Added filtering for YouTube video-ad data in initial player pages and later fetch/XHR responses, preserving normal video metadata and playback. Visible Skip ad controls are used only while the player reports an ad.
- Added filtering for Instagram sponsored feed entries and a sponsored-label fallback. Ordinary posts, captions, profile names, and login cookies are preserved; recycled ordinary posts become visible again.
- Applies protection to browser tabs and split panes, while excluding localhost AI apps and private-network resources. Reload pages after changing the setting.

This is an independent blocker, not the uBlock Origin extension. Some server-inserted video ads, creator sponsorships, worker/WebSocket traffic, and deeply nested cross-origin requests may remain.

## Windows installers

Choose either the **EXE setup** or **MSI installer** below. Both install AuraView v0.3.3 for Windows x64 and include the video download tools, filter lists, and third-party license notices.
