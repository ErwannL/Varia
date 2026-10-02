# tests/setup

Fichiers chargés par Vitest avant chaque fichier de test.

- `child-coverage.ts` : pendant `npm run test:coverage`, propage `NODE_V8_COVERAGE` aux processus
  lancés par les tests et réduit leurs dépôts aux fichiers de Varia (docs/notes/couverture.md).
- `coverage-preload.cjs` : préchargé dans ces processus ; empêche la propagation aux runners du
  projet cible (Jest/Vitest), sauf pour le lanceur Vitest de Varia.
