//! Narrow, independently implemented site handling for first-party ad payloads.
//! Leaves media URLs, playback metadata, ordinary feed entries and strings intact.
use serde_json::Value;

const MAX_BODY: usize = 12 * 1024 * 1024;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Site {
    Youtube,
    Instagram,
}
fn site(url: &str) -> Option<Site> {
    let parsed = tauri::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?.trim_end_matches('.');
    if host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
    {
        Some(Site::Youtube)
    } else if host == "instagram.com" || host.ends_with(".instagram.com") {
        Some(Site::Instagram)
    } else {
        None
    }
}
fn eligible(url: &str, resource: &str) -> bool {
    let Some(site) = site(url) else { return false };
    if resource == "Document" {
        return true;
    }
    if !matches!(resource, "XHR" | "Fetch") {
        return false;
    }
    let Ok(url) = tauri::Url::parse(url) else {
        return false;
    };
    let path = url.path();
    match site {
        Site::Youtube => {
            path.starts_with("/youtubei/v1/")
                || matches!(path, "/watch" | "/playlist" | "/get_video_info")
        }
        Site::Instagram => {
            path.starts_with("/graphql/")
                || path == "/api/graphql"
                || path.starts_with("/api/v1/feed/")
                || path.starts_with("/api/v1/clips/")
                || path.starts_with("/api/v1/discover/")
        }
    }
}
fn ad_item(value: &Value, site: Site, depth: usize) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    match site {
        Site::Youtube => {
            if [
                "adSlotRenderer",
                "adPlacementRenderer",
                "displayAdRenderer",
                "inFeedAdLayoutRenderer",
                "promotedSparklesWebRenderer",
                "promotedSparklesTextSearchRenderer",
                "promotedVideoRenderer",
                "instreamVideoAdRenderer",
                "companionAdRenderer",
            ]
            .iter()
            .any(|key| object.contains_key(*key))
            {
                return true;
            }
            if value
                .pointer("/command/reelWatchEndpoint/adClientParams/isAd")
                .and_then(Value::as_bool)
                == Some(true)
            {
                return true;
            }
        }
        Site::Instagram => {
            if ["is_ad", "is_sponsored"]
                .iter()
                .any(|key| object.get(*key).and_then(Value::as_bool) == Some(true))
            {
                return true;
            }
            if object.get("ad_id").is_some_and(|id| {
                id.as_str().is_some_and(|id| !id.is_empty() && id != "0")
                    || id.as_u64().is_some_and(|id| id > 0)
            }) {
                return true;
            }
        }
    }
    if depth == 0 {
        return false;
    }
    let wrappers: &[&str] = match site {
        Site::Youtube => &["richItemRenderer", "content", "node"],
        Site::Instagram => &["node", "media_or_ad", "media", "item"],
    };
    wrappers.iter().any(|key| {
        object
            .get(*key)
            .is_some_and(|child| ad_item(child, site, depth - 1))
    })
}
fn prune(value: &mut Value, site: Site, budget: &mut usize) -> bool {
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    let mut changed = false;
    match value {
        Value::Array(items) => {
            let old_len = items.len();
            items.retain(|item| !ad_item(item, site, 3));
            changed |= items.len() != old_len;
            for item in items {
                changed |= prune(item, site, budget);
            }
        }
        Value::Object(object) => {
            if site == Site::Youtube {
                for key in [
                    "adPlacements",
                    "playerAds",
                    "adSlots",
                    "adBreakHeartbeatParams",
                ] {
                    changed |= object.remove(key).is_some();
                }
                // Older player configs encode the player response as a JSON string.
                if let Some(Value::String(response)) = object.get_mut("player_response") {
                    if let Some(next) = rewrite_json(response, site) {
                        *response = next;
                        changed = true;
                    }
                }
            }
            for child in object.values_mut() {
                changed |= prune(child, site, budget);
            }
        }
        _ => {}
    }
    changed
}
fn rewrite_json(text: &str, site: Site) -> Option<String> {
    let mut value: Value = serde_json::from_str(text).ok()?;
    let changed = prune(&mut value, site, &mut 300_000);
    changed
        .then(|| serde_json::to_string(&value).ok())
        .flatten()
}
fn find_ascii(text: &str, pattern: &str, from: usize) -> Option<usize> {
    text.as_bytes()
        .get(from..)?
        .windows(pattern.len())
        .position(|slice| slice.eq_ignore_ascii_case(pattern.as_bytes()))
        .map(|index| index + from)
}
fn skip_string(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let mut end = start + 1;
    while end < bytes.len() {
        if bytes[end] == b'\\' {
            end += 2;
        } else if bytes[end] == quote {
            return end + 1;
        } else {
            end += 1;
        }
    }
    bytes.len()
}
fn skip_regex(bytes: &[u8], start: usize) -> Option<usize> {
    let previous = bytes[..start]
        .iter()
        .rev()
        .find(|byte| !byte.is_ascii_whitespace());
    if previous.is_some_and(|byte| !b"=(:,!&|?[{;".contains(byte)) {
        return None;
    }
    let mut index = start + 1;
    let mut class = false;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'[' => {
                class = true;
                index += 1;
            }
            b']' => {
                class = false;
                index += 1;
            }
            b'/' if !class => {
                index += 1;
                while bytes.get(index).is_some_and(u8::is_ascii_alphabetic) {
                    index += 1;
                }
                return Some(index);
            }
            b'\n' | b'\r' => return None,
            _ => index += 1,
        }
    }
    None
}
// Scan actual JS assignments, skipping strings/comments. Parse the JSON value
// with serde rather than regex so nested braces and escaped text remain valid.
fn rewrite_player_assignments(script: &str) -> Option<String> {
    const ASSIGNMENTS: &[&str] = &[
        "ytInitialPlayerResponse",
        "ytInitialData",
        "window.ytInitialPlayerResponse",
        "window.ytInitialData",
        "window[\"ytInitialPlayerResponse\"]",
        "window[\"ytInitialData\"]",
        "window['ytInitialPlayerResponse']",
        "window['ytInitialData']",
    ];
    let bytes = script.as_bytes();
    let mut index = 0;
    let mut edits = Vec::new();
    while index < bytes.len() {
        match bytes[index] {
            b'\'' | b'"' | b'`' => {
                index = skip_string(bytes, index);
                continue;
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                index = script[index..]
                    .find('\n')
                    .map(|offset| index + offset + 1)
                    .unwrap_or(bytes.len());
                continue;
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = script[index + 2..]
                    .find("*/")
                    .map(|offset| index + offset + 4)
                    .unwrap_or(bytes.len());
                continue;
            }
            b'/' => {
                if let Some(end) = skip_regex(bytes, index) {
                    index = end;
                    continue;
                }
            }
            _ => {}
        }
        let mut matched = None;
        if index == 0
            || !matches!(bytes[index-1], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$')
        {
            if matches!(bytes[index], b'y' | b'w') {
                for prefix in ASSIGNMENTS {
                    if script[index..].starts_with(*prefix) {
                        matched = Some(index + prefix.len());
                        break;
                    }
                }
            }
        }
        if let Some(mut start) = matched {
            while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
                start += 1;
            }
            if bytes.get(start) == Some(&b'=') {
                start += 1;
                while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
                    start += 1;
                }
                if bytes.get(start) == Some(&b'{') {
                    let mut stream =
                        serde_json::Deserializer::from_str(&script[start..]).into_iter::<Value>();
                    if let Some(Ok(mut value)) = stream.next() {
                        let end = start + stream.byte_offset();
                        if prune(&mut value, Site::Youtube, &mut 300_000) {
                            if let Ok(replacement) = serde_json::to_string(&value) {
                                edits.push((start, end, replacement.replace('<', "\\u003c")));
                            }
                        }
                        index = end;
                        continue;
                    }
                }
            }
        }
        index += 1;
        while index < bytes.len() && !script.is_char_boundary(index) {
            index += 1;
        }
    }
    if edits.is_empty() {
        return None;
    }
    let mut result = script.to_string();
    for (start, end, replacement) in edits.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }
    Some(result)
}
fn rewrite_html(html: &str, site: Site) -> Option<String> {
    let mut edits = Vec::new();
    let mut index = 0;
    while let Some(start) = find_ascii(html, "<script", index) {
        let Some(tag_end) = html[start..].find('>').map(|offset| start + offset + 1) else {
            break;
        };
        let Some(end) = find_ascii(html, "</script", tag_end) else {
            break;
        };
        let contents = &html[tag_end..end];
        let json = html[start..tag_end]
            .to_ascii_lowercase()
            .contains("application/json");
        let replacement = if json {
            rewrite_json(contents, site).map(|json| json.replace('<', "\\u003c"))
        } else if site == Site::Youtube {
            rewrite_player_assignments(contents)
        } else {
            None
        };
        if let Some(replacement) = replacement {
            edits.push((tag_end, end, replacement));
        }
        index = end + 8;
    }
    if edits.is_empty() {
        return None;
    }
    let mut result = html.to_string();
    for (start, end, replacement) in edits.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }
    Some(result)
}
fn rewrite_body(url: &str, resource: &str, text: &str) -> Option<String> {
    if text.len() > MAX_BODY || !eligible(url, resource) {
        return None;
    }
    let site = site(url)?;
    if resource == "Document" {
        return rewrite_html(text, site);
    }
    let prefix_len = if text.starts_with("for (;;);") {
        9
    } else if text.starts_with(")]}'") {
        text.find('\n')? + 1
    } else {
        0
    };
    let content = &text[prefix_len..];
    if let Some(result) = rewrite_json(content, site) {
        return Some(format!("{}{result}", &text[..prefix_len]));
    }
    // Instagram can stream multiple GraphQL result objects as newline-delimited JSON.
    let mut changed = false;
    let result = content
        .split_inclusive('\n')
        .map(|line| {
            if let Some(result) = rewrite_json(line, site) {
                changed = true;
                format!("{result}{}", if line.ends_with('\n') { "\n" } else { "" })
            } else {
                line.to_string()
            }
        })
        .collect::<String>();
    changed.then(|| format!("{}{result}", &text[..prefix_len]))
}
pub(crate) fn selectors(url: &str) -> &'static [&'static str] {
    match site(url) {
        Some(Site::Youtube) => &[
            "ytd-ad-slot-renderer",
            "ytd-display-ad-renderer",
            "ytd-promoted-sparkles-web-renderer",
            "ytd-in-feed-ad-layout-renderer",
            "ytd-promoted-video-renderer",
            "ytd-companion-slot-renderer",
            "#player-ads",
            "#masthead-ad",
            ".ytp-ad-overlay-container",
        ],
        Some(Site::Instagram) => &[
            "article:has(a[href*=\"/ads/about/\"])",
            "article:has(a[href*=\"/about-this-ad\"])",
            "article:has([data-testid=\"sponsored-label\"])",
            "[data-auraview-sponsored=\"true\"]",
        ],
        None => &[],
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::json;
    use std::{cell::RefCell, rc::Rc};
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{HSTRING, PWSTR};

    async fn resume(view: &tauri::Webview, id: &str) {
        if crate::image_download::devtools(view, "Fetch.continueResponse", json!({"requestId":id}))
            .await
            .is_err()
        {
            let _ = crate::image_download::devtools(
                view,
                "Fetch.continueRequest",
                json!({"requestId":id}),
            )
            .await;
        }
    }
    async fn response(view: tauri::Webview, event: Value, top: String) {
        let Some(id) = event["requestId"].as_str() else {
            return;
        };
        let url = event["request"]["url"].as_str().unwrap_or_default();
        let resource = event["resourceType"].as_str().unwrap_or_default();
        if !crate::adblock::enabled()
            || !crate::adblock::public_url(&top)
            || !eligible(url, resource)
            || event["responseStatusCode"].as_u64() != Some(200)
        {
            resume(&view, id).await;
            return;
        }
        let body = crate::image_download::devtools(
            &view,
            "Fetch.getResponseBody",
            json!({"requestId":id}),
        )
        .await;
        let result = (|| -> Option<String> {
            let body = body.ok()?;
            let text = body["body"].as_str()?;
            if text.len() > MAX_BODY * 2 {
                return None;
            }
            let text = if body["base64Encoded"].as_bool() == Some(true) {
                String::from_utf8(STANDARD.decode(text).ok()?).ok()?
            } else {
                text.to_string()
            };
            rewrite_body(url, resource, &text)
        })();
        if let Some(body) = result.filter(|_| crate::adblock::enabled()) {
            let mut headers: Vec<Value> = event["responseHeaders"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|header| {
                    !matches!(
                        header["name"]
                            .as_str()
                            .unwrap_or_default()
                            .to_ascii_lowercase()
                            .as_str(),
                        "content-length"
                            | "content-encoding"
                            | "transfer-encoding"
                            | "etag"
                            | "content-md5"
                            | "cache-control"
                    )
                })
                .cloned()
                .collect();
            headers.push(json!({"name":"Content-Length", "value":body.len().to_string()}));
            headers.push(json!({"name":"Cache-Control", "value":"no-store"}));
            if crate::image_download::devtools(&view,"Fetch.fulfillRequest",json!({"requestId":id,"responseCode":200,"responseHeaders":headers,"body":STANDARD.encode(body)})).await.is_ok() { return; }
        }
        // A parsing/protocol failure must always release the original response.
        resume(&view, id).await;
    }
    pub(super) unsafe fn install(
        core: &ICoreWebView2,
        view: tauri::Webview,
        top: Rc<RefCell<String>>,
    ) -> windows_core::Result<()> {
        let events =
            core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Fetch.requestPaused"))?;
        let mut token = 0;
        events.add_DevToolsProtocolEventReceived(
            &webview2_com::DevToolsProtocolEventReceivedEventHandler::create(Box::new(
                move |_, args| {
                    if let Some(args) = args {
                        let mut raw = PWSTR::null();
                        args.ParameterObjectAsJson(&mut raw)?;
                        let text = webview2_com::take_pwstr(raw);
                        if let Ok(event) = serde_json::from_str::<Value>(&text) {
                            tauri::async_runtime::spawn(response(
                                view.clone(),
                                event,
                                top.borrow().clone(),
                            ));
                        }
                    }
                    Ok(())
                },
            )),
            &mut token,
        )?;
        let patterns: Vec<Value> = ["youtube.com", "*.youtube.com", "youtube-nocookie.com", "*.youtube-nocookie.com", "instagram.com", "*.instagram.com"].iter().flat_map(|host| {
            ["Document", "XHR", "Fetch"].iter().flat_map(move |resource| ["/*", ":*/*"].iter().map(move |suffix| json!({"urlPattern":format!("*://{host}{suffix}"),"resourceType":resource,"requestStage":"Response"})))
        }).collect();
        core.CallDevToolsProtocolMethod(
            &HSTRING::from("Fetch.enable"),
            &HSTRING::from(json!({"patterns":patterns}).to_string()),
            &webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                |result, _| {
                    if let Err(error) = result {
                        eprintln!("Site ad filtering unavailable: {error}");
                    }
                    Ok(())
                },
            )),
        )
    }
}
#[cfg(windows)]
pub(crate) unsafe fn install(
    core: &webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    view: tauri::Webview,
    top: std::rc::Rc<std::cell::RefCell<String>>,
) -> windows_core::Result<()> {
    native::install(core, view, top)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn youtube_player_and_feed_keep_video_data_and_drop_only_ad_entries() {
        let input = r#"{"videoDetails":{"videoId":"real"},"streamingData":{"formats":[{"url":"https://video.example/content"}]},"adPlacements":[{"ad":1}],"playerAds":[{}],"contents":[{"richItemRenderer":{"content":{"adSlotRenderer":{}}}},{"videoRenderer":{"videoId":"ordinary"}}],"caption":"playerAds is just text"}"#;
        let output: Value = serde_json::from_str(
            &rewrite_body("https://www.youtube.com/youtubei/v1/player", "Fetch", input).unwrap(),
        )
        .unwrap();
        assert_eq!(output["videoDetails"]["videoId"], "real");
        assert_eq!(
            output["streamingData"]["formats"][0]["url"],
            "https://video.example/content"
        );
        assert!(output.get("adPlacements").is_none());
        assert!(output.get("playerAds").is_none());
        assert_eq!(output["contents"].as_array().unwrap().len(), 1);
        assert_eq!(output["caption"], "playerAds is just text");
    }
    #[test]
    fn initial_player_assignments_are_sanitized_without_touching_script_strings_or_html() {
        let html = r#"<html><body><p>Keep < text</p><script>const example = 'ytInitialPlayerResponse={"playerAds":[1]}'; /* ytInitialData={"adSlots":[1]} */ var ytInitialPlayerResponse = {"videoDetails":{"videoId":"real"},"playerAds":[1],"title":"a < b"}; window["ytInitialData"] = {"contents":[{"adSlotRenderer":{}},{"videoRenderer":{"videoId":"keep"}}]};</script></body></html>"#;
        let output =
            rewrite_body("https://www.youtube.com/watch?v=real", "Document", html).unwrap();
        assert!(output.contains("<p>Keep < text</p>"));
        assert!(output.contains("'ytInitialPlayerResponse={\"playerAds\":[1]}'"));
        assert!(output.contains("/* ytInitialData={\"adSlots\":[1]} */"));
        assert!(output.contains(r#""videoId":"real""#));
        assert!(output.contains(r#""title":"a \u003c b"#));
        assert!(!output.contains(r#""contents":[{"adSlotRenderer"#));
    }
    #[test]
    fn player_assignment_scanning_preserves_regex_literals_and_less_than_operators() {
        let html = r#"<script>const sample=/ytInitialPlayerResponse={"playerAds":[1]}/; const less = 1 < 2; var ytInitialPlayerResponse={"videoDetails":{"title":"x < y"},"playerAds":[1]};</script>"#;
        let result =
            rewrite_body("https://www.youtube.com/watch?v=ordinary", "Document", html).unwrap();
        assert!(result.contains(r#"/ytInitialPlayerResponse={"playerAds":[1]}/"#));
        assert!(result.contains("const less = 1 < 2;"));
        assert!(result.contains(r#""title":"x \u003c y"#));
    }
    #[test]
    fn instagram_feed_removes_explicit_sponsors_and_preserves_ordinary_and_partnership_posts() {
        let input = r#"{"data":{"feed":{"edges":[{"node":{"id":"organic","is_ad":false}},{"node":{"id":"ad","ad_id":"123"}},{"node":{"id":"partner","is_paid_partnership":true}},{"node":{"id":"other","caption":"Sponsored in ordinary text"}}]}},"feed_items":[{"media_or_ad":{"id":"a","is_ad":true}},{"media_or_ad":{"id":"b","ad_id":null}}]}"#;
        let output: Value = serde_json::from_str(
            &rewrite_body("https://www.instagram.com/graphql/query", "XHR", input).unwrap(),
        )
        .unwrap();
        let edges = output["data"]["feed"]["edges"].as_array().unwrap();
        assert_eq!(edges.len(), 3);
        assert_eq!(edges[1]["node"]["id"], "partner");
        assert_eq!(output["feed_items"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn unrelated_hosts_media_and_malformed_payloads_are_untouched() {
        for url in [
            "https://youtube.com.evil.example/youtubei/v1/player",
            "https://instagram.com.evil.example/graphql/query",
            "https://example.com/",
        ] {
            assert!(rewrite_body(url, "Fetch", r#"{"playerAds":[1]}"#).is_none());
        }
        assert!(rewrite_body(
            "https://www.youtube.com/youtubei/v1/player",
            "Media",
            r#"{"playerAds":[1]}"#
        )
        .is_none());
        assert!(rewrite_body(
            "https://www.youtube.com/youtubei/v1/player",
            "Fetch",
            "not json"
        )
        .is_none());
        assert!(rewrite_body(
            "https://www.instagram.com/api/v1/feed/timeline/",
            "Fetch",
            r#"{"items":[{"id":"keep"}]}"#
        )
        .is_none());
    }
    #[test]
    fn instagram_initial_json_and_streamed_graphql_preserve_framing() {
        let html = r#"<script type="application/json" data-sjs>{"require":[["ScheduledServerJS","handle",{"items":[{"is_ad":true},{"id":"keep"}]}]]}</script>"#;
        let output = rewrite_body("https://www.instagram.com/", "Document", html).unwrap();
        assert!(!output.contains("is_ad"));
        assert!(output.contains("keep"));
        let stream =
            "for (;;);{\"items\":[{\"is_ad\":true},{\"id\":\"keep\"}]}\n{\"status\":\"ok\"}\n";
        let result =
            rewrite_body("https://www.instagram.com/graphql/query", "Fetch", stream).unwrap();
        assert!(result.starts_with("for (;;);"));
        assert!(result.ends_with("{\"status\":\"ok\"}\n"));
    }
}
