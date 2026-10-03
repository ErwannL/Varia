import os
import sys
import time


def echo_value(x):
    """Renvoie l'argument tel quel, sans validation (ECHO)."""
    return {"received": x}


def repeat(label, count):
    """Termine pour un entier >= 0 ; boucle indéfiniment pour None, négatif, décimal, objet…"""
    n = count
    while n != 0:
        try:
            n = n - 1
        except TypeError:
            pass
    return label


def exit_on(flag):
    """« boom » : sortie brutale du processus (os._exit) ; « quit » : SystemExit (sys.exit)."""
    if flag == "boom":
        os._exit(1)
    if flag == "quit":
        sys.exit(2)
    return flag


def stamp(label):
    """Non déterministe."""
    return "%s:%d" % (label, time.time_ns())
