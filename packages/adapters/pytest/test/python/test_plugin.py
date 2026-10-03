"""Plugin pytest en processus : noms de tests, sélection exacte, rapport, démarrage."""

import json
import sys
import types

from varia_probe import plugin as G
from varia_probe import probe as P


def test_noms():
    assert G.test_name("tests/t.py::TestA::test_b[x-1]") == "TestA test_b[x-1]"
    assert G.test_name("tests/t.py::test_c") == "test_c"


def test_fichier_de_test_autre_volume():
    import ntpath

    assert G.test_file("D:\\p\\tests\\t.py", "D:\\p", ntpath) == "tests/t.py"
    assert G.test_file("C:\\t\\t.py", "D:\\p", ntpath) == "C:/t/t.py"


def test_statuts():
    assert G.status_of([("setup", "passed"), ("call", "failed")]) == "failed"
    assert G.status_of([("setup", "skipped")]) == "skipped"
    assert G.status_of([("setup", "passed"), ("call", "passed"), ("teardown", "passed")]) == "passed"
    assert G.status_of([("setup", "passed")]) == "other"


class Item:
    def __init__(self, nodeid, path):
        self.nodeid = nodeid
        self.path = path


class Hook:
    def __init__(self):
        self.deselected = []

    def pytest_deselected(self, items):
        self.deselected.extend(items)


def test_selection_exacte(tmp_path):
    plugin = G.VariaPlugin({"VARIA_PYTEST_SELECT": "test_a"}, None)
    items = [Item("t.py::test_a", tmp_path), Item("t.py::test_ab", tmp_path)]
    config = types.SimpleNamespace(hook=Hook())
    plugin.pytest_collection_modifyitems(config, items)
    assert [i.nodeid for i in items] == ["t.py::test_a"]
    assert [i.nodeid for i in config.hook.deselected] == ["t.py::test_ab"]
    # Rien à retirer : aucun appel à pytest_deselected.
    plugin.pytest_collection_modifyitems(config, items)
    assert len(config.hook.deselected) == 1
    # Sans sélection : tous les tests.
    G.VariaPlugin({}, None).pytest_collection_modifyitems(config, items)


def drive(plugin, item):
    gen = plugin.pytest_runtest_protocol(item, None)
    next(gen)
    try:
        next(gen)
    except StopIteration:
        pass


def report(nodeid, fspath, when, outcome, duration):
    return types.SimpleNamespace(nodeid=nodeid, fspath=fspath, when=when, outcome=outcome, duration=duration)


def test_debut_fin_et_rapport(tmp_path):
    (tmp_path / "targets.json").write_text(json.dumps({"runId": "r", "projectRoot": str(tmp_path)}))
    (tmp_path / "setup.json").write_text(json.dumps({"projectRoot": str(tmp_path)}))
    env = {
        "VARIA_MODE": "observe",
        "VARIA_RUN_DIR": str(tmp_path),
        "VARIA_TARGETS": str(tmp_path / "targets.json"),
        "VARIA_PYTEST_SETUP": str(tmp_path / "setup.json"),
        "VARIA_PYTEST_REPORT": str(tmp_path / "report.json"),
    }
    st = P.init(env)
    plugin = G.VariaPlugin(env, st)
    test_file = tmp_path / "tests" / "t.py"
    drive(plugin, Item("tests/t.py::test_x", test_file))
    with open(st.log_file) as f:
        types_ = [json.loads(x)["type"] for x in f]
    assert types_ == ["TEST_START", "TEST_END"] and st.current_test is None
    for when, outcome in (("setup", "passed"), ("call", "passed"), ("teardown", "passed")):
        plugin.pytest_runtest_logreport(report("tests/t.py::test_x", test_file, when, outcome, 0.001))
    plugin.pytest_sessionfinish(None, 0)
    out = json.loads((tmp_path / "report.json").read_text())
    assert out["tests"][0]["file"] == "tests/t.py" and out["tests"][0]["status"] == "passed"
    assert abs(out["tests"][0]["durationMs"] - 3) < 1e-6
    # Sonde inactive : crochets sans effet ; sans chemin de rapport : rien n'est écrit.
    idle = G.VariaPlugin({}, None)
    drive(idle, Item("tests/t.py::test_x", test_file))
    idle.pytest_sessionfinish(None, 0)


def test_demarrage(tmp_path, monkeypatch):
    assert isinstance(G.boot({}), G.VariaPlugin) and G.boot({}).st is None
    (tmp_path / "setup.json").write_text(json.dumps({"projectRoot": str(tmp_path), "include": ["^src/"]}))
    hooked = []
    monkeypatch.setattr(P, "install_asyncio_hooks", lambda st, cls: hooked.append(cls))
    monkeypatch.setattr(sys, "meta_path", list(sys.meta_path))
    plugin = G.boot({
        "VARIA_MODE": "observe",
        "VARIA_RUN_DIR": str(tmp_path),
        "VARIA_PYTEST_SETUP": str(tmp_path / "setup.json"),
    })
    assert isinstance(sys.meta_path[0], P.ImportHook) and hooked
    assert sys.meta_path[0].targeting.include[0].pattern == "^src/"
    with open(plugin.st.log_file) as f:
        assert json.loads(f.readline())["type"] == "HELLO"
    # Sans fichier de configuration : racine de la sonde, aucune cible.
    G.boot({"VARIA_MODE": "observe", "VARIA_RUN_DIR": str(tmp_path)})


def test_enregistrement():
    registered = {}

    class Manager:
        def is_registered(self, p):
            return p in registered

        def register(self, p, name):
            registered[p] = name

    config = types.SimpleNamespace(pluginmanager=Manager())
    G.pytest_configure(config)
    G.pytest_configure(config)
    assert registered == {G.PLUGIN: "varia-probe"}
