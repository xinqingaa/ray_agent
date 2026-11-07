mod contract;
mod platform;
mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use sidecar::{CoreConnection, CoreHost};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

/// 界面收到退出请求后要在这段时间内回应，否则宿主直接退出，避免界面卡住时无法退出。
const QUIT_ACK_TIMEOUT: Duration = Duration::from_secs(2);
const QUIT_REQUESTED: &str = "rayagent://quit-requested";
const QUIT_MENU_ID: &str = "rayagent-quit";

#[derive(Default)]
struct QuitState {
    confirmed: AtomicBool,
    acknowledged: AtomicBool,
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

/// 界面已收到退出请求，正在向用户确认。
#[tauri::command]
fn quit_ack(quit: tauri::State<'_, QuitState>) {
    quit.acknowledged.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn quit_confirm(app: AppHandle, quit: tauri::State<'_, QuitState>) {
    quit.confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 用户发起的退出先交给界面：有活动运行时由界面确认，确认后才停止核心。
fn request_quit(app: &AppHandle) -> bool {
    let quit = app.state::<QuitState>();
    if quit.confirmed.load(Ordering::SeqCst) || !app.state::<CoreHost>().is_ready() {
        return false;
    }
    quit.acknowledged.store(false, Ordering::SeqCst);
    show_main(app);
    if app.emit(QUIT_REQUESTED, ()).is_err() {
        return false;
    }
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(QUIT_ACK_TIMEOUT);
        let quit = handle.state::<QuitState>();
        if !quit.acknowledged.load(Ordering::SeqCst) {
            quit.confirmed.store(true, Ordering::SeqCst);
            handle.exit(0);
        }
    });
    true
}

fn quit_from_menu(app: &AppHandle) {
    if !request_quit(app) {
        app.state::<QuitState>().confirmed.store(true, Ordering::SeqCst);
        app.exit(0);
    }
}

/// 与默认菜单相同，只把退出换成自定义项：系统预置的退出直接终止应用，不产生 ExitRequested，无法先交给界面确认。
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

/// 终止信号与普通退出走同一条停止流程：关闭 stdin，核心停止受理并结束任务后退出。
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
        .manage(CoreHost::default())
        .manage(QuitState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(app_menu(app.handle())?)?;
            watch_signals(app.handle().clone());
            app.state::<CoreHost>().start(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_MENU_ID {
                quit_from_menu(app);
            }
        })
        .on_window_event(|window, event| {
            // 关闭主窗口只隐藏，核心与活动运行继续；从程序坞重新打开。退出用菜单或 Cmd-Q。
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !window.app_handle().state::<QuitState>().confirmed.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            core_connection,
            restart_core,
            quit_ack,
            quit_confirm,
            platform::open_model_config,
            platform::open_external,
            platform::save_resource,
            platform::save_bytes,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the RayAgent desktop host")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() && request_quit(app) {
                    api.prevent_exit();
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            RunEvent::Exit => {
                for window in app.webview_windows().values() {
                    let _ = window.hide();
                }
                app.state::<CoreHost>().stop();
            }
            _ => {}
        });
}
