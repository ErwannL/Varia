# @varia/adapter-junit

Adaptateur **JUnit 5 (Java)** (J4, R-04). Seul endroit (avec les autres `adapters/*`) autorisé à
connaître JUnit et Java. Stratégie d'injection retenue (méthode J0) : **agent Java**
(`-javaagent`, java.lang.instrument + ByteBuddy embarqué et relocalisé dans le jar de l'agent).

- `src/adapter.ts` — `JUnitAdapter` : `detect` (version de `junit-jupiter` du `pom.xml`), `prepare`
  (HORS du projet : chemin de classes par `mvn -o dependency:build-classpath` — hors ligne, aucun
  réseau —, compilation `javac` dans le dossier temporaire du run, configuration de l'agent :
  classes ciblées par `targets.include`/`exclude`), `run` (console JUnit Platform 1.11.4 +
  `-javaagent`, sélection `--select-method` / `--select-iteration`, rapport d'événements Open Test
  Reporting lu par `src/report.ts`, sous `runSupervised`).
- `src/ids.ts` — nom et fichier d'un test dérivés de l'identifiant unique JUnit (même règle que la
  sonde Java), sélecteurs de la console.
- `src/report.ts` — lecture du rapport `junit-platform-events-*.xml` (incomplet ⇒ `null`).
- `agent/` — sonde Java (projet Maven) ; construite par `npm run examples:install`.
- `test/` — tests (fonctions pures, exécution réelle, sonde Java via `mvn verify`, conformité).

Capacités déclarées : observation, mutation d'arguments, sélection par test, cibles asynchrones
(`CompletableFuture`), tests paramétrés, processus isolé. Non déclarées : `esm`/`cjs` (notions
JavaScript), `mocks`, `coverage`, `parallelSafe`. Limites : seules les méthodes **publiques** des
classes ciblées sont observées (appels internes à une méthode privée : listés `unsupported`) ;
constructeurs non observés ; une mutation d'un type impossible pour le paramètre Java n'est jamais
forcée (`SKIPPED` / `TYPE_MISMATCH`) ; pas de valeur « absente » distincte de `null`
(`UNDEFINED_UNSUPPORTED`, sauf clé de Map : retirée).
