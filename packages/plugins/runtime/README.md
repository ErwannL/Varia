# runtime/

`host.cjs` : hôte des extensions exécuté dans un `worker_threads` (chargement du module, appels,
`Math.random` interdit pendant l'appel, générateur mulberry32 fourni). Testé dans le processus de
test par `createRequire` (docs/notes/couverture.md).
