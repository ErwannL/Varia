# varia_probe/

Sonde Varia en Python (norme `docs/probe-protocol.md` 1.2), bibliothèque standard seulement.

- `serialize.py` — valeurs étiquetées, plafonds, redaction (clés de dictionnaire comprises), JSON
  canonique (nombres et ordre des clés d'ECMAScript), empreintes, identités, reconstruction du plan.
- `probe.py` — état (variables `VARIA_*`), journal JSONL (`os.write` ligne à ligne), erreurs
  (`constructorChain` depuis la MRO), mutation sur `copy.deepcopy`, enveloppes sync/`async def`,
  profondeur par `contextvars`, `ProxyModule`, crochet `sys.meta_path`, tâches asyncio jamais récupérées.
- `plugin.py` — plugin pytest (`-p varia_probe.plugin`) : début/fin de test, sélection exacte,
  rapport JSON des résultats.
