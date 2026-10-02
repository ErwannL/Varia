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
