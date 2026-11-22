//! 剪贴板文本读写。界面不直接调用剪贴板插件：读写经这两个宿主命令进入插件的 Rust 接口，
//! 窗口能力只有 `core:default`，不获得插件自身的 JavaScript 权限，因此只能读写纯文本。
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 读取剪贴板中的纯文本。剪贴板没有文字（例如只有图片）时插件返回错误，界面按“无法读取”提示。
#[tauri::command]
pub fn clipboard_read_text<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    app.clipboard().read_text().map_err(|error| error.to_string())
}

/// 把纯文本写入剪贴板，替换原有内容。
#[tauri::command]
pub fn clipboard_write_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|error| error.to_string())
}
