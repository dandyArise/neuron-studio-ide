#![windows_subsystem = "windows"]
mod files;
mod analysis;
mod assistant;
mod credentials;
mod job;
mod runner;
use tauri::Manager;

#[tauri::command]
fn download_update() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("https://github.com/dandyArise/neuron-studio-ide/releases/latest/download/Neuron-Studio-Windows-x64.exe")
        .spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(files::Document::default())
        .manage(analysis::Analyzer::default())
        .manage(runner::Runs::default())
        .invoke_handler(tauri::generate_handler![
            download_update,
            files::new_file,
            analysis::analyze,
            assistant::assistant_ask,
            assistant::assistant_models,
            credentials::assistant_token_status,
            credentials::assistant_save_token,
            files::open_file,
            files::save_file,
            runner::run,
            runner::stop
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<runner::Runs>().cancel();
            }
        })
        .run(tauri::generate_context!())
        .expect("Démarrage de Neuron impossible");
}
