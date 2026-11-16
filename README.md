# Neuron Studio

**Français** · [English](README.en.md)

Mini-IDE Python pour Windows. Le panneau de gauche affiche le rendu du programme et sa console. Monaco permet d’éditer le script à droite. Le code de l’éditeur est celui qui sera exécuté, y compris les modifications en mémoire.

## Installer sur Windows 10 ou 11 (x64)

1. Installez [Python 3 pour Windows](https://www.python.org/downloads/windows/) et cochez **Add python.exe to PATH**. Dans un nouveau PowerShell, vérifiez que `python --version` affiche Python 3.
2. [Téléchargez Neuron Studio pour Windows x64](https://github.com/dandyArise/neuron-studio-ide/releases/latest/download/Neuron-Studio-Windows-x64.exe), placez le fichier dans le dossier de votre choix et double-cliquez dessus. Cette version portable utilise le [runtime Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/). Si Windows signale qu’il manque, installez le runtime Evergreen x64 puis relancez Neuron.
3. Cliquez sur **Exécuter** pour essayer le script fourni. Pour tester votre propre code, cliquez sur **Nouveau**, tapez `print("Bonjour !")`, puis appuyez sur **F5**. La console doit afficher le message et un code de sortie 0.

La version distribuée cible Windows x64. Le backend utilise les API Windows pour les processus Python et le stockage des identifiants. L’assistant de code est facultatif.

## Premier lancement

L’exemple intégré entraîne un réseau sur dix motifs de chiffres 5 × 7 pendant environ huit secondes. Observer les pixels, les activations, les probabilités et la perte. Les messages ordinaires apparaissent dans la console, puis le code de sortie s’affiche. **Stop** interrompt l’exécution. Cette démonstration utilise la bibliothèque standard de Python et des motifs synthétiques.

**Ouvrir** (Ctrl+O) sélectionne un fichier Python UTF-8. **Enregistrer** (Ctrl+S) choisit une destination la première fois, puis écrit dans le fichier sélectionné. Taille maximale de 8 Mio. L’exécution du tampon ne sauvegarde pas automatiquement le fichier. Une seule exécution à la fois. La console reçoit stdout et stderr en continu, sans saisie interactive.

**Run auto** démarre le script, puis le relance 700 ms après la dernière modification. Si un programme tourne encore, Neuron attend sa fin après avoir demandé son arrêt. **Stop** annule aussi la relance. Le mode auto se désactive à l’ouverture ou à la création d’un autre document.

Faites glisser la bordure entre le rendu et la console pour régler leur hauteur. La séparation verticale règle la largeur de l’éditeur. Au clavier, sélectionnez une séparation avec Tab et utilisez les flèches correspondant à son orientation.

Les deux proportions de panneaux sont mémorisées sur ce poste et restaurées à la prochaine ouverture.

## Préférences

Ouvrez **⚙ Préférences** dans la barre du bas ou utilisez **Ctrl+,**. **Apparence** applique le thème, la police et la taille au code et à la console. Ces choix sont conservés entre les lancements. **Assistant LLM** regroupe le fournisseur, le contexte à joindre, le port, le modèle et le jeton du coffre Windows. Cliquez sur **Terminé** pour enregistrer les réglages du service.

## Assistant de code

Les boutons **🤖 Assistant** et **›_ Console**, en bas, ouvrent et referment les panneaux. Leur contenu reste disponible pendant la session. Chaque service garde sa propre discussion. Les derniers échanges complets accompagnent la prochaine demande dans la limite du contexte. **Nouvelle discussion** efface le fil du service actif.

Le champ de question est sous l’éditeur. **Réglages** ouvre la configuration dans une fenêtre séparée. **Terminé** enregistre le jeton dans le Gestionnaire d’identifiants Windows pour votre compte. Les ouvertures suivantes indiquent **Jeton enregistré dans Windows**. Vous pouvez le remplacer dans ce champ.

Cliquez sur **Assistant**, choisissez le service et le contexte à joindre (question seule, sélection ou fichier entier), puis **Demander**. Pour expliquer une fonction, sélectionnez-la dans Monaco et choisissez **Sélection**. Pour une correction applicable, demandez un bloc Python complet. Sous un bloc de réponse, **Insérer le code** ou **Remplacer la sélection** applique la proposition à la position d’origine et désactive Run auto. Ctrl+Z annule l’insertion. Un document modifié depuis la demande nécessite une nouvelle demande.

- **LM Studio** utilise le serveur HTTP local, par défaut sur le port 1234. Activez ce serveur, chargez un modèle de conversation et renseignez son identifiant si nécessaire. Si le serveur exige une authentification, saisissez le jeton dans le champ masqué de l’assistant.
- **Codex CLI** utilise la session du client Codex installé sur le poste. La question et le contexte choisi sont envoyés au service configuré dans ce client.

## Complétion et documentation Python

Tapez `import math`, puis `math.sq` sur la ligne suivante. La liste propose `sqrt`. **Ctrl+Espace** demande les suggestions à la position du curseur. Survolez un nom ou pressez **Ctrl+Q** sur le symbole pour lire sa documentation. Les signatures et docstrings proviennent de l’analyse locale du code et des bibliothèques disponibles pour l’interpréteur sélectionné.

## Prérequis Windows

L’exécutable nécessite WebView2 Runtime et un interpréteur Python 3 local. Le programme cherche `python.exe` dans le PATH. Pour choisir un environnement virtuel, définir `$env:NEURON_PYTHON` avec le chemin absolu de son `Scripts\python.exe` avant de lancer Neuron. Un fichier ouvert ou enregistré s’exécute dans son dossier. Le tampon initial utilise le dossier temporaire Windows.

Pour reconstruire, installer également Bun, Rust stable avec la cible MSVC et les outils de compilation Visual Studio pour C++ avec le SDK Windows. Ouvrir un nouveau PowerShell dans le dossier contenant ce README.

```powershell
bun install --frozen-lockfile
bun run tauri dev
```

Pour produire l’exécutable avec l’interface intégrée :

```powershell
bun run tauri build --no-bundle
```

Cargo place normalement le binaire dans `src-tauri/target/release/neuron.exe`. Si `CARGO_TARGET_DIR` est défini, consulter le sous-dossier `release` de cet emplacement. La commande `bun run build` contrôle TypeScript et génère l’interface seule. Utiliser la fenêtre desktop pour les fichiers et Python.

## Créer un script et dessiner dans le panneau live

**Nouveau** (Ctrl+N) ouvre un document Python vide. **Enregistrer** (Ctrl+S) permet de choisir son emplacement. Collez cet exemple dans un nouveau document et appuyez sur F5 :

```python
import json

svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160">
  <rect width="300" height="160" fill="#151718"/>
  <circle cx="150" cy="80" r="40" fill="coral"/>
</svg>"""
print("@live " + json.dumps({"svg": svg}), flush=True)
```

Chaque ligne `@live ` contient une image complète au format JSON et remplace l’image précédente. Pour animer, répétez l’envoi avec de nouvelles coordonnées. Le SVG accepte formes, chemins, texte, dégradés et images intégrées. Le panneau charge le SVG comme une image. Les interactions Python utilisent de nouvelles trames. Pour des pixels ou une figure Matplotlib, exportez en PNG dans un tampon puis envoyez `{"png": base64.b64encode(tampon.getvalue()).decode("ascii")}` avec le même préfixe. La limite est de 2 097 152 caractères par ligne JSON préfixée. Un `print()` ordinaire alimente toujours la console.

Les anciens scripts qui émettent des lignes `@neuron ` restent compatibles.

## Exécution locale

Les commandes desktop sont limitées à l’ouverture, la sauvegarde, l’exécution Python et l’arrêt. Le sélecteur de fichiers côté Rust détermine le chemin autorisé. Le backend démarre directement le processus et utilise un groupe de processus Windows pour l’arrêt. Python s’exécute avec les droits du compte Windows : ouvrir un fichier permet de l’inspecter, et cliquer sur Exécuter lance son code localement.

