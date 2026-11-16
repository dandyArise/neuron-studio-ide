use serde::Serialize;
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

pub const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Document(pub Mutex<Option<PathBuf>>);

#[derive(Serialize)]
pub struct Opened {
    name: String,
    content: String,
}

#[tauri::command]
pub fn new_file(doc: State<'_, Document>) -> Opened {
    *doc.0.lock().unwrap() = None;
    Opened { name: "sans_titre.py".into(), content: String::new() }
}

fn python_name(path: &Path) -> Result<String, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("py"))
    {
        return Err("Choisissez un fichier .py.".into());
    }
    Ok(path.file_name().unwrap().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_file(doc: State<'_, Document>, examples: Option<bool>) -> Result<Option<Opened>, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    const SETTINGS: &str = r"Software\Neuron Studio";
    let personal = examples == Some(true);
    let mut dialog = rfd::AsyncFileDialog::new().add_filter("Python", &["py"]);
    if personal {
        dialog = dialog.set_title("Mes exemples — choisir un script Python");
        let saved = RegKey::predef(HKEY_CURRENT_USER).open_subkey(SETTINGS).ok()
            .and_then(|key| key.get_value::<String, _>("ExamplesFolder").ok())
            .map(PathBuf::from).filter(|path| path.is_dir());
        let nearby = std::env::current_exe().ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("examples")));
        if let Some(folder) = saved.or(nearby).filter(|path| path.is_dir()) {
            dialog = dialog.set_directory(folder);
        }
    }
    let Some(file) = dialog
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path();
    let name = python_name(path)?;
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|f| f.take((LIMIT + 1) as u64).read_to_end(&mut bytes))
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("Fichier supérieur à 8 Mio.".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "Le fichier doit être encodé en UTF-8.")?;
    if personal {
        if let (Some(parent), Ok((key, _))) = (path.parent(), RegKey::predef(HKEY_CURRENT_USER).create_subkey(SETTINGS)) {
            let _ = key.set_value("ExamplesFolder", &parent.as_os_str());
        }
    }
    *doc.0.lock().unwrap() = Some(path.into());
    Ok(Some(Opened { name, content }))
}

#[tauri::command]
pub async fn save_file(
    content: String,
    doc: State<'_, Document>,
) -> Result<Option<String>, String> {
    if content.len() > LIMIT {
        return Err("Fichier supérieur à 8 Mio.".into());
    }
    let existing = doc.0.lock().unwrap().clone();
    let path = match existing {
        Some(path) => path,
        None => {
            let Some(file) = rfd::AsyncFileDialog::new()
                .add_filter("Python", &["py"])
                .set_file_name("script.py")
                .save_file()
                .await
            else {
                return Ok(None);
            };
            file.path().to_owned()
        }
    };
    let name = python_name(&path)?;
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Dossier introuvable.")?)
        .map_err(|e| e.to_string())?;
    tmp.write_all(content.as_bytes())
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(&path).map_err(|e| e.to_string())?;
    *doc.0.lock().unwrap() = Some(path);
    Ok(Some(name))
}
