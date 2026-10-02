# Zéro IA

Varia est fait de scripts et de règles déterministes : aucune dépendance, clé, appel réseau ni modèle
lié à une IA ou à un LLM, dans aucun paquet, sonde (quel que soit son langage), exemple ou script.

- Contrôle : `npm run check:no-ai` (`scripts/check-no-ai.mjs`, branché dans `check` et `check:fast`).
  Il lit les `package.json` et `package-lock.json` suivis (noms de paquets npm interdits), les
  manifestes d'autres langages (`requirements*.txt`, `composer.json`, `pom.xml`, `build.gradle`) et le
  code (`.js/.ts/.py/.php/.java/…`) : hôtes d'API, variables de clé (`*_API_KEY` des fournisseurs),
  imports de SDK. La documentation (`.md`) n'est pas analysée.
- Un nouveau langage de sonde ⇒ vérifier que ses fichiers sont couverts par `CODE_FILE` et ses
  manifestes par la liste du script, puis ajouter un cas au test `tests/quality-scripts.test.ts`.
- Les tests du contrôle assemblent les chaînes interdites à l'exécution pour que le dépôt reste propre.
