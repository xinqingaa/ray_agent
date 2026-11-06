mod contract;
mod sidecar;

use sidecar::{CoreHost, HostStatus};
use tauri::{Manager, RunEvent};

#[tauri::command]
fn core_status(host: tauri::State<'_, CoreHost>) -> HostStatus {
    host.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CoreHost::default())
        .setup(|app| {
            app.state::<CoreHost>().start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_status])
        .build(tauri::generate_context!())
        .expect("failed to build the RayAgent desktop host")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<CoreHost>().stop();
            }
        });
}
