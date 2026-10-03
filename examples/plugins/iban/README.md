# iban/

Stratégie `iban/invalid-iban` : pour une chaîne qui ressemble à un IBAN (ou un chemin nommé `iban`),
propose des variantes invalides DÉRIVÉES de la valeur d'origine (clé de contrôle fausse, pays
inconnu, trop court, trop long, caractère interdit, minuscules, espaces). Aucun aléa : même entrée ⇒
même sortie.
