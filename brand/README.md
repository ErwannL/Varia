# brand/ — identité Varia (par Orqea)

**Nom :** Varia — application compagne d'Orqea. Signature : « Varia » + « par Orqea » (secondaire).

## Dessin

Un « V » blanc (la valeur attendue) sur une tuile violette, accompagné d'un point ambre décalé :
la **valeur perturbée** qui s'écarte du chemin. La version animée fait dériver doucement le point
et osciller le V (CSS seul, boucle de 3,6 s) ; sous `prefers-reduced-motion: reduce` l'animation est
coupée et l'image est exactement le logo fixe.

## Couleurs

| Rôle                  | Valeur    |
| --------------------- | --------- |
| Violet Varia (tuile)  | `#4B32D6` |
| Ambre perturbation    | `#FFC857` |
| Encre (fonds sombres) | `#14122B` |
| Blanc                 | `#FFFFFF` |
| Violet clair (accent) | `#7C6BF0` |

La tuile porte son propre fond : lisible sur clair comme sur sombre (voir `previews/`).

## Fichiers

- **Sources :** `varia.svg` (fixe), `varia-animated.svg` (animé), `og-image.svg` (partage 1200×630).
- **Dérivés** (ne pas éditer) : `png/varia-{16,32,48,180,192,512,1024}.png`, `png/og-image.png`,
  `favicon.ico` (16/32/48), copies dans `docs/assets/` et `packages/dashboard/public/`.
- `previews/` : captures réelles Chromium sans interface (mouvement normal / réduit).

## Usage

Animé : chargeur, survol du logo d'en-tête, `README.md`. Fixe : partout ailleurs.

## Régénération

```bash
npm run brand          # régénère tous les dérivés
npm run brand:check    # échoue si un dérivé diffère de sa source (testé dans tests/brand.test.ts)
node scripts/brand-preview.mjs   # recapture les aperçus
```
