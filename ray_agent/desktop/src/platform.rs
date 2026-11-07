//! 界面经原生桥调用的受限平台能力：保存文件、打开外部链接、打开模型连接配置文件、选择文件夹授权、在文件管理器中显示根内位置。
//! 下载由宿主带实例令牌向核心请求，令牌不进 URL；外部链接只放行 http、https 与 mailto。
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};
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

/// 文件夹选择的用途；界面只传用途，对话框标题由宿主决定。
fn picker_title(purpose: &str) -> Result<&'static str, String> {
    match purpose {
        "open_workspace" => Ok("选择要作为工作区打开的文件夹"),
        "default_location" => Ok("选择新工作区的默认位置"),
        "relocate_workspace" => Ok("选择工作区的新文件夹位置"),
        _ => Err("不支持的选择用途".into()),
    }
}

/// 交给界面的授权结果：一次性凭证与所选文件夹的展示名，不含宿主密钥，也不含可复用的路径权限。
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct FolderGrant {
    grant_id: String,
    name: String,
}

fn folder_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_owned())
}

/// 解析核心 `POST /api/host/folder-grants` 的响应体；路径以核心规范化后的结果为准。
fn parse_folder_grant(body: &serde_json::Value, picked: &str) -> Result<FolderGrant, String> {
    let data = &body["data"];
    let grant_id = data["grant_id"].as_str().filter(|id| !id.is_empty()).ok_or("核心没有返回授权凭证")?;
    let path = data["path"].as_str().unwrap_or(picked);
    Ok(FolderGrant { grant_id: grant_id.to_owned(), name: folder_display_name(path) })
}

/// 带实例令牌与宿主密钥调用核心的宿主专用接口（`/api/host/...`）；失败时取核心给出的原因。
fn host_post(app: &AppHandle<impl Runtime>, path: &str, body: serde_json::Value, rejected: &str) -> Result<serde_json::Value, String> {
    // 对话框等待期间核心可能重启：端口、令牌与宿主密钥都在调用前才读取。
    let host = app.state::<CoreHost>();
    let (port, token) = host.endpoint().ok_or("核心尚未就绪")?;
    let secret = host.host_secret().ok_or("核心尚未就绪")?;
    ureq::AgentBuilder::new()
        .timeout_connect(DOWNLOAD_TIMEOUT)
        .timeout_read(DOWNLOAD_TIMEOUT)
        .build()
        .post(&format!("http://127.0.0.1:{port}{path}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("X-RayAgent-Host-Secret", &secret)
        .send_json(body)
        .map_err(|error| match error {
            ureq::Error::Status(_, response) => response
                .into_json::<serde_json::Value>()
                .ok()
                .and_then(|body| body["error"]["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| rejected.to_owned()),
            other => format!("无法连接核心：{other}"),
        })?
        .into_json()
        .map_err(|error| format!("核心响应无法解析：{error}"))
}

/// 弹出系统文件夹选择器；选中后用宿主密钥向核心登记，只把一次性 grant_id 与展示名交给界面。取消时返回 None。
#[tauri::command]
pub async fn select_folder_grant<R: Runtime>(app: AppHandle<R>, purpose: String) -> Result<Option<FolderGrant>, String> {
    let title = picker_title(&purpose)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().set_title(title).blocking_pick_folder().and_then(|path| path.into_path().ok())
        else {
            return Ok(None);
        };
        let picked = picked.to_str().ok_or("所选文件夹的路径不是有效文本")?.to_owned();
        let body = host_post(&app, "/api/host/folder-grants", serde_json::json!({ "path": picked }), "核心拒绝了所选文件夹")?;
        parse_folder_grant(&body, &picked).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 根身份只拼进请求路径，必须是核心签发的字符（字母、数字、连字符、下划线），不能夹带路径或查询。
fn valid_root_id(root_id: &str) -> bool {
    !root_id.is_empty() && root_id.len() <= 128 && root_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 解析核心 `POST /api/host/roots/{root_id}/resolve` 的响应体：目标在本机的绝对路径。
fn parse_resolved_path(body: &serde_json::Value) -> Result<PathBuf, String> {
    let path = body["data"]["path"].as_str().filter(|path| !path.is_empty()).ok_or("核心没有返回文件位置")?;
    let path = PathBuf::from(path);
    path.is_absolute().then_some(path).ok_or_else(|| "核心返回的位置不是绝对路径".into())
}

#[cfg(target_os = "macos")]
fn reveal(app: &AppHandle<impl Runtime>, path: &Path) -> Result<(), String> {
    let _ = app;
    let status = std::process::Command::new("/usr/bin/open").arg("-R").arg(path).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "无法在 Finder 中显示".into())
}

#[cfg(not(target_os = "macos"))]
fn reveal(app: &AppHandle<impl Runtime>, path: &Path) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// 在系统文件管理器中显示根内的文件或目录。位置由核心按根身份与路径规则解析（不越出根，拒绝保留目录与凭据文件，
/// 目标须存在），界面只传 `root_id` 与相对路径，拿不到也不能指定绝对路径；空的相对路径表示根目录本身。
#[tauri::command]
pub async fn reveal_in_file_manager<R: Runtime>(app: AppHandle<R>, root_id: String, relative_path: String) -> Result<(), String> {
    if !valid_root_id(&root_id) {
        return Err("无效的文件夹标识".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let body = host_post(
            &app,
            &format!("/api/host/roots/{root_id}/resolve"),
            serde_json::json!({ "relative_path": relative_path }),
            "核心拒绝了这个位置",
        )?;
        reveal(&app, &parse_resolved_path(&body)?)
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
    fn grant_result_keeps_only_credential_and_display_name() {
        let body = serde_json::json!({"data": {"grant_id": "g1", "path": "/Users/a/我的资料", "expires_at": 1}});
        assert_eq!(
            parse_folder_grant(&body, "/picked").unwrap(),
            FolderGrant { grant_id: "g1".into(), name: "我的资料".into() }
        );
        assert_eq!(parse_folder_grant(&serde_json::json!({"data": {"grant_id": "g2"}}), "/picked/x").unwrap().name, "x");
        assert!(parse_folder_grant(&serde_json::json!({"data": {}}), "/picked").is_err());
        assert_eq!(folder_display_name("/"), "/");
    }

    #[test]
    fn picker_purposes_are_closed_set() {
        assert!(picker_title("open_workspace").is_ok());
        assert!(picker_title("default_location").is_ok());
        assert!(picker_title("relocate_workspace").is_ok());
        assert!(picker_title("anything").is_err());
    }

    #[test]
    fn root_ids_cannot_carry_paths_or_queries() {
        assert!(valid_root_id("8e8b41c7cc384edf8dd54e498b5dfaf4"));
        assert!(valid_root_id("a-b_C1"));
        for bad in ["", "a/b", "../x", "a?b", "a#b", "a b", "中文", "%2e%2e"] {
            assert!(!valid_root_id(bad), "{bad}");
        }
        assert!(!valid_root_id(&"a".repeat(129)));
    }

    #[test]
    fn resolved_path_must_be_absolute_text() {
        let ok = serde_json::json!({"data": {"path": "/Users/a/资料/报告.md"}});
        assert_eq!(parse_resolved_path(&ok).unwrap(), PathBuf::from("/Users/a/资料/报告.md"));
        assert!(parse_resolved_path(&serde_json::json!({"data": {"path": "relative/x"}})).is_err());
        assert!(parse_resolved_path(&serde_json::json!({"data": {"path": ""}})).is_err());
        assert!(parse_resolved_path(&serde_json::json!({"data": {}})).is_err());
    }

    #[test]
    fn template_is_the_documented_example() {
        assert!(CONFIG_TEMPLATE.contains("[providers.deepseek]"));
        assert!(!CONFIG_TEMPLATE.contains("sk-"));
    }
}
