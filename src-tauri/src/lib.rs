use std::{fs, path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use url::Url;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFilePayload {
  path: String,
  name: String,
  contents: Vec<u8>,
}

struct PendingDesktopFiles(Mutex<Vec<DesktopFilePayload>>);

fn path_to_payload(path: PathBuf) -> Result<DesktopFilePayload, String> {
  let contents = fs::read(&path).map_err(|error| error.to_string())?;
  let name = path
    .file_name()
    .and_then(|value| value.to_str())
    .ok_or_else(|| "Invalid file name".to_string())?
    .to_string();

  Ok(DesktopFilePayload {
    path: path.to_string_lossy().to_string(),
    name,
    contents,
  })
}

fn collect_file_payloads(values: &[String]) -> Vec<DesktopFilePayload> {
  values
    .iter()
    .filter_map(|value| {
      let path = PathBuf::from(value);
      if path.is_file() {
        path_to_payload(path).ok()
      } else {
        None
      }
    })
    .collect()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn collect_url_payloads(urls: &[Url]) -> Vec<DesktopFilePayload> {
  urls
    .iter()
    .filter_map(|url| url.to_file_path().ok())
    .filter(|path| path.is_file())
    .filter_map(|path| path_to_payload(path).ok())
    .collect()
}

#[tauri::command]
fn read_desktop_file(path: String) -> Result<DesktopFilePayload, String> {
  path_to_payload(PathBuf::from(path))
}

#[tauri::command]
fn write_desktop_file(path: String, contents: Vec<u8>) -> Result<DesktopFilePayload, String> {
  fs::write(&path, contents).map_err(|error| error.to_string())?;
  path_to_payload(PathBuf::from(path))
}

#[tauri::command]
fn pending_desktop_files(app: AppHandle) -> Result<Vec<DesktopFilePayload>, String> {
  let pending_state = app.state::<PendingDesktopFiles>();
  let mut pending = pending_state
    .0
    .lock()
    .map_err(|_| "Failed to read pending files".to_string())?;
  let files = pending.clone();
  pending.clear();
  Ok(files)
}

fn emit_files(app: &AppHandle, files: Vec<DesktopFilePayload>) {
  if files.is_empty() {
    return;
  }

  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_focus();
  }

  for payload in files {
    let _ = app.emit("desktop-file-opened", payload);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(PendingDesktopFiles(Mutex::new(vec![])))
    .invoke_handler(tauri::generate_handler![
      read_desktop_file,
      write_desktop_file,
      pending_desktop_files
    ]);

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let files = collect_file_payloads(&argv[1..]);
      emit_files(app, files);
    }));
  }

  builder
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|_app, _event| {
      #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
      if let tauri::RunEvent::Opened { urls } = _event {
        let files = collect_url_payloads(&urls);
        if let Ok(mut pending) = _app.state::<PendingDesktopFiles>().0.lock() {
          pending.extend(files.clone());
        }
        emit_files(_app, files);
      }
    });
}
