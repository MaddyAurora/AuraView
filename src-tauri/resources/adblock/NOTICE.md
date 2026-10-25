# Ad blocking components

AuraView uses **adblock-rust 0.13.3** by Brave Software and its contributors,
unmodified, under MPL-2.0. Source: https://github.com/brave/adblock-rust
and https://crates.io/crates/adblock/0.13.3. See MPL-2.0.txt.

Bundled **EasyList** and **EasyPrivacy** snapshots are by **The EasyList authors
(https://easylist.to/)**, version 202610250013, retrieved October 25, 2026.
Their contents are unmodified. AuraView uses these filter-list data files under
the Creative Commons Attribution-ShareAlike 3.0 Unported license. See
CC-BY-SA-3.0.txt and https://easylist.to/pages/licence.html.

Sources and update URLs:
- https://easylist.to/easylist/easylist.txt
- https://easylist.to/easylist/easyprivacy.txt
- https://github.com/easylist/easylist

The lists are embedded for offline startup. Validated updates are downloaded
over HTTPS in the background, at most daily, while ad blocking is enabled.
No browsing history, page URLs, cookies, or login data are sent to list providers.
Failed updates leave the previous lists in use. Downloads are stored in
AuraView's local application data, separately from website storage.

This is an independent built-in blocker, not the uBlock Origin extension.
It uses network filtering, standard CSS element-hiding rules and independently
implemented response filtering for YouTube player data and Instagram sponsored
feed entries. This site-specific implementation is AuraView code under the
project's MIT license; no uBO scriptlet code is incorporated. Initial page data
and fetch/XHR responses are handled before the page consumes them. Ordinary
content and login cookies are preserved, and unrecognized responses pass through.
Server-side ad variants and creator sponsorships can still remain. It does not
implement uBO's full scriptlet library, procedural filters, dynamic firewall,
or element picker. WebView2's per-document request hook covers page and iframe
requests, not all independent service/shared-worker traffic or WebSockets.
Some deeply nested cross-origin requests also bypass the event in current
WebView2 runtimes: https://github.com/MicrosoftEdge/WebView2Feedback/issues/5765.
Local/private-network pages and resources are excluded. Reload after changing
the setting to restore previously blocked resources or remove already-loaded ads.
