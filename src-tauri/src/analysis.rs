use crate::{files::{Document, LIMIT}, runner::interpreter};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::{BufRead, BufReader, Write}, os::windows::process::CommandExt,
    path::PathBuf, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex}};
use tauri::State;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Complete, Help, Signature, Detail }

#[derive(Deserialize, Serialize)]
pub struct Query {
    mode: Mode, source: Option<String>, line: Option<u32>, column: Option<u32>,
    generation: Option<u32>, index: Option<u32>,
    #[serde(skip_deserializing)]
    path: Option<PathBuf>,
}

struct Worker {
    child: Child, input: ChildStdin, output: BufReader<ChildStdout>,
    _dir: tempfile::TempDir,
}
impl Drop for Worker {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}

impl Worker {
    fn start() -> Result<Self, String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path();
        fs::write(path.join("jedi.whl"), include_bytes!("../analysis/jedi-0.20.1-py2.py3-none-any.whl")).map_err(|e| e.to_string())?;
        fs::write(path.join("parso.whl"), include_bytes!("../analysis/parso-0.8.7-py2.py3-none-any.whl")).map_err(|e| e.to_string())?;
        fs::write(path.join("worker.py"), include_str!("../analysis/worker.py")).map_err(|e| e.to_string())?;
        let mut child = Command::new(interpreter()?).args(["-I","-S","-B","-X","utf8","-u","worker.py"])
            .current_dir(path).creation_flags(0x08000000)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| e.to_string())?;
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Ok(Self { child, input, output, _dir: dir })
    }

    fn exchange(&mut self, query: Query) -> std::io::Result<Value> {
        serde_json::to_writer(&mut self.input, &query)?;
        self.input.write_all(b"\n")?;
        self.input.flush()?;
        let mut reply = String::new();
        self.output.read_line(&mut reply)?;
        Ok(serde_json::from_str(&reply)?)
    }
}

#[derive(Default)]
pub struct Analyzer(Arc<Mutex<Option<Worker>>>);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn completes_imports_and_reads_docs_without_running_document_or_module() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("example.py");
        let marker = folder.path().join("unexpected");
        let effect = format!("open({}, 'w').close()", json!(marker));
        fs::write(folder.path().join("neighbor.py"), format!(
            "{effect}\ndef orbit_radius(angle: float) -> float:\n    \"\"\"Radius for a given angle.\"\"\"\n    return angle\n"
        )).unwrap();
        let mut worker = Worker::start().unwrap();
        let mut query = |mode, source, line, column, generation, index| {
            let request = Query { mode, source: Some(source), line:Some(line), column:Some(column),
                generation, index, path:Some(path.clone()) };
            let reply = worker.exchange(request).unwrap();
            assert!(reply["error"].is_null(), "{reply}");
            reply["result"].clone()
        };
        let start = format!("{effect}\nimport neighbor\nneighbor.orb");
        let matches = query(Mode::Complete,start,3,12,None,None);
        assert_eq!(matches["items"][0]["label"],"orbit_radius");
        let doc = query(Mode::Detail,String::new(),0,0,Some(1),Some(0));
        assert!(doc.as_str().unwrap().contains("Radius for a given angle"));
        let math = query(Mode::Help,"import math\nmath.sqrt(4)".into(),2,7,None,None);
        assert!(math.as_str().unwrap().contains("square root"));
        let sig = query(Mode::Signature,"import neighbor\nneighbor.orbit_radius(".into(),2,22,None,None);
        assert!(sig[0]["label"].as_str().unwrap().contains("angle"));
        assert!(!marker.exists());
    }
}

#[tauri::command]
pub async fn analyze(mut query: Query, analyzer: State<'_, Analyzer>, document: State<'_, Document>) -> Result<Value, String> {
    if query.source.as_ref().is_some_and(|s| s.len() > LIMIT) { return Err("Document trop volumineux.".into()); }
    query.path = document.0.lock().unwrap().clone();
    let service = analyzer.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = service.lock().map_err(|e| e.to_string())?;
        if slot.is_none() { *slot = Some(Worker::start()?); }
        match slot.as_mut().unwrap().exchange(query) {
            Ok(reply) => match reply["error"].as_str() {
                Some(message) => Err(message.to_owned()),
                None => Ok(reply["result"].clone()),
            },
            Err(e) => { *slot = None; Err(format!("Analyse Python interrompue : {e}")) }
        }
    }).await.map_err(|e| e.to_string())?
}

