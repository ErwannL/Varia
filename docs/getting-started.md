# Bien démarrer

```bash
git clone https://github.com/ErwannL/Varia ../varia
cd ../varia && npm ci && npm run build
cd ../mon-application
../varia/bin/varia doctor      # capacités réellement vérifiées sur VOTRE projet
../varia/bin/varia init        # crée un varia.yml minimal (facultatif)
../varia/bin/varia test        # baseline, plan (avec estimation), fuzz, rapport
../varia/bin/varia dashboard   # http://127.0.0.1:4321
```

Rien n'est ajouté au projet cible : les données vivent dans le répertoire utilisateur
(`~/.local/share/varia/projects/…` sous Linux), ou sous `--data-dir`. Pour garder la configuration hors
du projet : `varia --config chemin/varia.yml test`.

Rejouer un cas : `varia replay <mutation-id>` (identifiant affiché dans le résumé et le dashboard).
Reprendre un run interrompu : `varia fuzz --resume <run-id>`.
