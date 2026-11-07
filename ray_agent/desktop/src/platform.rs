//! 界面经原生桥调用的受限平台能力：保存文件、打开外部链接、打开模型连接配置文件。
//! 下载由宿主带实例令牌向核心请求，令牌不进 URL；外部链接只放行 http、https 与 mailto。
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::sidecar::CoreHost;

const CONFIG_ENV: &str = "RAYAGENT_CONFIG";
const CONFIG_TEMPLATE: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../api/config.example.toml"));
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// 与核心读取的位置一致：环境变量 RAYAGENT_CONFIG，否则 ~/.config/rayagent/config.toml。
pub fn model_config_path() -> Option<PathBuf> {
    match std::env::var_os(CONFIG_ENV).filter(|value| !value.is_empty()) {
        Some(path) => Some(expand_home(PathBuf::from(path))),
        None => std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config/rayagent/config.toml")),
    }
}

fn expand_home(path: PathBuf) -> PathBuf {
    match (path.strip_prefix("~"), std::env::var_os("HOME")) {
        (Ok(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => path,
    }
}

/// 文件不存在时按示例创建（目录 700、文件 600），再用系统默认的文本编辑器打开。
#[tauri::command]
pub fn open_model_config() -> Result<String, String> {
    let path = model_config_path().ok_or("无法确定用户目录")?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("无法创建配置文件：{e}"))?;
        file.write_all(CONFIG_TEMPLATE.as_bytes()).map_err(|e| format!("无法写入配置文件：{e}"))?;
    }
    open_text(&path)?;
    Ok(path.display().to_string())
}

#[cfg(target_os = "macos")]
fn open_text(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open").arg("-t").arg(path).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "无法打开配置文件".into())
}

#[cfg(not(target_os = "macos"))]
fn open_text(path: &Path) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let scheme = url.split_once(':').map(|(scheme, _)| scheme.to_ascii_lowercase()).unwrap_or_default();
    if !matches!(scheme.as_str(), "http" | "https" | "mailto") {
        return Err("只能打开网页或邮件链接".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn ask_save_path<R: Runtime>(app: &AppHandle<R>, filename: &str) -> Option<PathBuf> {
    let name = Path::new(filename).file_name().and_then(|name| name.to_str()).unwrap_or("download");
    app.dialog().file().set_file_name(name).blocking_save_file().and_then(|path| path.into_path().ok())
}

/// 先写同目录的临时文件再改名，取消或失败不留下半个文件。
fn write_atomically(target: &Path, write: impl FnOnce(&mut fs::File) -> io::Result<()>) -> Result<(), String> {
    let partial = target.with_file_name(format!(
        ".{}.part",
        target.file_name().and_then(|name| name.to_str()).unwrap_or("download")
    ));
    let result = fs::File::create(&partial).and_then(|mut file| {
        write(&mut file)?;
        file.sync_all()
    });
    match result.and_then(|_| fs::rename(&partial, target)) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&partial);
            Err(format!("保存失败：{error}"))
        }
    }
}

/// 让用户选择位置后，带实例令牌从核心读取 `path`（/api 下的 GET 资源）并保存。取消时返回 None。
#[tauri::command]
pub async fn save_resource<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, CoreHost>,
    path: String,
    filename: String,
) -> Result<Option<String>, String> {
    if !path.starts_with("/api/") || path.contains("://") || path.contains('#') {
        return Err("只能下载核心提供的资源".into());
    }
    let (port, token) = host.endpoint().ok_or("核心尚未就绪")?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = ask_save_path(&app, &filename) else { return Ok(None) };
        let response = ureq::AgentBuilder::new()
            .timeout_connect(DOWNLOAD_TIMEOUT)
            .timeout_read(DOWNLOAD_TIMEOUT)
            .build()
            .get(&format!("http://127.0.0.1:{port}{path}"))
            .set("Authorization", &format!("Bearer {token}"))
            .call()
            .map_err(|error| match error {
                ureq::Error::Status(_, response) => response
                    .into_json::<serde_json::Value>()
                    .ok()
                    .and_then(|body| body["error"]["message"].as_str().map(str::to_owned))
                    .unwrap_or_else(|| "下载失败".into()),
                other => format!("下载失败：{other}"),
            })?;
        let mut reader = response.into_reader();
        write_atomically(&target, |file| io::copy(&mut reader, file).map(|_| ()))?;
        Ok(Some(target.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 保存界面已持有的内容（如打包下载的结果）。请求体是原始字节，文件名放在 x-filename 头里（URI 编码）。
#[tauri::command]
pub async fn save_bytes<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("请求体应为原始字节".into()) };
    let bytes = bytes.clone();
    let filename = request
        .headers()
        .get("x-filename")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode(value))
        .unwrap_or_else(|| "download".into());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = ask_save_path(&app, &filename) else { return Ok(None) };
        write_atomically(&target, |file| file.write_all(&bytes))?;
        Ok(Some(target.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn percent_decode(value: &str) -> String {
    let hex = |byte: u8| (byte as char).to_digit(16).map(|digit| digit as u8);
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                out.push(high << 4 | low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_uri_encoded_filenames() {
        assert_eq!(percent_decode("%E6%8A%A5%E5%91%8A%20v2.pdf"), "报告 v2.pdf");
        assert_eq!(percent_decode("plain%2"), "plain%2");
    }

    #[test]
    fn template_is_the_documented_example() {
        assert!(CONFIG_TEMPLATE.contains("[providers.deepseek]"));
        assert!(!CONFIG_TEMPLATE.contains("sk-"));
    }
}
