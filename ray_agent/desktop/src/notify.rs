//! 任务完成通知：宿主订阅核心的会话列表流，状态从活动转为完成、失败或等待用户时，若用户不在该会话才发系统通知。
//!
//! 「不在该会话」= 窗口未聚焦，或界面当前没有停在这个会话上（界面经 `set_viewed_session` 报告）。
//! 点击通知聚焦窗口并请界面打开该会话（`rayagent://open-session`）。
//! 订阅由宿主完成而不占用界面的连接：同源 HTTP/1.1 连接数有限，界面自己的会话列表流只覆盖当前范围。
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::preferences::PreferenceStore;
use crate::sidecar::{CoreHost, InstanceEndpoint};

/// 界面请求打开会话的事件；载荷为会话 ID 字符串。
pub const OPEN_SESSION_EVENT: &str = "rayagent://open-session";
const SESSION_ID_KEY: &str = "session_id";
/// 没有核心连接时的检查间隔，以及断线后重新订阅前的等待。
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const RETRY_INTERVAL: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 列表流每页取的会话数；与界面列表的最大页一致，活动会话通常排在最前。
const LIST_LIMIT: u32 = 100;

#[derive(Default)]
pub struct Notifier {
    viewed: Mutex<Option<String>>,
    focused: AtomicBool,
    tracker: Mutex<Tracker>,
}

/// 上一次看到的各会话状态，只属于同一个核心实例；核心重启后整体清空，不把启动扫描的中断当成完成。
#[derive(Default)]
struct Tracker {
    instance: String,
    statuses: HashMap<String, String>,
}

/// 注册点击处理并启动后台订阅。在 setup 中调用一次。
pub fn start(app: &AppHandle) {
    let handle = app.clone();
    app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        let session = performed
            .notification()
            .and_then(|notification| notification.extra().get(SESSION_ID_KEY))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(session) = session {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = handle.emit(OPEN_SESSION_EVENT, session);
        }
    }).ok();
    let handle = app.clone();
    thread::spawn(move || supervise(handle));
}

/// 界面报告当前停留的会话 ID（会话页）；离开会话页时传 null。只影响是否跳过通知，不改变任何数据。
#[tauri::command]
pub fn set_viewed_session(app: AppHandle, session_id: Option<String>) -> Result<(), String> {
    if let Some(id) = &session_id {
        if !valid_session_id(id) {
            return Err("无效的会话标识".into());
        }
    }
    set_viewed(&app, session_id);
    Ok(())
}

/// 插件在桌面端恒报告已授权，宿主读不到 macOS 的通知开关，因此如实返回 unsupported。
#[tauri::command]
pub fn notification_permission() -> &'static str {
    "unsupported"
}

fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn set_focused(app: &AppHandle, focused: bool) {
    app.state::<Notifier>().focused.store(focused, Ordering::SeqCst);
}

pub fn set_viewed(app: &AppHandle, session: Option<String>) {
    *app.state::<Notifier>().viewed.lock().unwrap() = session;
}

/// 启动时窗口可能已经聚焦、不会再收到事件，因此读取一次当前状态。
pub fn sync_focus(app: &AppHandle) {
    let focused = app.get_webview_window("main").and_then(|window| window.is_focused().ok()).unwrap_or(false);
    set_focused(app, focused);
}

/// 保持对当前核心实例的订阅：实例身份变化（重启）时为新实例启动一条订阅。
fn supervise(app: AppHandle) {
    let mut following: Option<String> = None;
    loop {
        thread::sleep(POLL_INTERVAL);
        let Some(endpoint) = app.state::<CoreHost>().instance_endpoint() else { continue };
        if following.as_deref() == Some(endpoint.instance_id.as_str()) {
            continue;
        }
        following = Some(endpoint.instance_id.clone());
        let handle = app.clone();
        thread::spawn(move || follow(handle, endpoint));
    }
}

fn still_current(app: &AppHandle, instance_id: &str) -> bool {
    app.state::<CoreHost>().instance_endpoint().is_some_and(|endpoint| endpoint.instance_id == instance_id)
}

/// 订阅直到核心实例变化；断线后按间隔重连。
fn follow(app: AppHandle, endpoint: InstanceEndpoint) {
    while still_current(&app, &endpoint.instance_id) {
        if let Err(error) = read_stream(&app, &endpoint) {
            eprintln!("[host] 会话状态订阅中断，稍后重连：{error}");
        }
        thread::sleep(RETRY_INTERVAL);
    }
}

fn read_stream(app: &AppHandle, endpoint: &InstanceEndpoint) -> Result<(), String> {
    let response = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .build()
        .post(&format!("http://127.0.0.1:{}/api/sessions/stream?limit={LIST_LIMIT}", endpoint.port))
        .set("Authorization", &format!("Bearer {}", endpoint.token))
        .set("Accept", "text/event-stream")
        .send_json(json!({}))
        .map_err(|error| error.to_string())?;
    let reader = BufReader::new(response.into_reader());
    let mut event = String::new();
    let mut data = String::new();
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.is_empty() {
            if event == "sessions" {
                handle_sessions(app, &endpoint.instance_id, &data);
            }
            event.clear();
            data.clear();
        } else if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_owned();
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.trim_start());
        }
    }
    Ok(())
}

/// 与界面 `ListSessionResponse` 对应；只取判断需要的字段。
fn handle_sessions(app: &AppHandle, instance_id: &str, payload: &str) {
    let Ok(body) = serde_json::from_str::<Value>(payload) else { return };
    let Some(items) = body["sessions"].as_array() else { return };
    let finished = {
        let notifier = app.state::<Notifier>();
        let mut tracker = notifier.tracker.lock().unwrap();
        if tracker.instance != instance_id {
            tracker.instance = instance_id.to_owned();
            tracker.statuses.clear();
        }
        let mut finished = Vec::new();
        for item in items {
            let (Some(id), Some(status)) = (item["session_id"].as_str(), item["status"].as_str()) else { continue };
            let previous = tracker.statuses.insert(id.to_owned(), status.to_owned());
            if let Some(previous) = previous {
                if is_active(&previous) && notifies(status) && previous != status {
                    finished.push((id.to_owned(), item["title"].as_str().unwrap_or_default().to_owned(), status.to_owned()));
                }
            }
        }
        finished
    };
    for (session, title, status) in finished {
        if !app.state::<PreferenceStore>().get().notify_on_finish || suppressed(app, &session) {
            continue;
        }
        send(app, &session, &title, &status);
    }
}

fn is_active(status: &str) -> bool {
    matches!(status, "pending" | "running" | "waiting")
}

/// 只有需要用户介入或已有结果的状态才通知；用户停止（cancelled）与退出导致的中断（interrupted）不通知。
fn notifies(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "waiting")
}

/// 用户正看着这个会话（窗口聚焦且界面停在该会话）时不通知。
fn suppressed(app: &AppHandle, session: &str) -> bool {
    let notifier = app.state::<Notifier>();
    let viewed = notifier.viewed.lock().unwrap();
    notifier.focused.load(Ordering::SeqCst) && viewed.as_deref() == Some(session)
}

fn send(app: &AppHandle, session: &str, title: &str, status: &str) {
    let outcome = match status {
        "completed" => "已完成",
        "failed" => "运行失败",
        _ => "需要你回复或审批",
    };
    let name = if title.trim().is_empty() { "未命名对话" } else { title };
    let result = app
        .notification()
        .builder()
        .title("RayAgent")
        .body(format!("{name}：{outcome}"))
        .extra(SESSION_ID_KEY, json!(session))
        .show();
    if let Err(error) = result {
        eprintln!("[host] 无法发送通知：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_cannot_carry_paths_or_queries() {
        assert!(valid_session_id("8e8b41c7cc384edf8dd54e498b5dfaf4"));
        for bad in ["", "a/b", "a?b", "a b", "%2e%2e", &"a".repeat(129)] {
            assert!(!valid_session_id(bad), "{bad}");
        }
    }

    #[test]
    fn only_active_to_outcome_transitions_notify() {
        for status in ["pending", "running", "waiting"] {
            assert!(is_active(status));
        }
        for status in ["completed", "failed", "waiting"] {
            assert!(notifies(status));
        }
        for status in ["cancelled", "interrupted", "pending"] {
            assert!(!notifies(status));
        }
        assert!(!is_active("completed"));
    }
}
