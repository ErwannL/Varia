"""Plugin pytest de Varia, chargé par `-p varia_probe.plugin` (PYTHONPATH vers ce dossier, hors du projet).

Au chargement : crochet d'import (`sys.meta_path`) qui enveloppe les modules `targets.include`, crochets
asyncio, message `HELLO`. Pendant la session : début/fin de chaque test (identité de la norme),
sélection EXACTE d'un test par son nom complet, rapport JSON des résultats écrit hors du projet.
Hors d'un run Varia (variables absentes), le plugin n'a aucun effet.
"""

import asyncio
import json
import os
import sys

from . import probe as P

_SETUP = "VARIA_PYTEST_SETUP"
_REPORT = "VARIA_PYTEST_REPORT"
_SELECT = "VARIA_PYTEST_SELECT"


def test_name(nodeid):
    """Nom complet d'un test : identifiant pytest sans le fichier, « :: » remplacés par une espace."""
    return nodeid.partition("::")[2].replace("::", " ")


test_name.__test__ = False


def test_file(path, root):
    return os.path.relpath(os.path.realpath(str(path)), root).replace(os.sep, "/")


test_file.__test__ = False


class VariaPlugin:
    def __init__(self, env, state):
        self.env = env
        self.st = state
        setup = P._read_json(env.get(_SETUP)) or {}
        root = setup.get("projectRoot") or (state.project_root if state else os.getcwd())
        self.root = os.path.realpath(root)
        self.results = {}
        self.order = []

    def pytest_collection_modifyitems(self, config, items):
        wanted = self.env.get(_SELECT)
        if wanted is None:
            return
        keep = [i for i in items if test_name(i.nodeid) == wanted]
        dropped = [i for i in items if test_name(i.nodeid) != wanted]
        if dropped:
            config.hook.pytest_deselected(items=dropped)
        items[:] = keep

    def pytest_runtest_protocol(self, item, nextitem):
        if self.st is not None:
            P.start_test(self.st, test_file(item.path, self.root), test_name(item.nodeid))
        try:
            yield
        finally:
            if self.st is not None:
                P.end_test(self.st)

    pytest_runtest_protocol.hookwrapper = True

    def pytest_runtest_logreport(self, report):
        r = self.results.get(report.nodeid)
        if r is None:
            r = {"file": test_file(report.fspath, self.root), "name": test_name(report.nodeid),
                 "outcomes": [], "durationMs": 0.0}
            self.results[report.nodeid] = r
            self.order.append(report.nodeid)
        r["outcomes"].append((report.when, report.outcome))
        r["durationMs"] += report.duration * 1000

    def pytest_sessionfinish(self, session, exitstatus):
        path = self.env.get(_REPORT)
        if not path:
            return
        tests = []
        for nodeid in self.order:
            r = self.results[nodeid]
            tests.append({"file": r["file"], "name": r["name"], "status": status_of(r["outcomes"]),
                          "durationMs": r["durationMs"]})
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"tests": tests}, f)


def status_of(outcomes):
    """Statut d'un test d'après ses phases (setup, call, teardown)."""
    kinds = [o for _, o in outcomes]
    if "failed" in kinds:
        return "failed"
    if "skipped" in kinds:
        return "skipped"
    if ("call", "passed") in outcomes:
        return "passed"
    return "other"


def boot(env):
    """Démarrage : état de la sonde, crochets d'import et asyncio, `HELLO` ; puis plugin à enregistrer."""
    st = P.init(env)
    if st is not None:
        setup = P._read_json(env.get(_SETUP)) or {}
        targeting = P.Targeting(
            os.path.realpath(setup.get("projectRoot") or st.project_root),
            setup.get("include") or [],
            setup.get("exclude") or [],
        )
        sys.meta_path.insert(0, P.ImportHook(st, targeting))
        P.install_asyncio_hooks(st, asyncio.BaseEventLoop)
        P.hello(st)
    return VariaPlugin(env, st)


#: Démarré dès l'import du plugin (`-p`, avant les conftest du projet) : un module ciblé importé par un
#: conftest est déjà enveloppé.
PLUGIN = boot(os.environ)


def pytest_configure(config):
    if not config.pluginmanager.is_registered(PLUGIN):
        config.pluginmanager.register(PLUGIN, "varia-probe")
