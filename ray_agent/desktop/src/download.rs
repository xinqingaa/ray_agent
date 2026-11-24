//! 原生 WebView 下载接管：先落到本进程私有暂存目录，完成时异步弹出系统保存对话框并原子写入目标路径。
use std::collections::HashMap;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::platform;

pub const DOWNLOAD_RESULT_EVENT: &str = "rayagent://download-result";
const MAX_FILENAME_BYTES: usize = 200;

#[derive(Clone, Debug, Serialize)]
pub struct DownloadResultPayload {
    pub ok: bool,
    pub filename: Option<String>,
    pub message: Option<String>,
}

type PendingDownloads = Arc<Mutex<HashMap<PathBuf, String>>>;

pub fn staging_dir() -> PathBuf {
    std::env::temp_dir().join(format!("rayagent-downloads-{}", std::process::id()))
}

pub fn cleanup_staging_dir() {
    let _ = fs::remove_dir_all(staging_dir());
}

fn ensure_staging_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建下载暂存目录：{e}"))?;
    let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    Ok(())
}

pub fn is_allowed_download_url(url: &str) -> bool {
    let scheme = url
        .split_once(':')
        .map(|(head, _)| head.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(scheme.as_str(), "http" | "https" | "blob" | "data")
}

fn truncate_utf8(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

pub fn sanitize_filename(raw: &str) -> String {
    let last = raw.replace('\\', "/");
    let segment = last.rsplit('/').next().unwrap_or("");
    let cleaned: String = segment
        .chars()
        .filter(|ch| *ch >= ' ' && *ch != '\x7f')
        .collect::<String>()
        .trim()
        .to_owned();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return "download".to_owned();
    }
    if cleaned.len() <= MAX_FILENAME_BYTES {
        return cleaned;
    }
    if let Some(dot) = cleaned.rfind('.') {
        let ext = &cleaned[dot..];
        if dot > 0 && ext.len() <= 24 && ext.len() < MAX_FILENAME_BYTES {
            let stem = truncate_utf8(&cleaned[..dot], MAX_FILENAME_BYTES - ext.len());
            if !stem.is_empty() {
                return format!("{stem}{ext}");
            }
        }
    }
    let truncated = truncate_utf8(&cleaned, MAX_FILENAME_BYTES).trim();
    if truncated.is_empty() || truncated == "." || truncated == ".." {
        "download".to_owned()
    } else {
        truncated.to_owned()
    }
}

pub fn extract_suggested_filename(url: &str, destination: &Path) -> String {
    if let Some(name) = destination.file_name().and_then(|n| n.to_str()) {
        let candidate = sanitize_filename(name);
        if candidate != "download" && !candidate.eq_ignore_ascii_case("unknown") {
            return candidate;
        }
    }
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let without_frag = url.split('#').next().unwrap_or(url);
        let without_query = without_frag.split('?').next().unwrap_or(without_frag);
        if let Some(last) = without_query.rsplit('/').next() {
            if !last.is_empty() {
                let decoded = platform::percent_decode(last);
                let candidate = sanitize_filename(&decoded);
                if candidate != "download" {
                    return candidate;
                }
            }
        }
    }
    "download".to_owned()
}

pub fn stage_temp_path(dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|e| format!("无法生成临时文件名：{e}"))?;
    let hex: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let safe = sanitize_filename(filename);
    Ok(dir.join(format!("{hex}-{safe}")))
}

pub fn finalize_staged_download(temp_path: &Path, target: Option<&Path>) -> Result<Option<String>, String> {
    let result = match target {
        None => Ok(None),
        Some(target_path) => {
            let mut src = fs::File::open(temp_path).map_err(|e| format!("读取下载文件失败：{e}"))?;
            platform::write_atomically(target_path, |dest| io::copy(&mut src, dest).map(|_| ()))?;
            let saved_name = target_path
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_owned)
                .unwrap_or_else(|| target_path.display().to_string());
            Ok(Some(saved_name))
        }
    };
    let _ = fs::remove_file(temp_path);
    result
}

pub fn make_download_handler<R: Runtime>() -> impl Fn(tauri::Webview<R>, DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    let pending: PendingDownloads = Arc::new(Mutex::new(HashMap::new()));
    move |webview, event| {
        match event {
            DownloadEvent::Requested { url, destination } => {
                let url_str = url.as_str();
                if !is_allowed_download_url(url_str) {
                    return false;
                }
                let dir = staging_dir();
                if ensure_staging_dir(&dir).is_err() {
                    return false;
                }
                let suggested = extract_suggested_filename(url_str, destination);
                let Ok(temp_path) = stage_temp_path(&dir, &suggested) else {
                    return false;
                };
                if let Ok(mut guard) = pending.lock() {
                    guard.insert(temp_path.clone(), suggested);
                }
                *destination = temp_path;
                true
            }
            DownloadEvent::Finished { url: _, path, success } => {
                let staged = path.and_then(|p| {
                    let suggested = pending
                        .lock()
                        .ok()
                        .and_then(|mut guard| guard.remove(&p))
                        .unwrap_or_else(|| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .map(sanitize_filename)
                                .unwrap_or_else(|| "download".to_owned())
                        });
                    Some((p, suggested))
                });
                let app = webview.app_handle().clone();
                if !success {
                    if let Some((temp_path, _)) = staged {
                        let _ = fs::remove_file(temp_path);
                    }
                    emit_result(&app, false, None, Some("下载失败".into()));
                    return true;
                }
                let Some((temp_path, suggested)) = staged else {
                    emit_result(&app, false, None, Some("下载文件不存在".into()));
                    return true;
                };
                tauri::async_runtime::spawn_blocking(move || {
                    let target = platform::ask_save_path(&app, &suggested);
                    match finalize_staged_download(&temp_path, target.as_deref()) {
                        Ok(Some(saved_name)) => emit_result(&app, true, Some(saved_name), None),
                        Ok(None) => {}
                        Err(message) => emit_result(&app, false, None, Some(message)),
                    }
                });
                true
            }
            _ => false,
        }
    }
}

fn emit_result<R: Runtime>(
    app: &AppHandle<R>,
    ok: bool,
    filename: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        DOWNLOAD_RESULT_EVENT,
        DownloadResultPayload { ok, filename, message },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rayagent-dl-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validates_download_url_schemes() {
        for ok in [
            "http://127.0.0.1:8080/s/tok/a.ics",
            "https://example.com/file.pdf",
            "blob:http://127.0.0.1:8080/uuid",
            "data:text/plain;base64,SGVsbG8=",
            "HTTP://127.0.0.1:9000/x",
        ] {
            assert!(is_allowed_download_url(ok), "{ok}");
        }
        for bad in ["", "file:///etc/passwd", "javascript:alert(1)", "tauri://localhost/x", "ftp://x"] {
            assert!(!is_allowed_download_url(bad), "{bad}");
        }
    }

    #[test]
    fn sanitizes_filenames_and_preserves_utf8_boundaries() {
        assert_eq!(sanitize_filename("../evil/报告.ics"), "报告.ics");
        assert_eq!(sanitize_filename("..\\..\\test\x00.txt"), "test.txt");
        assert_eq!(sanitize_filename(".."), "download");
        assert_eq!(sanitize_filename("."), "download");
        assert_eq!(sanitize_filename(""), "download");

        let long = format!("{}.ics", "中".repeat(90));
        let clean = sanitize_filename(&long);
        assert!(clean.len() <= MAX_FILENAME_BYTES);
        assert!(clean.ends_with(".ics"));
    }

    #[test]
    fn extracts_suggested_filename_with_url_fallback() {
        assert_eq!(
            extract_suggested_filename("http://127.0.0.1:9999/s/t/a.ics", Path::new("/tmp/日程.ics")),
            "日程.ics"
        );
        assert_eq!(
            extract_suggested_filename(
                "http://127.0.0.1:9999/s/t/%E6%97%A5%E7%A8%8B.ics?x=1",
                Path::new("/tmp/Unknown")
            ),
            "日程.ics"
        );
        assert_eq!(
            extract_suggested_filename("blob:http://127.0.0.1:9999/123", Path::new("/tmp/download")),
            "download"
        );
    }

    #[test]
    fn finalizes_and_cleans_up_staged_downloads() {
        let dir = temp_test_dir("finalize");
        let staged = stage_temp_path(&dir, "calendar.ics").unwrap();
        fs::write(&staged, b"BEGIN:VCALENDAR").unwrap();
        let target = dir.join("saved.ics");

        let saved = finalize_staged_download(&staged, Some(&target)).unwrap();
        assert_eq!(saved.as_deref(), Some("saved.ics"));
        assert!(!staged.exists());
        assert_eq!(fs::read(&target).unwrap(), b"BEGIN:VCALENDAR");

        let staged_cancel = stage_temp_path(&dir, "cancel.ics").unwrap();
        fs::write(&staged_cancel, b"cancel").unwrap();
        let cancelled = finalize_staged_download(&staged_cancel, None).unwrap();
        assert_eq!(cancelled, None);
        assert!(!staged_cancel.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
