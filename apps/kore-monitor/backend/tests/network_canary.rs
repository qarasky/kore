//! False-alarm rules: the monitor's own connectivity loss never pages per
//! site (and a real outage still does), push monitors get a grace period,
//! group monitors stay silent, and failures carry their root cause.

mod common;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::Json;
use axum::http::StatusCode;
use axum::routing::post;
use common::{Harness, get_json, harness, harness_with_canary, request, send};
use flatline_backend::heartbeats::{self, DOWN, PENDING};
use flatline_backend::monitors::canary::{Canary, Prober};
use serde_json::{Value, json};

/// Outside probes the test flips by hand.
struct Uplink(AtomicBool);

impl Uplink {
    fn new(up: bool) -> Arc<Self> {
        Arc::new(Self(AtomicBool::new(up)))
    }

    fn set(&self, up: bool) {
        self.0.store(up, Ordering::SeqCst);
    }
}

impl Prober for Uplink {
    fn probe(&self) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async move { self.0.load(Ordering::SeqCst) })
    }
}

/// Short verdict lifetimes so recovery is noticed within a test's patience.
fn canary(uplink: &Arc<Uplink>) -> Arc<Canary> {
    Canary::with_prober_and_ttls(
        uplink.clone(),
        Duration::from_millis(20),
        Duration::from_millis(100),
    )
}

async fn spawn_server(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

async fn closed_port_url() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{addr}/")
}

/// A fake Telegram API; returns the notification row id and the texts it
/// has received.
async fn telegram(h: &Harness) -> (i64, Arc<Mutex<Vec<String>>>) {
    let texts: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stub = {
        let texts = Arc::clone(&texts);
        Router::new().route(
            "/bot{token}/sendMessage",
            post(move |Json(body): Json<Value>| {
                let texts = Arc::clone(&texts);
                async move {
                    let text = body["text"].as_str().unwrap_or_default().to_string();
                    texts.lock().unwrap().push(text);
                    Json(json!({ "ok": true, "result": true }))
                }
            }),
        )
    };
    let base = spawn_server(stub).await;
    let config = json!({
        "telegramServerUrl": base,
        "telegramBotToken": "TEST:TOKEN",
        "telegramChatID": "-100123",
    });
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO notifications (name, type, config) VALUES ('alerts', 'telegram', ?) RETURNING id",
    )
    .bind(config.to_string())
    .fetch_one(&h.pool)
    .await
    .unwrap();
    (id, texts)
}

/// Insert a monitor straight into the database (sub-20 s intervals the API
/// would refuse) and link it to the notification.
async fn monitor(h: &Harness, notification: i64, kind: &str, url: Option<&str>) -> i64 {
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO monitors (name, type, url, interval, retry_interval, timeout, maxretries)
         VALUES (?, ?, ?, 1, 1, 1, 0) RETURNING id",
    )
    .bind(format!("{kind}-{}", url.unwrap_or("none")))
    .bind(kind)
    .bind(url)
    .fetch_one(&h.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO monitor_notifications (monitor_id, notification_id) VALUES (?, ?)")
        .bind(id)
        .bind(notification)
        .execute(&h.pool)
        .await
        .unwrap();
    id
}

async fn latest(h: &Harness, id: i64) -> Option<heartbeats::Beat> {
    heartbeats::latest(&h.pool, id).await.unwrap()
}

async fn wait_until<F, Fut>(what: &str, seconds: u64, mut ready: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    for _ in 0..seconds * 20 {
        if ready().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for {what}");
}

fn texts_with(texts: &Arc<Mutex<Vec<String>>>, needle: &str) -> usize {
    texts
        .lock()
        .unwrap()
        .iter()
        .filter(|text| text.contains(needle))
        .count()
}

#[tokio::test]
async fn offline_canary_holds_back_down_alerts_and_announces_once() {
    let uplink = Uplink::new(false);
    let h = harness_with_canary(canary(&uplink)).await;
    let (notification, texts) = telegram(&h).await;
    let dead = monitor(&h, notification, "http", Some(&closed_port_url().await)).await;
    h.state.engine.start_all().await;

    // The check fails every second, but the uplink is the suspect.
    wait_until("the offline notice", 5, || async {
        texts_with(&texts, "OFFLINE") > 0
    })
    .await;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let beat = latest(&h, dead).await.expect("checks are still recorded");
    assert_eq!(beat.status, PENDING, "not DOWN while we are offline");
    assert!(
        beat.msg.as_deref().unwrap_or_default().contains("offline"),
        "{:?}",
        beat.msg
    );
    assert_eq!(texts_with(&texts, "DOWN"), 0, "no site alert: {texts:?}");
    assert_eq!(texts_with(&texts, "OFFLINE"), 1, "one notice: {texts:?}");

    // The state is visible to the UI and to automation.
    let (status, json) = send(&h.app, request("GET", "/healthz", None, None)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "our outage must not fail the container"
    );
    assert_eq!(json["network"]["online"], false, "{json}");
    let (_, json) = get_json(&h.app, "/api/v1/health", &h.token).await;
    assert_eq!(json["health"]["network"]["online"], false, "{json}");

    // Back online: one restored notice, and the site really is down, so the
    // alert it deserves now goes out.
    uplink.set(true);
    wait_until("the restored notice", 5, || async {
        texts_with(&texts, "ONLINE") > 0
    })
    .await;
    wait_until("the real alert", 5, || async {
        texts_with(&texts, "DOWN") > 0
    })
    .await;
    assert_eq!(texts_with(&texts, "ONLINE"), 1, "one notice: {texts:?}");
    assert_eq!(latest(&h, dead).await.unwrap().status, DOWN);
    let (_, json) = get_json(&h.app, "/api/v1/health", &h.token).await;
    assert_eq!(json["health"]["network"]["online"], true, "{json}");
    h.state.engine.stop_checks().await;
}

#[tokio::test]
async fn online_canary_still_pages_for_a_real_outage() {
    let uplink = Uplink::new(true);
    let h = harness_with_canary(canary(&uplink)).await;
    let (notification, texts) = telegram(&h).await;
    let dead = monitor(&h, notification, "http", Some(&closed_port_url().await)).await;
    h.state.engine.start_all().await;

    wait_until("the DOWN alert", 5, || async {
        texts_with(&texts, "DOWN") > 0
    })
    .await;
    assert_eq!(latest(&h, dead).await.unwrap().status, DOWN);
    assert_eq!(texts_with(&texts, "OFFLINE"), 0, "{texts:?}");
    h.state.engine.stop_checks().await;
}

#[tokio::test]
async fn a_failure_that_straddles_the_recovery_is_still_ours() {
    // The check starts while the uplink is down and fails after it is back:
    // the canary is online by then, but the outage overlapped the check.
    let uplink = Uplink::new(true);
    let h = harness_with_canary(canary(&uplink)).await;
    let (notification, texts) = telegram(&h).await;

    // A target that accepts the connection and answers only after the
    // canary has been through an outage.
    let slow = spawn_server(Router::new().route(
        "/",
        axum::routing::get(|| async {
            tokio::time::sleep(Duration::from_millis(900)).await;
            StatusCode::INTERNAL_SERVER_ERROR
        }),
    ))
    .await;
    let id = monitor(&h, notification, "http", Some(&slow)).await;
    h.state.engine.start_all().await;

    tokio::time::sleep(Duration::from_millis(200)).await;
    uplink.set(false);
    // Something else fails and sees the outage.
    h.state.engine.canary().check().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    uplink.set(true);
    tokio::time::sleep(Duration::from_millis(150)).await;
    h.state.engine.canary().check().await;

    // The slow check began before the outage ended and now answers 500.
    wait_until("the first beat", 5, || async {
        latest(&h, id).await.is_some()
    })
    .await;
    let first = heartbeats::latest(&h.pool, id).await.unwrap().unwrap();
    assert_ne!(
        first.status, DOWN,
        "a check that overlapped the outage is not a site failure: {:?}",
        first.msg
    );
    assert_eq!(texts_with(&texts, "DOWN"), 0, "{texts:?}");
    h.state.engine.stop_checks().await;
}

#[tokio::test]
async fn push_monitors_get_a_grace_period_after_an_outage() {
    let uplink = Uplink::new(false);
    let h = harness_with_canary(canary(&uplink)).await;
    let (notification, texts) = telegram(&h).await;
    // interval 2 s + one 1 s retry = a 3 s grace after recovery.
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO monitors (name, type, interval, retry_interval, maxretries)
         VALUES ('agent', 'push', 2, 1, 1) RETURNING id",
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO monitor_notifications (monitor_id, notification_id) VALUES (?, ?)")
        .bind(id)
        .bind(notification)
        .execute(&h.pool)
        .await
        .unwrap();
    // The agent's last push, long before the outage was noticed.
    let stale = (chrono::Utc::now() - chrono::Duration::seconds(60))
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string();
    sqlx::query("INSERT INTO heartbeats (monitor_id, time, status) VALUES (?, ?, 1)")
        .bind(id)
        .bind(&stale)
        .execute(&h.pool)
        .await
        .unwrap();
    let timeouts = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM heartbeats WHERE monitor_id = ? AND msg = ?",
        )
        .bind(id)
        .bind(flatline_backend::monitors::engine::PUSH_TIMEOUT_MSG)
        .fetch_one(&h.pool)
        .await
        .unwrap()
    };
    h.state.engine.start_all().await;

    // Silent while we are offline: the agent cannot reach us either.
    tokio::time::sleep(Duration::from_millis(3500)).await;
    assert_eq!(timeouts().await, 0, "no 'No heartbeat' during the outage");

    uplink.set(true);
    wait_until("the restored notice", 5, || async {
        texts_with(&texts, "ONLINE") > 0
    })
    .await;
    // Agents reconnect within an interval; the watcher keeps waiting.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(timeouts().await, 0, "still inside the grace period");

    // A genuinely dead agent is reported once the grace is over.
    wait_until("the timeout after the grace", 8, || async {
        timeouts().await > 0
    })
    .await;
    h.state.engine.stop_checks().await;
}

#[tokio::test]
async fn group_monitors_do_not_alert_but_their_children_do() {
    let uplink = Uplink::new(true);
    let h = harness_with_canary(canary(&uplink)).await;
    let (notification, texts) = telegram(&h).await;
    let group = monitor(&h, notification, "group", None).await;
    let child = {
        let (id,): (i64,) = sqlx::query_as(
            "INSERT INTO monitors (name, type, url, interval, retry_interval, timeout, maxretries, parent)
             VALUES ('child-site', 'http', ?, 1, 1, 1, 0, ?) RETURNING id",
        )
        .bind(closed_port_url().await)
        .bind(group)
        .fetch_one(&h.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO monitor_notifications (monitor_id, notification_id) VALUES (?, ?)",
        )
        .bind(id)
        .bind(notification)
        .execute(&h.pool)
        .await
        .unwrap();
        id
    };
    h.state.engine.start_all().await;

    wait_until("the child's alert", 5, || async {
        texts_with(&texts, "child-site") > 0
    })
    .await;
    // The group itself records DOWN (the board shows it) but never pages.
    wait_until("the group's DOWN beat", 5, || async {
        latest(&h, group)
            .await
            .is_some_and(|beat| beat.status == DOWN)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(
        texts_with(&texts, "[group]"),
        0,
        "groups are silent: {:?}",
        texts.lock().unwrap()
    );
    assert_eq!(texts_with(&texts, "DOWN"), 1, "only the child pages");
    let _ = child;
    h.state.engine.stop_checks().await;
}

#[tokio::test]
async fn http_failures_name_the_root_cause() {
    let h = harness().await;
    let (notification, _texts) = telegram(&h).await;
    let dead = monitor(&h, notification, "http", Some(&closed_port_url().await)).await;
    h.state.engine.start_all().await;

    wait_until("a DOWN beat", 5, || async {
        latest(&h, dead)
            .await
            .is_some_and(|beat| beat.status == DOWN)
    })
    .await;
    let message = latest(&h, dead).await.unwrap().msg.unwrap();
    assert!(
        message.contains("Connection refused"),
        "the OS error is in the message: {message}"
    );
    assert!(
        !message.contains("127.0.0.1"),
        "the URL is already in the alert's target line: {message}"
    );
    h.state.engine.stop_checks().await;
}
