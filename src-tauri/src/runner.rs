use crate::{
    files::{Document, LIMIT},
    job::Job,
};
use serde::Serialize;
use std::{
    env,
    io::{self, Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{ipc::Channel, State};

// Python reads the entire buffer before loading site packages or running user code.
// Rust attaches the Windows job before writing to stdin.
const BOOTSTRAP: &str = r#"
import sys
source = sys.stdin.buffer.read().decode('utf-8-sig')
if not source: sys.exit(0)
import site, os, linecache
site.main()
filename = sys.argv[1]
sys.argv = [filename]
sys.path.insert(0, os.path.dirname(filename))
linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
scope = {'__name__':'__main__','__file__':filename,'__package__':None,'__cached__':None}
exec(compile(source, filename, 'exec'), scope)
"#;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Event {
    Stdout { data: String },
    Stderr { data: String },
    Exit { code: Option<i32>, stopped: bool },
}

struct Active {
    job: Arc<Job>,
    stopped: bool,
}
#[derive(Default, Clone)]
pub struct Runs(Arc<Mutex<Option<Active>>>);

fn python_candidate() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("NEURON_PYTHON") {
        let path = PathBuf::from(value);
        return if path.is_absolute() && path.is_file() {
            Ok(path)
        } else {
            Err("NEURON_PYTHON doit désigner un python.exe existant par son chemin absolu.".into())
        };
    }
    env::split_paths(&env::var_os("PATH").unwrap_or_default())
        .filter(|p| p.is_absolute())
        .map(|p| p.join("python.exe"))
        .find(|p| p.is_file())
        .ok_or_else(|| "Python introuvable. Installez Python ou définissez NEURON_PYTHON.".into())
}

pub(crate) fn interpreter() -> Result<PathBuf, String> {
    // The WindowsApps launcher can delegate outside the parent's job. Resolve
    // it before spawning the process that will receive the editor buffer.
    let probe = Command::new(python_candidate()?)
        .args([
            "-I",
            "-S",
            "-X",
            "utf8",
            "-c",
            "import sys; print(sys.executable)",
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Interpréteur Python indisponible : {e}"))?;
    let path = PathBuf::from(String::from_utf8_lossy(&probe.stdout).trim());
    if probe.status.success() && path.is_absolute() && path.is_file() {
        Ok(path)
    } else {
        Err(
            "Python introuvable. Définissez NEURON_PYTHON avec le chemin absolu de python.exe."
                .into(),
        )
    }
}

type Output = Arc<dyn Fn(Event) + Send + Sync>;

fn read_stream(mut pipe: impl Read, stderr: bool, output: Output) {
    let mut decoder = encoding_rs::UTF_8.new_decoder_without_bom_handling();
    let mut chunk = [0; 4096];
    loop {
        let size = match pipe.read(&mut chunk) {
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => {
                output(Event::Stderr {
                    data: format!("Lecture du flux : {e}\n"),
                });
                break;
            }
        };
        let mut data = String::with_capacity(decoder.max_utf8_buffer_length(size).unwrap());
        let (result, consumed, _) = decoder.decode_to_string(&chunk[..size], &mut data, size == 0);
        debug_assert_eq!(consumed, size);
        debug_assert!(matches!(result, encoding_rs::CoderResult::InputEmpty));
        if !data.is_empty() {
            output(if stderr {
                Event::Stderr { data }
            } else {
                Event::Stdout { data }
            });
        }
        if size == 0 {
            break;
        }
    }
}

impl Runs {
    pub fn cancel(&self) -> Result<(), String> {
        if let Some(active) = self.0.lock().unwrap().as_mut() {
            active.job.terminate().map_err(|e| e.to_string())?;
            active.stopped = true;
        }
        Ok(())
    }

    fn start(&self, source: String, path: &Path, output: Output) -> Result<(), String> {
        if source.len() > LIMIT {
            return Err("Script supérieur à 8 Mio.".into());
        }
        let mut slot = self.0.lock().unwrap();
        if slot.is_some() {
            return Err("Un script est déjà en cours.".into());
        }
        let job = Arc::new(Job::new().map_err(|e| e.to_string())?);
        let mut child = Command::new(interpreter()?)
            .args(["-I", "-S", "-X", "utf8", "-u", "-c", BOOTSTRAP])
            .arg(path)
            .current_dir(path.parent().ok_or("Dossier de travail introuvable.")?)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Démarrage de Python impossible : {e}"))?;
        if let Err(e) = job.attach(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Protection de l'arbre de processus impossible : {e}"
            ));
        }
        let (mut stdin, stdout, stderr) = (
            child.stdin.take().unwrap(),
            child.stdout.take().unwrap(),
            child.stderr.take().unwrap(),
        );
        *slot = Some(Active {
            job: job.clone(),
            stopped: false,
        });
        let runs = self.clone();
        thread::spawn(move || {
            let out = output.clone();
            let err = output.clone();
            let stdout_reader = thread::spawn(move || read_stream(stdout, false, out));
            let stderr_reader = thread::spawn(move || read_stream(stderr, true, err));
            if let Err(e) = stdin.write_all(source.as_bytes()) {
                if !matches!(
                    e.kind(),
                    io::ErrorKind::BrokenPipe | io::ErrorKind::ConnectionReset
                ) {
                    output(Event::Stderr {
                        data: format!("Transmission du script : {e}\n"),
                    });
                }
            }
            drop(stdin);
            let status = child.wait();
            let _ = job.terminate(); // Close inherited pipes even when a script leaves children alive.
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let mut slot = runs.0.lock().unwrap();
            let stopped = slot.take().is_some_and(|active| active.stopped);
            let code = status.ok().and_then(|s| s.code());
            output(Event::Exit { code, stopped });
        });
        Ok(())
    }
}

#[tauri::command]
pub fn run(
    source: String,
    events: Channel<Event>,
    runs: State<'_, Runs>,
    doc: State<'_, Document>,
) -> Result<(), String> {
    let path = doc
        .0
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| env::temp_dir().join("neural_network.py"));
    runs.start(
        source,
        &path,
        Arc::new(move |event| {
            let _ = events.send(event);
        }),
    )
}

#[tauri::command]
pub fn stop(runs: State<'_, Runs>) -> Result<(), String> {
    runs.cancel()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    fn start(runs: &Runs, source: &str, path: &Path) -> mpsc::Receiver<Event> {
        let (tx, rx) = mpsc::channel();
        runs.start(
            source.into(),
            path,
            Arc::new(move |event| {
                tx.send(event).unwrap();
            }),
        )
        .unwrap();
        rx
    }

    #[test]
    fn streams_before_exit_and_reports_status() {
        let runs = Runs::default();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("une étude.py");
        let rx = start(&runs, "import sys,time,os\nassert os.getcwd()==os.path.dirname(__file__)\nsys.stdout.write('é日' * 2300)\nsys.stderr.write('erreur')\ntime.sleep(.25)\nsys.exit(7)", &path);
        let (mut out, mut err) = (String::new(), String::new());
        loop {
            match rx.recv_timeout(Duration::from_secs(12)).unwrap() {
                Event::Stdout { data } => out.push_str(&data),
                Event::Stderr { data } => err.push_str(&data),
                Event::Exit { code, stopped } => {
                    assert_eq!(code, Some(7));
                    assert!(!stopped);
                    break;
                }
            }
        }
        assert_eq!(out, "é日".repeat(2300));
        assert_eq!(err, "erreur");
    }

    #[test]
    fn stops_children_and_allows_next_run() {
        let runs = Runs::default();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.py");
        let source = r#"import subprocess,sys,time
p=subprocess.Popen([sys.executable,'-c',"import time,pathlib;time.sleep(2);pathlib.Path('escaped').touch()"])
print('ready')
time.sleep(60)
"#;
        let rx = start(&runs, source, &path);
        let mut ready = String::new();
        while !ready.contains("ready\n") {
            match rx.recv_timeout(Duration::from_secs(12)).unwrap() {
                Event::Stdout { data } => ready.push_str(&data.replace('\r', "")),
                event => panic!("Événement inattendu : {event:?}"),
            }
        }
        assert!(runs.start(String::new(), &path, Arc::new(|_| {})).is_err());
        runs.cancel().unwrap();
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Event::Exit { stopped: true, .. }
        ));
        let next = start(&runs, "", &path);
        assert!(matches!(
            next.recv_timeout(Duration::from_secs(12)).unwrap(),
            Event::Exit {
                code: Some(0),
                stopped: false
            }
        ));
        thread::sleep(Duration::from_millis(2200));
        assert!(!dir.path().join("escaped").exists());
    }
}
