fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["new_file", "open_file", "save_file", "run", "stop", "analyze", "assistant_ask", "assistant_token_status", "assistant_save_token"]),
    ))
    .expect("Tauri build");
}
