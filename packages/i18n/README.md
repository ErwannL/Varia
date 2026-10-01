# @varia/i18n

Textes visibles de Varia en **français et anglais** (`src/locales/fr.json`, `src/locales/en.json`) et
fonctions utilitaires : `t(locale, clé, params)`, `resolveLocale`, `orqeaUrl(env)`.

Règles : tout texte visible passe par une clé ; on conserve des clés dans l'état et on traduit au
rendu. Les clés de signature (`byline`, `poweredBy`, `author`, `backToOrqea`) sont imposées par le
prompt de lancement §4.1 et testées mot pour mot.

- `src/` — code et catalogues (`src/locales/`, données). `test/` — tests.
