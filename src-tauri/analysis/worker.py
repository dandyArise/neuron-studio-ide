"""Line-delimited JSON worker. Only the two embedded distributions enter sys.path."""
import json
import site
import sys
import sysconfig
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).parent
library_paths = list(sys.path)
library_paths.extend(site.getsitepackages())
library_paths.extend([sysconfig.get_path("purelib"), sysconfig.get_path("platlib")])
vendor = root / "vendor"
for filename in ("jedi.whl", "parso.whl"):
    with ZipFile(root / filename) as wheel:
        wheel.extractall(vendor)
sys.path.insert(0, str(vendor))

import jedi
from jedi.api.environment import InterpreterEnvironment

# The worker's import path never includes the document directory or site packages.
# Their source/stubs are available only through Jedi's static project search.
environment = InterpreterEnvironment()
jedi.settings.cache_directory = str(root / "cache")
last_items = []
generation = 0


def analyze(req):
    global last_items, generation
    mode = req["mode"]
    if mode == "detail":
        if req["generation"] != generation or not 0 <= req["index"] < len(last_items):
            return ""
        return last_items[req["index"]].docstring()[:6000]

    path = Path(req["path"]) if req["path"] else None
    directory = path.parent if path else root
    project = jedi.Project(directory, sys_path=[str(directory), *library_paths],
                           load_unsafe_extensions=False, smart_sys_path=False)
    script = jedi.Script(code=req["source"], path=path, project=project, environment=environment)
    line, column = req["line"], req["column"]
    if mode == "complete":
        last_items = script.complete(line, column)[:200]
        generation += 1
        return {"generation": generation, "items": [
            {"label": item.name, "kind": item.type} for item in last_items
        ]}
    if mode == "help":
        return "\n\n".join((item.docstring() or item.description) for item in script.help(line, column)[:2])[:8000]
    if mode == "signature":
        return [{"label": s.to_string(), "params": [p.to_string() for p in s.params], "index": s.index or 0}
                for s in script.get_signatures(line, column)[:6]]
    raise ValueError("Mode inconnu")


for message in sys.stdin:
    try:
        response = {"result": analyze(json.loads(message))}
    except Exception as exc:
        response = {"error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(response, ensure_ascii=True), flush=True)

