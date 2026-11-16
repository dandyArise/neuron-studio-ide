# Neuron Studio

[Français](README.md) · **English**

Neuron Studio is a desktop Python IDE for Windows with a Monaco editor, live graphics, a streaming output console and an optional coding assistant. The app runs the current editor contents, including unsaved changes. The button names below match the French interface.

## Install on Windows 10 or 11 (x64)

1. Install [Python 3 for Windows](https://www.python.org/downloads/windows/) and enable **Add python.exe to PATH**. Open a new PowerShell window and check `python --version`.
2. [Download the Windows x64 executable](https://github.com/dandyArise/neuron-studio-ide/releases/latest/download/Neuron-Studio-Windows-x64.exe), move it to a folder of your choice and open it. If Windows reports a missing WebView2 runtime, install the [Microsoft Edge WebView2 Evergreen x64 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and reopen Neuron.
3. Click **Exécuter** or press **F5** to run the built-in digit recognition demo. To try your own script, click **Nouveau**, type `print("Hello!")` and press **F5**. The console displays the message and exit code 0.

## Editing and running scripts

- **Nouveau** (Ctrl+N), **Ouvrir** (Ctrl+O) and **Enregistrer** (Ctrl+S) create, open and save UTF-8 Python files up to 8 MiB. Running uses the current buffer. Click Save to write changes to disk.
- **Run auto** restarts the script 700 ms after editing stops. **Stop** interrupts the current process and cancels automatic restarts. Opening or creating a document switches automatic execution off.
- The console streams stdout and stderr and shows the exit status. Interactive stdin is unavailable. Resize panels by dragging their dividers or focusing a divider and using the arrow keys. Panel sizes persist between launches.
- Type `import math` and then `math.sq` on the next line to try Python completion. Ctrl+Space opens suggestions. Hover or press Ctrl+Q on a symbol for documentation from local analysis.
- **Préférences** (Ctrl+,) lets you choose a theme, code font and size. The Python preview updates immediately. You can import VS Code themes and switch between them later.

## Coding assistant

Open **🤖 Assistant** below the editor. In **Réglages**, choose the provider and the context to include (question alone, selected code or full file). **LM Studio** uses a local server on port 1234 by default. Load a chat model, specify its identifier if needed, and enter a token if the server requires one. **Terminé** saves the settings. The token is stored in Windows Credential Manager. **Codex CLI** uses the locally installed client and its configured service.

Choose **Demander** to send your question. Each provider keeps a conversation during the session. **Nouvelle discussion** clears the current thread. Use **Joindre à la question** for console output, or **Expliquer l’erreur** after a failed run to send the traceback and executed script. For a full-script fix, **Appliquer la correction** opens a preview. **Appliquer et relancer** applies it and runs the code. Ctrl+Z undoes the edit. If the document changes before applying a response, request a fresh correction.

## Draw from Python

Each stdout line starting with `@live ` can carry a JSON object with one complete SVG or base64-encoded PNG. Each frame replaces the previous one. Ordinary print calls go to the console. The maximum frame line is 2,097,152 characters.

```python
import json

svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><circle cx="100" cy="50" r="35" fill="coral"/></svg>'
print("@live " + json.dumps({"svg": svg}), flush=True)
```

For a Matplotlib figure, save it as PNG in a byte buffer and send `{"png": base64.b64encode(buffer.getvalue()).decode("ascii")}` with the same prefix. Legacy `@neuron ` frames are also supported.

## Local execution and development

Python runs directly with the permissions of the Windows account. The backend manages a Windows process group for cancellation. Opened and saved scripts run from their own folder. The initial buffer uses the Windows temporary folder. Neuron searches PATH for `python.exe`. To use a virtual environment, set `$env:NEURON_PYTHON` to the absolute path of its `Scripts\python.exe` before starting Neuron.

To build from source, install Bun, stable Rust with the MSVC toolchain, Visual Studio C++ Build Tools and the Windows SDK. From the project folder, run these commands in PowerShell.

```powershell
bun install --frozen-lockfile
bun run tauri dev
```

Use `bun run build` to type-check and build the frontend, or `bun run tauri build --no-bundle` to build the desktop executable. Cargo normally writes it to `src-tauri/target/release/neuron.exe`. If `CARGO_TARGET_DIR` is set, look in its `release` directory.
