# Extensions externes (J4 X-02, X-03)

- **Appel synchrone borné d'un thread** : requête postée sur un `MessagePort`, attente par
  `Atomics.wait(flag, 0, 0, délai)`, réponse lue par `receiveMessageOnPort` ; le thread poste la
  réponse PUIS signale (`Atomics.store` + `Atomics.notify`). `worker.terminate()` interrompt une boucle
  synchrone infinie ; c'est la seule façon honnête de borner une extension qui boucle.
- Toujours écouter l'événement `error` d'un `Worker` (sinon une exception tardive du thread devient
  une exception du processus Varia) ; `stdout: true` + `resume()` pour que la sortie d'une extension
  ne pollue jamais `--json` ; `unref()` pour ne jamais retenir la fin du processus.
- Amorce du thread en `eval` (`require(workerData.host).start(workerData)`) : la logique vit dans
  `runtime/host.cjs`, testée DANS le processus de test par `createRequire` (la couverture d'un thread
  n'est pas mesurée).
- Ne pas lire `import.meta.url` au chargement d'un module partagé : sous jsdom (tests du tableau de
  bord, rapports) ce n'est pas une URL `file:` ⇒ calcul à l'usage (`hostPath()`).
- `Math.random` : la règle de lint interdit tout accès direct ; l'hôte le remplace par
  `Reflect.get/set(Math, 'random')`, temporairement, pendant l'appel.
- Couverture V8 des fichiers `runtime/` : un `if (…) { …; return }` suivi de code peut être rapporté
  avec une branche « sinon » à 0 alors qu'elle est exécutée ; préférer une table d'opérations ou un
  ternaire.
- YAML : `strategies: [null]` vaut `[null]` (valeur nulle), pas la stratégie `null` ⇒ `["null"]`.
- Spécificateur d'extension : un chemin relatif DOIT commencer par `.` (sinon c'est un nom de paquet).
