mod clipboard;
mod contract;
mod download;
mod notify;
mod platform;
mod preferences;
mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use preferences::PreferenceStore;
use sidecar::{CoreConnection, CoreHost};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const QUIT_MENU_ID: &str = "rayagent-quit";

/// 退出状态：`confirmed` 表示已决定退出（之后的退出请求直接放行）；`asking` 表示确认对话框或活动运行查询进行中。
#[derive(Default)]
struct QuitState {
    confirmed: AtomicBool,
    asking: AtomicBool,
}

#[tauri::command]
fn core_connection(host: tauri::State<'_, CoreHost>) -> CoreConnection {
    host.connection()
}

#[tauri::command]
async fn restart_core(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<CoreHost>().restart(&app))
        .await
        .map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 退出前是否需要确认：偏好开启且核心已就绪（没有核心就没有运行，直接退出）。
fn confirmation_needed(app: &AppHandle) -> bool {
    app.state::<PreferenceStore>().get().confirm_before_quit && app.state::<CoreHost>().is_ready()
}

/// 用户请求退出（菜单、Cmd+Q）时调用。需要确认时在后台查询活动运行数并弹出原生对话框，
/// 确认后才退出；返回 true 表示退出已转入确认流程，调用方应阻止本次退出。
fn begin_quit(app: &AppHandle) -> bool {
    let quit = app.state::<QuitState>();
    if quit.confirmed.load(Ordering::SeqCst) || !confirmation_needed(app) {
        return false;
    }
    if quit.asking.swap(true, Ordering::SeqCst) {
        return true;
    }
    let handle = app.clone();
    thread::spawn(move || {
        let confirmed = match sidecar::active_runs(&handle) {
            Ok(0) => true,
            Ok(count) => ask_quit(&handle, Some(count)),
            Err(error) => {
                eprintln!("[host] 无法读取活动运行数：{error}");
                ask_quit(&handle, None)
            }
        };
        let quit = handle.state::<QuitState>();
        if confirmed {
            quit.confirmed.store(true, Ordering::SeqCst);
            handle.exit(0);
        } else {
            quit.asking.store(false, Ordering::SeqCst);
        }
    });
    true
}

/// 原生确认对话框，附着在主窗口上；`count` 为 None 表示无法确认任务数。返回是否退出。
fn ask_quit(app: &AppHandle, count: Option<u64>) -> bool {
    let message = match count {
        Some(count) => format!("有 {count} 个任务正在运行或等待你处理。退出会停止这些任务，未完成的会记为中断。"),
        None => "无法确认是否有任务正在进行。退出会停止仍在进行的任务，它们会记为中断。".to_owned(),
    };
    let mut dialog = app
        .dialog()
        .message(message)
        .title("退出 RayAgent？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("停止任务并退出".into(), "取消".into()));
    if let Some(window) = app.get_webview_window("main") {
        show_main(app);
        dialog = dialog.parent(&window);
    }
    dialog.blocking_show()
}

fn quit_from_menu(app: &AppHandle) {
    if !begin_quit(app) {
        app.state::<QuitState>().confirmed.store(true, Ordering::SeqCst);
        app.exit(0);
    }
}

/// 与默认菜单相同，只把退出换成自定义项：系统预置的退出直接终止应用，不产生 ExitRequested，无法先确认。
#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let name = app.config().product_name.clone().unwrap_or_else(|| app.package_info().name.clone());
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                &name,
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, QUIT_MENU_ID, format!("Quit {name}"), true, Some("CmdOrCtrl+Q"))?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&PredefinedMenuItem::close_window(app, None)?])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

/// 终止信号与普通退出走同一条停止流程：关闭 stdin，核心停止受理并结束任务后退出。信号不弹确认。
fn watch_signals(app: AppHandle) {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    let Ok(mut signals) = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP]) else {
        eprintln!("[host] 无法注册终止信号处理");
        return;
    };
    thread::spawn(move || {
        if let Some(signal) = signals.forever().next() {
            eprintln!("[host] received signal {signal}, stopping");
            app.state::<QuitState>().confirmed.store(true, Ordering::SeqCst);
            app.exit(0);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(CoreHost::default())
        .manage(QuitState::default())
        .manage(notify::Notifier::default())
        .setup(|app| {
            let path = preferences::store_path(app.handle())?;
            app.manage(PreferenceStore::load(path));
            #[cfg(target_os = "macos")]
            app.set_menu(app_menu(app.handle())?)?;
            if let Some(window_config) = app.config().app.windows.first() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), window_config)?
                    .on_download(download::make_download_handler())
                    .build()?;
            }
            watch_signals(app.handle().clone());
            notify::sync_focus(app.handle());
            notify::start(app.handle());
            app.state::<CoreHost>().start(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_MENU_ID {
                quit_from_menu(app);
            }
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // 关闭主窗口只隐藏，核心与活动运行继续；从程序坞重新打开。退出用菜单或 Cmd-Q。
                WindowEvent::CloseRequested { api, .. } => {
                    if !window.app_handle().state::<QuitState>().confirmed.load(Ordering::SeqCst) {
                        api.prevent_close();
                        notify::set_focused(window.app_handle(), false);
                        let _ = window.hide();
                    }
                }
                WindowEvent::Focused(focused) => notify::set_focused(window.app_handle(), *focused),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            core_connection,
            restart_core,
            platform::open_model_config,
            platform::open_external,
            platform::save_resource,
            platform::save_bytes,
            platform::select_folder_grant,
            platform::reveal_in_file_manager,
            platform::data_location,
            platform::reveal_data_location,
            preferences::host_preferences,
            preferences::set_host_preferences,
            notify::set_viewed_session,
            notify::notification_permission,
            clipboard::clipboard_read_text,
            clipboard::clipboard_write_text,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the RayAgent desktop host")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code: None, .. } => {
                if begin_quit(app) {
                    api.prevent_exit();
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            RunEvent::Exit => {
                for window in app.webview_windows().values() {
                    let _ = window.hide();
                }
                download::cleanup_staging_dir();
                app.state::<CoreHost>().stop();
            }
            _ => {}
        });
}
