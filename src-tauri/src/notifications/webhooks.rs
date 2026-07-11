//! Webhook dispatch — the single engine behind both the GUI's `notifications_dispatch` command
//! and the headless scheduler runner. Replaces the old TS dispatcher (lib/notifications) and its
//! hand-synced Rust port (scheduler/notify.rs); payload shapes stay byte-compatible with what
//! the TS dispatcher sent, so existing webhook consumers see no change.

use serde_json::{json, Value};

use super::catalog::{self, EventMeta};
use super::targets::{self, NotificationTarget};
use crate::scheduler::history;
use crate::scheduler::storeread::AppDirs;

fn discord_color(severity: &str) -> u32 {
    match severity {
        "success" => 0x2ecc71,
        "error" => 0xe74c3c,
        _ => 0x3498db,
    }
}

fn escape_telegram_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

struct OutboundRequest {
    url: String,
    body: Value,
    event_header: bool,
}

fn build_request(
    target: &NotificationTarget,
    event: &EventMeta,
    title: &str,
    body: &str,
    data: &Value,
    timestamp: &str,
) -> Result<OutboundRequest, String> {
    match target.provider.as_str() {
        "slack" => Ok(OutboundRequest {
            url: target.url.clone(),
            body: json!({ "text": format!("*{}*\n{}", title, body) }),
            event_header: false,
        }),
        "discord" => Ok(OutboundRequest {
            url: target.url.clone(),
            body: json!({
                "username": "Rclone UI",
                "embeds": [{
                    "title": title,
                    "description": body,
                    "color": discord_color(event.severity),
                    "timestamp": timestamp,
                }],
            }),
            event_header: false,
        }),
        "telegram" => {
            // Lift every query param the user configured (chat_id, message_thread_id, …) into
            // the JSON body — the Bot API doesn't reliably merge query params with a JSON body.
            let parsed = reqwest::Url::parse(&target.url)
                .map_err(|e| format!("invalid telegram url: {}", e))?;
            let mut payload = serde_json::Map::new();
            for (key, value) in parsed.query_pairs() {
                payload.insert(key.into_owned(), Value::String(value.into_owned()));
            }
            payload.insert(
                "text".to_string(),
                Value::String(format!(
                    "<b>{}</b>\n{}",
                    escape_telegram_html(title),
                    escape_telegram_html(body)
                )),
            );
            payload.insert("parse_mode".to_string(), Value::String("HTML".to_string()));

            let mut base = parsed.clone();
            base.set_query(None);
            Ok(OutboundRequest {
                url: base.to_string(),
                body: Value::Object(payload),
                event_header: false,
            })
        }
        _ => Ok(OutboundRequest {
            url: target.url.clone(),
            body: json!({
                "source": "rclone-ui",
                "version": env!("CARGO_PKG_VERSION"),
                "event": event.id,
                "label": event.label,
                "severity": event.severity,
                "title": title,
                "body": body,
                "timestamp": timestamp,
                "data": data,
            }),
            event_header: true,
        }),
    }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

/// One retry after 2s, only on network error or 5xx — 4xx means the endpoint rejected the
/// request (bad URL, revoked webhook) and retrying only hammers it.
fn send_once(
    client: &reqwest::Client,
    request: &OutboundRequest,
    event_id: &str,
) -> Result<(), String> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let result = tauri::async_runtime::block_on(async {
            let mut req = client.post(&request.url).json(&request.body);
            if request.event_header {
                req = req.header("X-RcloneUI-Event", event_id);
            }
            req.send().await
        });

        match result {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                let status = response.status().as_u16();
                if status >= 500 && attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
                return Err(format!("Webhook responded with status {}", status));
            }
            Err(e) => {
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
                return Err(format!("{}", e));
            }
        }
    }
}

/// Sends `event_id` to every enabled target subscribed to it and records lastSentAt/lastError
/// per target. Never fails the caller — delivery errors come back as log lines. Targets are
/// read at fire time; the store lock is NOT held during the sends (up to ~17s each).
pub fn dispatch(
    dirs: &AppDirs,
    client: &reqwest::Client,
    event_id: &str,
    title: &str,
    body: &str,
    data: Value,
) -> Vec<String> {
    let Some(event) = catalog::find(event_id) else {
        return vec![format!("unknown notification event '{}'", event_id)];
    };

    let targets = match targets::load(dirs) {
        Ok(t) => t,
        Err(e) => return vec![format!("failed to load notification targets: {}", e)],
    };

    let timestamp = history::now_iso();
    let mut log_lines = Vec::new();
    let mut outcomes: Vec<(String, Option<String>)> = Vec::new();

    for target in &targets {
        if !target.is_enabled || !target.events.iter().any(|e| e == event_id) {
            continue;
        }

        let request = match build_request(target, event, title, body, &data, &timestamp) {
            Ok(r) => r,
            Err(e) => {
                log_lines.push(format!("webhook build failed ({}): {}", target.provider, e));
                outcomes.push((target.id.clone(), Some(e)));
                continue;
            }
        };

        match send_once(client, &request, event_id) {
            Ok(()) => outcomes.push((target.id.clone(), None)),
            Err(e) => {
                log_lines.push(format!(
                    "webhook delivery failed ({}): {}",
                    target.provider, e
                ));
                outcomes.push((target.id.clone(), Some(e)));
            }
        }
    }

    targets::record_outcomes(dirs, &outcomes);
    log_lines
}

/// Sends the synthetic test payload to one target — which may be unsaved drawer values (no
/// `target_id`). Propagates the delivery error so the UI can surface it; records the outcome
/// only when the target already exists.
pub fn send_test(
    dirs: &AppDirs,
    provider: &str,
    url: &str,
    target_id: Option<&str>,
    name: Option<&str>,
) -> Result<(), String> {
    let event = &catalog::TEST_EVENT;
    let body = match name {
        Some(n) if !n.is_empty() => {
            format!("This is a test notification from Rclone UI for \"{}\".", n)
        }
        _ => "This is a test notification from Rclone UI.".to_string(),
    };
    // A throwaway shell: build_request only reads provider + url from the target.
    let probe = NotificationTarget {
        id: target_id.unwrap_or_default().to_string(),
        provider: provider.to_string(),
        name: name.unwrap_or_default().to_string(),
        url: url.to_string(),
        is_enabled: true,
        events: Vec::new(),
        created_at: 0,
        last_sent_at: None,
        last_error: None,
    };
    let timestamp = history::now_iso();
    let request = build_request(&probe, event, "Test notification", &body, &Value::Null, &timestamp)?;

    let client = http_client();
    let result = send_once(&client, &request, event.id);
    if let Some(id) = target_id.filter(|id| !id.is_empty()) {
        targets::record_outcomes(dirs, &[(id.to_string(), result.clone().err())]);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dirs(tag: &str) -> AppDirs {
        let root = std::env::temp_dir().join(format!("rcloneui-webhooks-test-{}", tag));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        AppDirs {
            app_data: root.clone(),
            app_local_data: root,
        }
    }

    /// Minimal one-shot HTTP receiver: accepts a single request, captures head+body, replies 200.
    fn local_receiver() -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/hook", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 16384];
            let mut captured = Vec::new();
            // Read until the body announced by Content-Length is complete.
            loop {
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                captured.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&captured);
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let content_length = text
                        .lines()
                        .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    if captured.len() >= head_end + 4 + content_length {
                        break;
                    }
                }
            }
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
            let _ = tx.send(String::from_utf8_lossy(&captured).into_owned());
        });
        (url, rx)
    }

    /// The full runner-side chain: load targets → filter by event → POST with header → record
    /// lastSentAt/lastError back into targets.json (the gap the TS dispatcher had for runs
    /// fired while the app was closed).
    #[test]
    fn dispatch_posts_and_records_outcomes_end_to_end() {
        let dirs = test_dirs("dispatch");
        let (url, rx) = local_receiver();

        let subscribed = targets::add(
            &dirs,
            targets::NewTarget {
                provider: "webhook".into(),
                name: "Receiver".into(),
                url,
                is_enabled: true,
                events: vec!["schedule.completed".into()],
            },
        )
        .unwrap();
        // Not subscribed to this event — must not be contacted or get an outcome.
        let unsubscribed = targets::add(
            &dirs,
            targets::NewTarget {
                provider: "webhook".into(),
                name: "Other".into(),
                url: "http://127.0.0.1:9/never".into(),
                is_enabled: true,
                events: vec!["job.failed".into()],
            },
        )
        .unwrap();

        let client = http_client();
        let lines = dispatch(
            &dirs,
            &client,
            "schedule.completed",
            "Scheduled task completed",
            "backup completed successfully",
            json!({ "scheduleId": "s1" }),
        );
        assert!(lines.is_empty(), "no delivery errors expected: {:?}", lines);

        let raw = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert!(raw.contains("POST /hook"));
        assert!(raw.contains("x-rcloneui-event: schedule.completed") || raw.contains("X-RcloneUI-Event: schedule.completed"));
        let body_json: Value =
            serde_json::from_str(raw.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body_json["event"], "schedule.completed");
        assert_eq!(body_json["severity"], "success");
        assert_eq!(body_json["data"]["scheduleId"], "s1");

        let after = targets::load(&dirs).unwrap();
        let hit = after.iter().find(|t| t.id == subscribed.id).unwrap();
        assert!(hit.last_sent_at.is_some());
        assert_eq!(hit.last_error, None);
        let missed = after.iter().find(|t| t.id == unsubscribed.id).unwrap();
        assert_eq!(missed.last_sent_at, None, "unsubscribed target untouched");

        let _ = std::fs::remove_dir_all(&dirs.app_data);
    }

    /// An unreachable endpoint surfaces as a log line and a recorded lastError — never a failure
    /// of the dispatch call itself.
    #[test]
    fn dispatch_records_last_error_on_unreachable_endpoint() {
        let dirs = test_dirs("dispatch-err");
        // Reserve a port and close it immediately so the connection is refused fast.
        let dead_url = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}/hook", l.local_addr().unwrap())
        };
        let added = targets::add(
            &dirs,
            targets::NewTarget {
                provider: "webhook".into(),
                name: "Dead".into(),
                url: dead_url,
                is_enabled: true,
                events: vec!["schedule.failed".into()],
            },
        )
        .unwrap();

        let client = http_client();
        let lines = dispatch(&dirs, &client, "schedule.failed", "T", "B", Value::Null);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("webhook delivery failed"));

        let after = targets::load(&dirs).unwrap();
        let t = after.iter().find(|t| t.id == added.id).unwrap();
        assert!(t.last_sent_at.is_some());
        assert!(t.last_error.is_some());

        let _ = std::fs::remove_dir_all(&dirs.app_data);
    }

    fn target(provider: &str, url: &str) -> NotificationTarget {
        NotificationTarget {
            id: "t1".into(),
            provider: provider.into(),
            name: "T".into(),
            url: url.into(),
            is_enabled: true,
            events: vec![],
            created_at: 0,
            last_sent_at: None,
            last_error: None,
        }
    }

    #[test]
    fn payloads_stay_byte_compatible_with_the_ts_dispatcher() {
        let event = catalog::find("schedule.failed").unwrap();
        let ts = "2026-01-01T00:00:00.000Z";

        let slack = build_request(
            &target("slack", "https://hooks.slack.com/services/T/B/x"),
            event,
            "Scheduled task failed",
            "job failed: boom",
            &Value::Null,
            ts,
        )
        .unwrap();
        assert_eq!(
            slack.body,
            json!({ "text": "*Scheduled task failed*\njob failed: boom" })
        );
        assert!(!slack.event_header);

        let discord = build_request(
            &target("discord", "https://discord.com/api/webhooks/1/x"),
            event,
            "T",
            "B",
            &Value::Null,
            ts,
        )
        .unwrap();
        assert_eq!(discord.body["username"], "Rclone UI");
        assert_eq!(discord.body["embeds"][0]["color"], 0xe74c3c);

        let telegram = build_request(
            &target(
                "telegram",
                "https://api.telegram.org/bot1:x/sendMessage?chat_id=-100123",
            ),
            event,
            "A <b>",
            "B & C",
            &Value::Null,
            ts,
        )
        .unwrap();
        assert_eq!(telegram.url, "https://api.telegram.org/bot1:x/sendMessage");
        assert_eq!(telegram.body["chat_id"], "-100123");
        assert_eq!(telegram.body["parse_mode"], "HTML");
        assert_eq!(telegram.body["text"], "<b>A &lt;b&gt;</b>\nB &amp; C");

        let generic = build_request(
            &target("webhook", "https://example.com/hook"),
            event,
            "T",
            "B",
            &json!({"scheduleId": "s1"}),
            ts,
        )
        .unwrap();
        assert!(generic.event_header);
        assert_eq!(generic.body["source"], "rclone-ui");
        assert_eq!(generic.body["event"], "schedule.failed");
        assert_eq!(generic.body["label"], "Scheduled task failed");
        assert_eq!(generic.body["severity"], "error");
        assert_eq!(generic.body["timestamp"], ts);
        assert_eq!(generic.body["data"]["scheduleId"], "s1");
    }
}
