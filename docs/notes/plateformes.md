# Branches de plateforme

Règles apprises en J3 (CI Linux, macOS, Windows × Node 20/22).

- **Injection, pas de saut** : le code qui dépend de la plateforme (`killTree`, groupe de processus
  détaché, `taskkill`) reçoit la plateforme en paramètre (`packages/core/src/exec/proc.ts`) ; chaque
  branche est testée sur toutes les machines par injection. Aucun test n'est ignoré selon l'OS. La
  preuve réelle sous Windows reste `UNVERIFIED` tant qu'elle n'a pas été observée en CI.
- **Tubes asynchrones sous macOS** : `process.stdout.write` vers un tube est asynchrone sous macOS
  (synchrone sous Linux). Un processus de test qui écrit dans une boucle synchrone infinie ne vide
  jamais son tampon : écrire depuis un minuteur (`setInterval`) pour simuler une sortie illimitée.
- **URL `file:` sous Windows** : `fileURLToPath('file:///r/x')` lève (« must be absolute »). Dans les
  tests, construire les URL avec `pathToFileURL(resolve('/r', …))` ; dans le code, comparer des
  chemins normalisés en séparateurs POSIX (`split('\\').join('/')`).
- **Commandes shell** (`reset.database_command`) : exécutées par `sh` ou `cmd.exe`. Les tests utilisent
  une commande neutre (`node script.cjs …`) plutôt que `$VAR`, `echo >>` ou des guillemets imbriqués.
- **Séparateurs de la plateforme injectée** : une fonction qui reçoit `platform` construit ses chemins
  avec `path.win32` ou `path.posix` selon ce paramètre, jamais avec `path.join` de la machine qui
  exécute (`resolvePython` : `'/p/.venv/bin/python'` devenait `\p\.venv\bin\python` sous Windows).
- **Volumes distincts sous Windows** : `os.path.relpath` (Python) lève `ValueError` entre deux lecteurs
  (bibliothèque standard sur `C:`, projet sur `D:` en CI). Toute relativisation passe par
  `relative_posix` (sonde pytest) : autre volume ⇒ hors projet. Testé sous Linux avec `ntpath`.
- **Enfant tsx** : lancer `process.execPath` + `node_modules/tsx/dist/cli.mjs`, jamais
  `node_modules/.bin/tsx` (script shell, ENOENT sous Windows). Écouter `error` et garder le stderr de
  l'enfant pour le message d'échec. Dans un script généré, importer par `pathToFileURL(p).href` :
  `import 'D:\…'` est lu comme un schéma d'URL `d:` (ERR_UNSUPPORTED_ESM_URL_SCHEME).
- **Processus survivants** : `systemProcesses()` (`@varia/adapter-conformance` : `ps` ou PowerShell)
  au lieu de `ps -eo args` (le `ps` de Git Bash refuse `-o`) ; pas de garde `process.platform`.
- **Rapports d'outils natifs** (Clover, etc.) : chemins en séparateurs natifs ; normaliser en `/`
  avant de comparer.
