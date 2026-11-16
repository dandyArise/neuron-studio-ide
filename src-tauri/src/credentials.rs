use std::{io, ptr, slice, str};
use windows_sys::Win32::{
    Foundation::ERROR_NOT_FOUND,
    Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    },
};

const TARGET: &str = "NeuronStudio/LMStudio";

struct Credential(*mut CREDENTIALW);

impl Drop for Credential {
    fn drop(&mut self) {
        unsafe { CredFree(self.0.cast()) }
    }
}

fn wide(target: &str) -> Vec<u16> {
    target.encode_utf16().chain(Some(0)).collect()
}

fn read(target: &str) -> Result<Option<Credential>, String> {
    let mut raw = ptr::null_mut();
    if unsafe { CredReadW(wide(target).as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } != 0 {
        return Ok(Some(Credential(raw)));
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
        return Ok(None);
    }
    Err(format!(
        "Lecture du Gestionnaire d’identifiants Windows impossible : {err}"
    ))
}

fn token_for(target: &str) -> Result<Option<String>, String> {
    let Some(credential) = read(target)? else {
        return Ok(None);
    };
    // The credential owns this allocation until its RAII guard calls CredFree.
    let record = unsafe { &*credential.0 };
    if record.CredentialBlobSize == 0 {
        return Ok(None);
    }
    let bytes =
        unsafe { slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize) };
    str::from_utf8(bytes)
        .map(|s| Some(s.to_owned()))
        .map_err(|_| "Jeton Windows illisible. Enregistrez-le de nouveau.".into())
}

pub(crate) fn stored_token() -> Result<Option<String>, String> {
    token_for(TARGET)
}

fn save(target: &str, token: &str) -> Result<(), String> {
    let mut target = wide(target);
    if token.trim().is_empty() {
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        let err = io::Error::last_os_error();
        if err.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
            return Ok(());
        }
        return Err(format!("Suppression du jeton Windows impossible : {err}"));
    }
    if token.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize || token.contains(['\r', '\n', '\0']) {
        return Err("Le jeton doit tenir sur une ligne de 2560 octets maximum.".into());
    }
    let record = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlob: token.as_ptr().cast_mut(),
        CredentialBlobSize: token.len() as u32,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..CREDENTIALW::default()
    };
    if unsafe { CredWriteW(&record, 0) } != 0 {
        Ok(())
    } else {
        Err(format!(
            "Enregistrement du jeton Windows impossible : {}",
            io::Error::last_os_error()
        ))
    }
}

#[tauri::command]
pub fn assistant_token_status() -> Result<bool, String> {
    Ok(read(TARGET)?.is_some())
}

#[tauri::command]
pub fn assistant_save_token(token: String) -> Result<(), String> {
    save(TARGET, token.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_manager_roundtrip() {
        let directory = tempfile::tempdir().unwrap();
        let suffix = directory.path().file_name().unwrap().to_str().unwrap();
        let target = format!("NeuronStudio/Test/{suffix}");
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = save(&self.0, "");
            }
        }
        assert!(read(&target).unwrap().is_none());
        let _guard = Cleanup(target.clone());
        for token in ["synthetic-one", "synthétique-two"] {
            save(&target, token).unwrap();
            assert!(read(&target).unwrap().is_some());
            assert_eq!(token_for(&target).unwrap().as_deref(), Some(token));
        }
        save(&target, "").unwrap();
        assert!(token_for(&target).unwrap().is_none());
        save(&target, "").unwrap();
    }
}
