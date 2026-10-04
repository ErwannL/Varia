# Navigateur réel (E-09)

- `packages/dashboard/test/navigateur.test.ts` construit le tableau de bord (vite, dossier temporaire),
  le sert par la vraie API et mesure dans Chromium : chaque contrôle ≥ 44 × 44 px (les liens en ligne
  dans un texte ou un tableau sont exclus, WCAG 2.5.5), focus clavier visible (contour ≥ 2 px qui
  change réellement les pixels), à 1280 et 390 px.
- Navigateur : `VARIA_CHROMIUM`, sinon `/opt/pw-browsers/chromium`, sinon celui de `playwright-core`.
  La CI l'installe (`npx playwright-core install chromium`).
- Absent : le test ÉCHOUE. Seule échappatoire : déclarer `VARIA_BROWSER=absent`, et le test vérifie
  alors qu'aucun navigateur n'est réellement trouvable ; le rapport dit `UNVERIFIED`. Jamais de `.skip`.
- **Signature dans l'en-tête, jamais en pied** (comme les autres applications compagnes d'Orqea) : « Varia par Orqea »
  puis, SOUS le nom, « Propulsé par Orqea » et « Développé par Erwann Laplante » (`data-credit="owner"|"author"`). Ce sont des
  liens de texte : cible d'au moins 24 px mesurée dans Chromium (WCAG 2.2 AA, 2.5.8) ; les contrôles (boutons, navigation)
  gardent 44 px. Le rapport HTML porte la même signature en en-tête (plus de pied) ; le rapport Markdown la met en liens
  juste sous le titre. Un test échoue si un `<footer>` revient.
