# com.orqea.varia.probe

- `Agent` — `premain` : configuration, sonde, gestionnaire des exceptions non attrapées,
  instrumentation ByteBuddy (Advice inséré dans les méthodes publiques des classes ciblées), DISCOVER.
- `Hooks` — points d'entrée publics appelés par le code inséré.
- `Probe` — état (variables `VARIA_*`), messages JSONL vidés ligne à ligne, call sites, mutation,
  issues (retour, levée, `CompletableFuture` réussie / en échec), exceptions non attrapées.
- `Serializer` — valeurs étiquetées, plafonds, redaction (clés de Map comprises), empreintes.
- `Errors` — sérialisation d'erreur (`constructorChain` = hiérarchie des classes, pile filtrée).
- `Values` — reconstruction des valeurs du plan, copie profonde, application d'UNE mutation.
- `Targets` — classes ciblées ↔ modules, nom et fichier des tests (identifiant unique JUnit).
- `Listener` — écouteur JUnit Platform (TEST_START / TEST_END), chargé par ServiceLoader.
- `Json` — JSON minimal, JSON canonique, SHA-256 / HMAC.
