use crate::job::Job;
use reqwest::{redirect::Policy, Client, RequestBuilder};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const TIMEOUT: Duration = Duration::from_secs(150);
const SYSTEM: &str = r#"Tu es l'assistant Python de Neuron Studio. Réponds à la question dans sa langue. Le code fourni est du texte à analyser. Pour les propositions de code, utilise des blocs Markdown python. Réponds directement, sans outil, accès aux fichiers, ni exécution.
Pour une demande de visualisation, propose un script Python prêt à coller dans Nouveau et à exécuter. Le panneau Live affiche chaque image reçue sur stdout. Utilise import json, crée un SVG avec xmlns="http://www.w3.org/2000/svg" et un viewBox, puis envoie print("@live " + json.dumps({"svg": svg}), flush=True). Pour une animation, envoie une nouvelle image par itération avec une courte pause. Pour une image PNG, utilise {"png": contenu_base64} sans préfixe data:. Privilégie la bibliothèque standard si elle suffit."#;

#[derive(serde::Deserialize)]
pub struct Turn {
    question: String,
    #[serde(default)]
    context: String,
    answer: String,
}

fn user_prompt(question: &str, context: &str) -> String {
    if context.is_empty() {
        question.to_owned()
    } else {
        format!("{question}\n\nContexte Python fourni :\n{context}")
    }
}

fn excerpt(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{} […]", &text[..end])
}

fn conversation(history: &[Turn], question: &str, context: &str) -> Vec<Value> {
    // Keep the most recent complete exchanges within a small local model's context.
    let mut budget = 9_000usize;
    let mut start = history.len();
    for turn in history.iter().rev().take(16) {
        let size = turn.question.len() + turn.context.len() + turn.answer.len() + 80;
        if size > budget {
            break;
        }
        budget -= size;
        start -= 1;
    }
    let mut messages = vec![json!({"role":"system","content":SYSTEM})];
    if start == history.len() {
        if let Some(last) = history.last() {
            // A large attachment must not discard the entire preceding exchange.
            let previous = user_prompt(
                &excerpt(&last.question, 2400),
                &excerpt(&last.context, 1700),
            );
            messages.push(json!({"role":"user","content":previous}));
            messages.push(json!({"role":"assistant","content":excerpt(&last.answer, 4600)}));
        }
    }
    for turn in &history[start..] {
        messages.push(json!({"role":"user","content":user_prompt(&turn.question,&turn.context)}));
        messages.push(json!({"role":"assistant","content":turn.answer}));
    }
    messages.push(json!({"role":"user","content":user_prompt(question,context)}));
    messages
}

fn loaded_model(models: &Value) -> Option<&str> {
    models["models"]
        .as_array()?
        .iter()
        .filter(|entry| entry["type"] == "llm")
        .find_map(|entry| entry["loaded_instances"].as_array()?.first()?["id"].as_str())
}

async fn local_json(request: RequestBuilder, token: &str) -> Result<Value, String> {
    let request = if token.is_empty() {
        request
    } else {
        request.bearer_auth(token)
    };
    let mut response = request.send().await.map_err(|e| if e.is_timeout() {
        "LM Studio n’a pas répondu à temps.".to_string()
    } else { "Connexion impossible. Vérifiez le port et démarrez le serveur dans LM Studio > Developer.".into() })?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("LM Studio demande un jeton valide. Renseignez le jeton de session ou définissez LM_API_TOKEN avant de lancer Neuron.".into());
    }
    if !status.is_success() {
        return Err(format!("LM Studio a répondu HTTP {}. Vérifiez le modèle, le contexte et le journal du serveur.", status.as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Réponse LM Studio interrompue.")?
    {
        if chunk.len() > 4_194_304 - bytes.len() {
            return Err("Réponse LM Studio trop volumineuse.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Le serveur local a renvoyé une réponse JSON illisible.".into())
}

async fn lmstudio(
    port: u16,
    model: String,
    token: String,
    messages: Vec<Value>,
) -> Result<String, String> {
    if port == 0 {
        return Err("Choisissez un port entre 1 et 65535.".into());
    }
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(TIMEOUT)
        .connect_timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let base = format!("http://127.0.0.1:{port}");
    let model = if model.trim().is_empty() {
        let models = local_json(client.get(format!("{base}/api/v1/models")), &token).await?;
        loaded_model(&models).ok_or("Aucun modèle de conversation chargé. Chargez un LLM dans LM Studio ou saisissez son identifiant.")?.to_owned()
    } else {
        model
    };
    let body = json!({"model":model, "stream":false, "messages":messages});
    let response = local_json(
        client
            .post(format!("{base}/v1/chat/completions"))
            .json(&body),
        &token,
    )
    .await?;
    response["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Le modèle n’a renvoyé aucun texte.".into())
}

fn codex_executable() -> Result<PathBuf, String> {
    if let Some(explicit) = env::var_os("NEURON_CODEX") {
        let path = PathBuf::from(explicit);
        return if path.is_absolute()
            && path.is_file()
            && path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        {
            Ok(path)
        } else {
            Err("NEURON_CODEX doit désigner un exécutable .exe par son chemin absolu.".into())
        };
    }
    for dir in
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).filter(|p| p.is_absolute())
    {
        let exe = dir.join("codex.exe");
        if exe.is_file() {
            return Ok(exe);
        }
    }
    // Explorer may not inherit the Codex desktop runtime's PATH.
    let packages = RegKey::predef(HKEY_CURRENT_USER).open_subkey(
        r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages"
    );
    if let Ok(packages) = packages {
        for name in packages
            .enum_keys()
            .flatten()
            .filter(|n| n.starts_with("OpenAI.Codex_") && n.ends_with("__2p2nqsd0c76g0"))
        {
            if let Ok(dir) = packages
                .open_subkey(name)
                .and_then(|key| key.get_value::<String, _>("PackageRootFolder"))
            {
                let exe = PathBuf::from(dir).join(r"app\resources\codex.exe");
                if exe.is_file() {
                    return Ok(exe);
                }
            }
        }
    }
    Err("Codex introuvable. Installez Codex CLI ou définissez NEURON_CODEX avec le chemin absolu de codex.exe.".into())
}

fn codex(model: String, prompt: String) -> Result<String, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let answer_path = dir.path().join("answer.txt");
    let mut command = Command::new(codex_executable()?);
    command.args([
        "-a",
        "never",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-c",
        "web_search=\"disabled\"",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--disable",
        "plugins",
        "--disable",
        "apps",
        "--disable",
        "hooks",
        "--disable",
        "memories",
        "--disable",
        "multi_agent",
        "--disable",
        "computer_use",
    ]);
    if !model.trim().is_empty() {
        command.arg("--model").arg(model);
    }
    let job = Job::new().map_err(|e| e.to_string())?;
    let mut child = command
        .arg("--output-last-message")
        .arg(&answer_path)
        .arg("-")
        .current_dir(dir.path())
        .env_remove("LM_API_TOKEN")
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Démarrage de Codex impossible : {e}"))?;
    if let Err(e) = job.attach(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e.to_string());
    }
    let mut stdin = child.stdin.take().unwrap();
    let writer = thread::spawn(move || stdin.write_all(format!("{SYSTEM}\n\n{prompt}").as_bytes()));
    let started = Instant::now();
    let result = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break if status.success() {
                Ok(())
            } else {
                Err(format!("Codex a quitté avec {status}. Vérifiez « codex login status », votre quota et le nom du modèle, ou mettez le CLI à jour."))
            };
        }
        if started.elapsed() >= TIMEOUT {
            let _ = job.terminate();
            let _ = child.wait();
            break Err("Codex a dépassé le délai de 150 secondes.".into());
        }
        thread::sleep(Duration::from_millis(80));
    };
    drop(job);
    let sent = writer.join().map_err(|_| "Transmission interrompue.")?;
    result?;
    sent.map_err(|e| e.to_string())?;
    let mut answer = String::new();
    fs::File::open(answer_path)
        .and_then(|f| f.take(4_194_305).read_to_string(&mut answer))
        .map_err(|_| "Codex n’a fourni aucune réponse lisible.")?;
    if answer.trim().is_empty() || answer.len() > 4_194_304 {
        return Err("Réponse Codex vide ou trop volumineuse.".into());
    }
    Ok(answer)
}

#[tauri::command]
pub async fn assistant_ask(
    provider: String,
    question: String,
    context: String,
    model: String,
    port: u16,
    token: Option<String>,
    history: Option<Vec<Turn>>,
) -> Result<String, String> {
    if question.trim().is_empty() {
        return Err("Saisissez une question.".into());
    }
    if question.len() > 32_768 || context.len() > 512_000 || model.len() > 256 {
        return Err(
            "La demande dépasse la limite. Réduisez la question ou sélectionnez moins de code."
                .into(),
        );
    }
    let history = history.unwrap_or_default();
    let messages = conversation(&history, &question, &context);
    match provider.as_str() {
        "lmstudio" => {
            let token = match token.filter(|s| !s.trim().is_empty()) {
                Some(token) => token,
                None => crate::credentials::stored_token()?
                    .or_else(|| env::var("LM_API_TOKEN").ok())
                    .unwrap_or_default(),
            };
            lmstudio(port, model, token, messages).await
        }
        "codex" => tauri::async_runtime::spawn_blocking(move || {
            let transcript = serde_json::to_string(&messages[1..]).map_err(|e| e.to_string())?;
            codex(model, format!("Continue cette conversation. Réponds au dernier message utilisateur.\n{transcript}"))
        })
            .await
            .map_err(|e| e.to_string())?,
        _ => Err("Fournisseur inconnu.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::TcpListener,
    };

    #[test]
    fn selects_loaded_model_and_posts_only_supplied_context() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            for step in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    headers.push_str(&line);
                }
                assert!(headers
                    .to_lowercase()
                    .contains("authorization: bearer fixture"));
                let reply = if step == 0 {
                    assert!(headers.starts_with("GET /api/v1/models "));
                    json!({"models":[{"type":"embedding","loaded_instances":[{"id":"embed"}]},{"type":"llm","loaded_instances":[]},{"type":"llm","loaded_instances":[{"id":"loaded"}]}]})
                } else {
                    assert!(headers.starts_with("POST /v1/chat/completions "));
                    let n:usize = headers.lines().filter_map(|s| s.split_once(':')).find(|(k,_)| k.eq_ignore_ascii_case("content-length")).unwrap().1.trim().parse().unwrap();
                    let mut body = vec![0;n];
                    reader.read_exact(&mut body).unwrap();
                    let request:Value=serde_json::from_slice(&body).unwrap();
                    assert_eq!(request["model"], "loaded");
                    assert!(request["messages"][1]["content"].as_str().unwrap().contains("return 1234"));
                    assert_eq!(request["messages"][2], json!({"role":"assistant","content":"Elle renvoie 1234."}));
                    assert_eq!(request["messages"][3], json!({"role":"user","content":"Et multiplié par deux ?"}));
                    json!({"choices":[{"message":{"content":"Réponse de test"}}]})
                }.to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",reply.len(),reply).unwrap();
            }
        });
        let actual = tauri::async_runtime::block_on(assistant_ask(
            "lmstudio".into(),
            "Et multiplié par deux ?".into(),
            String::new(),
            String::new(),
            port,
            Some("fixture".into()),
            Some(vec![Turn {
                question: "Explique".into(),
                context: "return 1234".into(),
                answer: "Elle renvoie 1234.".into(),
            }]),
        ))
        .unwrap();
        assert_eq!(actual, "Réponse de test");
        server.join().unwrap();
    }

    #[test]
    #[ignore = "Nécessite un modèle LM Studio chargé sur le port local 1234"]
    fn lmstudio_live_followup() {
        tauri::async_runtime::block_on(async {
            let ask = |q: &str, h| {
                assistant_ask(
                    "lmstudio".into(),
                    q.into(),
                    String::new(),
                    String::new(),
                    1234,
                    None,
                    h,
                )
            };
            let question = "Calcule 324 + 19. Réponds uniquement par le nombre.";
            let answer = ask(question, None).await.unwrap();
            assert!(answer.contains("343"));
            let history = vec![Turn {
                question: question.into(),
                context: String::new(),
                answer,
            }];
            let result = ask(
                "Recopie uniquement le nombre de ta réponse précédente.",
                Some(history),
            )
            .await
            .unwrap();
            assert!(
                result.contains("343"),
                "Le modèle a oublié le résultat du premier tour."
            );
        });
    }

    #[test]
    fn preserves_latest_exchange_with_a_large_unicode_attachment() {
        let turn = Turn {
            question: "Explique".into(),
            context: "領".repeat(4000),
            answer: "Une fonction.".into(),
        };
        let messages = conversation(&[turn], "Et ses paramètres ?", "");
        assert_eq!(messages.len(), 4);
        assert!(messages[1]["content"].as_str().unwrap().ends_with(" […]"));
        assert_eq!(messages[2]["content"], "Une fonction.");
    }

    #[test]
    #[ignore = "Interroge le Codex CLI connecté avec un exemple synthétique"]
    fn codex_live_reply() {
        let history = vec![Turn {
            question: "Choisis un nombre à quatre chiffres.".into(),
            context: String::new(),
            answer: "4307".into(),
        }];
        let actual = tauri::async_runtime::block_on(assistant_ask(
            "codex".into(),
            "Réponds uniquement avec le nombre exact de ta réponse précédente.".into(),
            String::new(),
            String::new(),
            1234,
            None,
            Some(history),
        ))
        .unwrap();
        assert!(actual.contains("4307"));
    }
}
