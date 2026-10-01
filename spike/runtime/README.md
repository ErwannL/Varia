# spike/runtime/

Code exécuté dans le processus de test Jest : `probe.cjs` (setupFilesAfterEnv), `transform.cjs`
(transform D1 qui délègue au transform du projet), `serialize.cjs` (partagé avec l'orchestrateur).
Aucune dépendance, aucun réseau, état sur `globalThis.__varia`.
