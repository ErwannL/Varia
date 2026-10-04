# test/

Tests du dashboard (jsdom) : signature, iframe, accessibilité, contrastes, mouvement réduit ; arbre de
navigation et pagination dans l'URL (`e07.test.tsx`) ; pseudo-langue sur chaque page (`i18n-pseudo.test.tsx`) ; lanceur, extensions et `PLUGIN_FAILURE` (`plugins.test.tsx`).

`navigateur.test.ts` (E-09) mesure les cibles tactiles (≥ 44 px) et le focus visible dans un VRAI
Chromium sans interface, sur le dashboard construit depuis les sources (vite, dossier temporaire) et
servi par la vraie API. Navigateur : `VARIA_CHROMIUM`, puis `/opt/pw-browsers/chromium`, puis celui de
playwright-core. Sans navigateur, le test ÉCHOUE, sauf si `VARIA_BROWSER=absent` déclare l'absence :
il vérifie alors qu'aucun navigateur n'est trouvable (une fausse déclaration échoue) et E-09 est
`UNVERIFIED` sur cette machine — jamais « OK » sans mesure.
