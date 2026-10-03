# agent/

Sonde Java de Varia (protocole 1.2, `docs/probe-protocol.md`) : projet Maven construit HORS du projet
testé (`target/` ici, ou `-Dvaria.buildDir=<dossier>`), jamais installé dans le projet testé.

- `pom.xml` — ByteBuddy 1.15.11 embarqué et relocalisé (`maven-shade-plugin`), manifeste
  `Premain-Class`, copie de `junit-platform-console-standalone` 1.11.4 dans `target/lib/`, JaCoCo
  0.8.12 : règle `check` à 100 % lignes ET branches par classe (le build échoue sinon).
- `src/main` — la sonde ; `src/test` — tests JUnit (rejeu de toutes les fixtures de conformité,
  instrumentation réelle par ByteBuddyAgent, tests unitaires).

Construire : `mvn -q -f packages/adapters/junit/agent/pom.xml verify` (en ligne une première fois pour
résoudre les dépendances ; ensuite `-o`).
