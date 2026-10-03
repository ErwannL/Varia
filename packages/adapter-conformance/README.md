# @varia/adapter-conformance

Suite de conformité des adapters (CDC §9.3). `runConformance({ adapter, example, dialect })` construit un
projet jetable (fichiers de premier niveau du projet d'exemple, `node_modules` lié, fichiers de
conformité), le fait passer par le moteur réel (`runBaseline`, `planRun`, `runFuzz`) et par l'adapter
(`prepare`, `run`), puis rend un rapport par vérification (`PASS` / `FAIL` / `UNVERIFIED`) :
baseline, observation, async, appels multiples, exception, test paramétré, sélection, mutation,
nettoyage. Le projet d'exemple n'est jamais modifié. Usage : `docs/writing-an-adapter.md`.

Ce paquet n'est importé ni par le cœur ni par le moteur.

Sous-dossiers : `src/`, `test/`.
