# @varia/dashboard

Dashboard local niveau 1 (CDC §26) en React + Vite, servi par `@varia/api` (`varia dashboard`).
Aucune ressource externe (polices système, SVG locaux), thème clair/sombre, FR/EN, navigation au
clavier, focus visible, cibles ≥ 44 px, états jamais signalés par la seule couleur, animations
coupées sous `prefers-reduced-motion`. Signature Orqea (prompt §4.1) ; « Retour sur Orqea » masqué
en `<iframe>`.

- `src/` — application. `public/` — fichiers de marque générés par `npm run brand` (ne pas éditer).
- `test/` — tests jsdom. `index.html`, `vite.config.ts` — construction (`npm run build -w @varia/dashboard`).
