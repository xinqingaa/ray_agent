//! 宿主偏好：任务完成通知、退出前确认。保存在宿主自己的配置目录（应用配置目录下的 host-preferences.json），
//! 不放进核心数据根：退出时核心可能已停止或正在停止，宿主仍要读得到；清空核心数据也不应重置这两个开关。
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "host-preferences.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPreferences {
    pub notify_on_finish: bool,
    pub confirm_before_quit: bool,
}

impl Default for HostPreferences {
    fn default() -> Self {
        Self { notify_on_finish: true, confirm_before_quit: true }
    }
}

/// 界面只能改这两个布尔开关；未知字段直接拒绝。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostPreferencesPatch {
    pub notify_on_finish: Option<bool>,
    pub confirm_before_quit: Option<bool>,
}

pub struct PreferenceStore {
    path: PathBuf,
    current: Mutex<HostPreferences>,
}

impl PreferenceStore {
    /// 文件不存在时用默认值；文件损坏时记录原因并用默认值，直到下一次保存覆盖它。
    pub fn load(path: PathBuf) -> Self {
        let current = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
                eprintln!("[host] 宿主偏好文件无法解析，使用默认值：{error}");
                HostPreferences::default()
            }),
            Err(_) => HostPreferences::default(),
        };
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> HostPreferences {
        *self.current.lock().unwrap()
    }

    /// 合并补丁并原子写回；写盘失败时内存值不变，返回原因。
    pub fn update(&self, patch: HostPreferencesPatch) -> Result<HostPreferences, String> {
        let mut current = self.current.lock().unwrap();
        let next = HostPreferences {
            notify_on_finish: patch.notify_on_finish.unwrap_or(current.notify_on_finish),
            confirm_before_quit: patch.confirm_before_quit.unwrap_or(current.confirm_before_quit),
        };
        write_atomically(&self.path, &next)?;
        *current = next;
        Ok(next)
    }
}

fn write_atomically(path: &Path, preferences: &HostPreferences) -> Result<(), String> {
    let parent = path.parent().ok_or("无法确定宿主偏好的保存位置")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
    let text = serde_json::to_string_pretty(preferences).map_err(|e| e.to_string())?;
    let partial = path.with_extension("json.part");
    fs::write(&partial, text).map_err(|e| format!("无法保存偏好：{e}"))?;
    fs::rename(&partial, path).map_err(|e| {
        let _ = fs::remove_file(&partial);
        format!("无法保存偏好：{e}")
    })
}

pub fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(FILE_NAME))
}

#[tauri::command]
pub fn host_preferences(store: tauri::State<'_, PreferenceStore>) -> HostPreferences {
    store.get()
}

#[tauri::command]
pub fn set_host_preferences(
    store: tauri::State<'_, PreferenceStore>,
    patch: HostPreferencesPatch,
) -> Result<HostPreferences, String> {
    store.update(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rayagent-prefs-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(FILE_NAME)
    }

    #[test]
    fn defaults_are_on_and_missing_file_uses_them() {
        let store = PreferenceStore::load(temp_path("missing"));
        assert_eq!(store.get(), HostPreferences { notify_on_finish: true, confirm_before_quit: true });
    }

    #[test]
    fn updates_merge_persist_and_survive_reload() {
        let path = temp_path("merge");
        let store = PreferenceStore::load(path.clone());
        let next = store.update(HostPreferencesPatch { notify_on_finish: Some(false), confirm_before_quit: None }).unwrap();
        assert_eq!(next, HostPreferences { notify_on_finish: false, confirm_before_quit: true });
        let reloaded = PreferenceStore::load(path);
        assert_eq!(reloaded.get(), next);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(PreferenceStore::load(path).get(), HostPreferences::default());
    }

    #[test]
    fn patch_rejects_unknown_fields() {
        let ok: Result<HostPreferencesPatch, _> = serde_json::from_str(r#"{"notifyOnFinish": false}"#);
        assert!(ok.is_ok());
        let unknown: Result<HostPreferencesPatch, _> = serde_json::from_str(r#"{"notifyOnFinish": false, "x": 1}"#);
        assert!(unknown.is_err());
        let wrong_name: Result<HostPreferencesPatch, _> = serde_json::from_str(r#"{"notify_on_finish": false}"#);
        assert!(wrong_name.is_err());
    }
}
