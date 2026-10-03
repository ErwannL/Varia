# Navigateur réel (E-09)

- `packages/dashboard/test/navigateur.test.ts` construit le tableau de bord (vite, dossier temporaire),
  le sert par la vraie API et mesure dans Chromium : chaque contrôle ≥ 44 × 44 px (les liens en ligne
  dans un texte ou un tableau sont exclus, WCAG 2.5.5), focus clavier visible (contour ≥ 2 px qui
  change réellement les pixels), à 1280 et 390 px.
- Navigateur : `VARIA_CHROMIUM`, sinon `/opt/pw-browsers/chromium`, sinon celui de `playwright-core`.
  La CI l'installe (`npx playwright-core install chromium`).
- Absent : le test ÉCHOUE. Seule échappatoire : déclarer `VARIA_BROWSER=absent`, et le test vérifie
  alors qu'aucun navigateur n'est réellement trouvable ; le rapport dit `UNVERIFIED`. Jamais de `.skip`.
