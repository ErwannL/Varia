"""Sonde Python en processus : état, journal, erreurs, mutation, enveloppes, modules, asyncio."""

import asyncio
import importlib
import json
import os
import sys
import types

import pytest

from varia_probe import probe as P
from varia_probe import serialize as S


def make_state(tmp_path, mode="observe", plan=None, mutation_id=None, redact=None):
    run = tmp_path / "run"
    run.mkdir(exist_ok=True)
    (tmp_path / "targets.json").write_text(json.dumps({"runId": "r1", "projectRoot": str(tmp_path)}))
    (tmp_path / "redact.json").write_text(json.dumps(redact or {"fields": ["password"], "hmacKey": "k"}))
    env = {
        "VARIA_MODE": mode,
        "VARIA_RUN_DIR": str(run),
        "VARIA_TARGETS": str(tmp_path / "targets.json"),
        "VARIA_REDACT": str(tmp_path / "redact.json"),
    }
    if plan is not None:
        (tmp_path / "plan.json").write_text(json.dumps(plan))
        env["VARIA_PLAN"] = str(tmp_path / "plan.json")
        env["VARIA_MUTATION_ID"] = mutation_id
    return P.init(env)


def lines(st):
    with open(st.log_file, encoding="utf-8") as f:
        return [json.loads(x) for x in f.read().splitlines()]


def of_type(st, t):
    return [m for m in lines(st) if m["type"] == t]


def test_init_inactive_et_valeurs_par_defaut(tmp_path):
    assert P.init({}) is None
    assert P.init({"VARIA_MODE": "autre", "VARIA_RUN_DIR": "x"}) is None
    assert P.init({"VARIA_MODE": "observe"}) is None
    st = P.init({"VARIA_MODE": "fuzz", "VARIA_RUN_DIR": str(tmp_path), "VARIA_TARGETS": str(tmp_path / "absent")})
    assert (st.run_id, st.project_root, st.mutation) == ("", os.getcwd(), None)
    (tmp_path / "bad.json").write_text("{")
    assert P._read_json(str(tmp_path / "bad.json")) is None


def test_hello_et_ecriture_par_processus(tmp_path, monkeypatch):
    st = make_state(tmp_path)
    P.hello(st)
    first = st.log_file
    # Après un fork, le processus enfant écrit dans son propre fichier.
    monkeypatch.setattr(os, "getpid", lambda: 424242)
    P.hello(st)
    assert st.log_file != first and os.path.exists(st.log_file)
    monkeypatch.undo()
    hello = lines(st)[0]
    assert hello["type"] == "HELLO" and hello["protocolMinor"] == 2 and hello["mutationId"] is None
    assert hello["testId"] is None and hello["protocolVersion"] == 1 and hello["runId"] == "r1"


def test_probe_error_et_marqueur_stderr(tmp_path):
    st = make_state(tmp_path)
    P.probe_error(st, "wrap", ValueError("x"), module="m")
    assert of_type(st, "PROBE_ERROR")[0]["module"] == "m"
    err = []

    def broken(_line):
        raise OSError("disque plein")

    st.write = broken
    st.stderr = err.append
    P.probe_error(st, "outcome", ValueError("x"))
    assert err == ["[varia] PROBE_ERROR outcome\n"]

    def closed(_s):
        raise OSError("fermé")

    st.stderr = closed
    P.probe_error(st, "outcome", ValueError("x"))


def test_serialize_error():
    class Http(Exception):
        pass

    e = Http("refus hunter2")
    e.code = 7
    e.status = "422"
    out = P.serialize_error(e, ["hunter2"])
    assert out["message"] == "refus [REDACTED]" and out["code"] == "7" and out["status"] == 422
    assert out["constructorChain"][:3] == ["Http", "Exception", "BaseException"]
    os_err = OSError(2, "absent")
    assert P.serialize_error(os_err, [])["code"] == "2"
    for bad in (float("inf"), "abc", object(), 1e400):
        e = Exception("x")
        e.status = bad
        assert "status" not in P.serialize_error(e, [])
    e = Exception()
    e.status = 1.5
    assert P.serialize_error(e, [])["status"] == 1.5
    assert P.serialize_error("x", []) == {"name": "str", "message": "x", "stack": "", "constructorChain": []}

    class Hostile:
        def __str__(self):
            raise RuntimeError

    assert P.serialize_error(Hostile(), [])["message"] == ""


def test_pile_filtree():
    def target():
        raise ValueError("boum")

    try:
        target()
    except ValueError as e:
        stack = P.serialize_error(e, [])["stack"]
    assert "at target (" in stack and "test_probe.py:" in stack
    assert "_pytest" not in stack and "pluggy" not in stack


def test_mutation_sur_copie():
    args = [{"user": {"name": "Ada", "tags": ["a"]}}, (1, 2)]
    m = {"path": ["0", "user", "name"], "op": "set", "value": None}
    out = P.apply_mutation(args, m)
    assert out[0]["user"]["name"] is None and args[0]["user"]["name"] == "Ada"
    assert P.apply_mutation(args, {"path": ["0", "user", "tags", "0"], "op": "set", "value": 1})[0]["user"]["tags"] == [1]
    assert P.apply_mutation(args, {"path": ["1", "0"], "op": "set", "value": 9})[1] == (9, 2)
    assert P.apply_mutation(args, {"path": ["0", "user", "name"], "op": "delete"})[0]["user"] == {"tags": ["a"]}
    assert P.apply_mutation(args, {"path": ["0", "user", "name"], "op": "set", "value": {"$t": "undefined"}})[0]["user"] == {"tags": ["a"]}
    assert P.apply_mutation(args, {"path": ["1", "1"], "op": "delete"})[1] == (1, S.UNDEFINED)
    assert P.apply_mutation(args, {"path": ["0", "absent", "x"], "op": "set", "value": 1}) is None
    assert P.apply_mutation(args, {"path": ["0", "user", "tags", "9"], "op": "set", "value": 1}) is None
    assert P.apply_mutation(args, {"path": ["0", "user", "tags", "x"], "op": "set", "value": 1}) is None
    assert P.apply_mutation(args, {"path": ["0", "user", "name", "x"], "op": "set", "value": 1}) is None
    assert P.apply_mutation(["s"], {"path": ["0", "x"], "op": "set", "value": 1}) is None


def test_mutation_d_instance():
    class Box:
        def __init__(self):
            self.v = {"a": 1}

    out = P.apply_mutation([Box()], {"path": ["0", "v", "a"], "op": "set", "value": 2})
    assert out[0].v == {"a": 2}
    assert P.apply_mutation([Box()], {"path": ["0", "v"], "op": "set", "value": 3})[0].v == 3
    assert not hasattr(P.apply_mutation([Box()], {"path": ["0", "v"], "op": "delete"})[0], "v")
    assert P.apply_mutation([Box()], {"path": ["0", "w", "a"], "op": "set", "value": 1}) is None


def test_arguments_nommes():
    def f(a, b=0, *rest, c=1, **kw):
        return a

    assert P._split_kwargs(f, (1,), {}) == ([1], None)
    assert P._split_kwargs(f, (1,), {"b": 2, "c": 3}) == ([1, 2], {"c": 3})
    assert P._split_kwargs(f, (), {"b": 2}) == ([], {"b": 2})
    assert P._split_kwargs(f, (1,), {"b": 2}) == ([1, 2], None)
    assert P._split_kwargs(max, (), {"x": 1}) == ([], {"x": 1})
    assert P._call_parts([1, S.UNDEFINED, S.UNDEFINED], False) == ([1], {})
    assert P._call_parts([1, {"c": 3}], True) == ([1], {"c": 3})
    with pytest.raises(P.PathNotFound):
        P._call_parts([1, None], True)


def sample_module(name="mod_cible"):
    mod = types.ModuleType(name)
    exec(
        "import asyncio\n"
        "class Error(Exception):\n    pass\n"
        "def helper(a):\n    return a * 2\n"
        "def total(a, b=0):\n    return helper(a) + b\n"
        "def fail(m, **kw):\n    raise Error(m + ' hunter2')\n"
        "async def later(x):\n    await asyncio.sleep(0)\n    return total(x)\n"
        "async def refuse(x):\n    raise Error('non')\n"
        "def deferred(x):\n    return later(x)\n"
        "def opts(a, *, flag=False):\n    return flag\n"
        "def _private():\n    return 1\n",
        mod.__dict__,
    )
    mod.imported = json.dumps
    mod.Foreign = dict
    return mod


def test_module_enveloppe_et_appels(tmp_path):
    st = make_state(tmp_path)
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    assert isinstance(proxy, P.ProxyModule)
    discover = of_type(st, "DISCOVER")[0]
    assert discover["wrapped"] == ["helper", "total", "fail", "later", "refuse", "deferred", "opts"]
    assert discover["unsupported"] == ["Error"]
    P.wrap_module(st, sample_module(), "src/mod.py")
    assert len(of_type(st, "DISCOVER")) == 1
    P.start_test(st, "tests/t.py", "t")
    # Appel interne (helper par les globales du module) : non observé.
    assert proxy.total(2, b=1) == 5
    assert asyncio.run(proxy.later(3)) == 6
    assert asyncio.run(proxy.deferred(4)) == 8
    with pytest.raises(Exception, match="non"):
        asyncio.run(proxy.refuse(1))
    with pytest.raises(Exception, match="boum"):
        proxy.fail("boum", password="pw")
    P.end_test(st)
    calls = of_type(st, "OBSERVE_CALL")
    # Appels entre fonctions du même module (later → total, deferred → later) : non observés.
    assert [(c["export"], c["depth"]) for c in calls] == [
        ("total", 0),
        ("later", 0),
        ("deferred", 0),
        ("refuse", 0),
        ("fail", 0),
    ]
    # Argument nommé d'un paramètre positionnel : ramené à sa position.
    assert calls[0]["args"] == [2, 1]
    assert calls[-1]["args"][1]["password"]["$redacted"] is True
    returns = of_type(st, "TARGET_RETURN")
    assert [r["async"] for r in returns] == [False, True, True]
    assert of_type(st, "TARGET_REJECT")[0]["error"]["name"] == "Error"
    thrown = of_type(st, "TARGET_THROW")[0]["error"]
    assert thrown["message"] == "boum hunter2"
    assert of_type(st, "TEST_END")


def test_secret_retire_du_message(tmp_path):
    st = make_state(tmp_path, redact={"skipPaths": ["fail#arg0"]})
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    with pytest.raises(Exception):
        proxy.fail("pw")
    assert of_type(st, "TARGET_THROW")[0]["error"]["message"] == "[REDACTED] hunter2"


def test_hors_test_et_appels_nombreux(tmp_path):
    st = make_state(tmp_path)
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    proxy.helper(1)
    assert of_type(st, "OBSERVE_CALL")[0]["callSiteId"] is None
    P.start_test(st, "t.py", "t")
    for i in range(21):
        proxy.helper(i)
    calls = of_type(st, "OBSERVE_CALL")
    assert calls[-1]["argsOmitted"] is True and "args" not in calls[-1]
    P.end_test(st)
    P.start_test(st, "t.py", "t")
    assert st.current_test["testId"] == S.test_id("t.py", "t", 1)


def test_proxy_module():
    mod = sample_module()
    proxy = P.ProxyModule(mod, {"helper": lambda a: "enveloppe"})
    assert proxy.helper(1) == "enveloppe" and proxy.total(1) == 2
    assert proxy.__name__ == "mod_cible" and "helper" in dir(proxy)
    assert proxy._varia_original is mod and proxy.__class__ is P.ProxyModule
    proxy.helper = lambda a: "remplacé"
    assert mod.helper(1) == "remplacé" and proxy.helper(1) == "remplacé"
    proxy.extra = 1
    del proxy.extra
    assert not hasattr(mod, "extra")


def test_module_sans_fonction_et_all(tmp_path):
    st = make_state(tmp_path)
    mod = types.ModuleType("vide")
    mod.x = 1
    assert P.wrap_module(st, mod, "src/vide.py") is mod
    mod2 = sample_module("avec_all")
    mod2.__all__ = ["helper", 3]
    assert P.exported_names(mod2) == ["helper"]


def test_enveloppement_qui_echoue(tmp_path):
    st = make_state(tmp_path)

    class Hostile(types.ModuleType):
        def __getattribute__(self, name):
            if name == "boom":
                raise RuntimeError("getter")
            return super().__getattribute__(name)

    mod = Hostile("hostile")
    mod.__dict__["boom"] = 1
    P.wrap_module(st, mod, "src/h.py")
    assert of_type(st, "PROBE_ERROR")[0]["reason"] == "wrap"


def observed(tmp_path, call):
    st = make_state(tmp_path)
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    P.start_test(st, "t.py", "t")
    call(proxy)
    return of_type(st, "OBSERVE_CALL")[0]


def fuzz_state(tmp_path, site, **m):
    mutation = {"id": "m1", "callSiteId": site["callSiteId"], "argsFingerprint": site["argsFingerprint"]}
    mutation.update(m)
    sub = tmp_path / "fuzz"
    sub.mkdir(exist_ok=True)
    st = make_state(sub, mode="fuzz", plan={"mutations": [{"id": "autre"}, mutation]}, mutation_id="m1")
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    P.start_test(st, "t.py", "t")
    return st, proxy


def test_mutation_appliquee_une_fois(tmp_path):
    site = observed(tmp_path, lambda p: p.total(2, b=1))
    st, proxy = fuzz_state(tmp_path, site, path=["0"], op="set", value=10)
    assert proxy.total(2, b=1) == 21
    assert proxy.total(2, b=1) == 5
    mutate = of_type(st, "MUTATE_CALL")
    assert mutate == [dict(mutate[0], applied=True, mutationId="m1")]
    assert [c["mutated"] for c in of_type(st, "OBSERVE_CALL")] == [True, False]
    assert of_type(st, "HELLO") == [] and st.mutation["id"] == "m1"


def test_mutation_d_un_argument_nomme(tmp_path):
    site = observed(tmp_path, lambda p: p.opts(1, flag=False))
    assert site["args"] == [1, {"flag": False}]
    st, proxy = fuzz_state(tmp_path, site, path=["1", "flag"], op="set", value="oui")
    assert proxy.opts(1, flag=False) == "oui"
    # Le reste nommé remplacé par autre chose qu'un dictionnaire : appel impossible, non muté.
    st, proxy = fuzz_state(tmp_path, site, path=["1"], op="set", value=None)
    assert proxy.opts(1, flag=False) is False
    assert of_type(st, "MUTATE_CALL")[-1]["reason"] == "PATH_NOT_FOUND"


def test_mutation_refusee(tmp_path):
    site = observed(tmp_path, lambda p: p.total(2))
    st, proxy = fuzz_state(tmp_path, site, path=["0"], op="set", value=1)
    proxy.total(3)
    m = of_type(st, "MUTATE_CALL")[0]
    assert (m["applied"], m["reason"]) == (False, "AMBIGUOUS_CALL_SITE")
    assert m["expectedFingerprint"] == site["argsFingerprint"] and m["argsFingerprint"] != site["argsFingerprint"]
    st, proxy = fuzz_state(tmp_path, site, path=["0", "x"], op="set", value=1)
    assert proxy.total(2) == 4
    assert of_type(st, "MUTATE_CALL")[-1]["reason"] == "PATH_NOT_FOUND"


def test_echec_de_la_sonde(tmp_path):
    st = make_state(tmp_path)
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    P.start_test(st, "t.py", "t")
    real = st.write
    calls = {"n": 0}

    def flaky(line):
        calls["n"] += 1
        if '"OBSERVE_CALL"' in line or '"TARGET_RETURN"' in line:
            raise OSError("plein")
        real(line)

    st.write = flaky
    assert proxy.helper(2) == 4
    assert asyncio.run(proxy.later(1)) == 2
    st.write = real
    reasons = [e["reason"] for e in of_type(st, "PROBE_ERROR")]
    assert reasons.count("prepare") >= 2


def test_issue_qui_echoue(tmp_path):
    st = make_state(tmp_path)
    proxy = P.wrap_module(st, sample_module(), "src/mod.py")
    real = st.write

    def no_return(line):
        if '"TARGET_RETURN"' in line:
            raise OSError("plein")
        real(line)

    st.write = no_return
    assert proxy.helper(2) == 4
    assert of_type(st, "PROBE_ERROR")[0]["reason"] == "outcome"


def test_ciblage(tmp_path):
    t = P.Targeting(str(tmp_path), ["^src/"], ["^src/skip"])
    assert t.module_id(None) is None
    assert t.module_id(str(tmp_path / "src" / "a.py")) == "src/a.py"
    assert t.module_id(str(tmp_path / "src" / "skip.py")) is None
    assert t.module_id(str(tmp_path / "other.py")) is None
    assert t.module_id("/ailleurs/src/a.py") is None
    assert t.module_id(str(tmp_path / "src" / "site-packages" / "x.py")) is None


def test_crochet_d_import(tmp_path, monkeypatch):
    pkg = tmp_path / "src"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "cible_hook.py").write_text("def f(x):\n    return x\n")
    (tmp_path / "autre_hook.py").write_text("def g():\n    return 1\n")
    st = make_state(tmp_path)
    hook = P.ImportHook(st, P.Targeting(str(tmp_path), ["^src/"], []))

    class NoFind:
        pass

    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setattr(sys, "meta_path", [hook, NoFind()] + sys.meta_path)
    try:
        mod = importlib.import_module("src.cible_hook")
        other = importlib.import_module("autre_hook")
        assert isinstance(mod, P.ProxyModule) and mod.f(1) == 1
        assert not isinstance(other, P.ProxyModule)
        assert hook.find_spec("module_inexistant_varia") is None
        assert mod.__spec__.loader.get_filename("src.cible_hook").endswith("cible_hook.py")
    finally:
        for name in ("src", "src.cible_hook", "autre_hook"):
            sys.modules.pop(name, None)
    assert of_type(st, "DISCOVER")[-1] == dict(of_type(st, "DISCOVER")[-1], module="src/cible_hook.py", wrapped=["f"])


def test_rejet_non_gere_attribue(tmp_path):
    st = make_state(tmp_path)

    class Loop(asyncio.SelectorEventLoop):
        pass

    P.install_asyncio_hooks(st, Loop)
    P.install_asyncio_hooks(st, Loop)
    seen = []
    mod = types.ModuleType("notif")

    async def send(user):
        str.lower(user["email"])

    def schedule(user):
        asyncio.get_running_loop().create_task(send(user))
        return True

    mod.schedule = schedule
    schedule.__module__ = "notif"
    proxy = P.wrap_module(st, mod, "src/notif.py")
    P.start_test(st, "t.py", "t")

    async def main():
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: seen.append(ctx["message"]))
        assert proxy.schedule({"email": None}) is True
        await asyncio.sleep(0.01)
        # Tâche créée hors de toute cible : rejet non attribué.
        asyncio.get_running_loop().create_task(send({"email": 1}))
        await asyncio.sleep(0.01)

    loop = Loop()
    try:
        loop.run_until_complete(main())
    finally:
        loop.close()
    import gc

    gc.collect()
    loop.call_exception_handler({"message": "autre chose", "exception": ValueError()})
    rej = of_type(st, "UNHANDLED_REJECTION")
    assert len(rej) == 2
    call = of_type(st, "OBSERVE_CALL")[0]
    assert rej[0]["callId"] == call["callId"] and rej[0]["chain"] == [call["callId"]]
    assert rej[0]["error"]["name"] == "TypeError"
    assert "callId" not in rej[1] and rej[1]["callSiteId"] is None and rej[1]["chain"] == []
    assert len(seen) == 3


def test_rejet_non_gere_qui_echoue(tmp_path):
    st = make_state(tmp_path)
    real = st.write

    def broken(line):
        if "UNHANDLED_REJECTION" in line:
            raise OSError("plein")
        real(line)

    st.write = broken
    P.on_unhandled(st, ValueError("x"), None)
    assert of_type(st, "PROBE_ERROR")[0]["reason"] == "unhandled-rejection"


def test_profondeur_entre_modules(tmp_path):
    st = make_state(tmp_path)
    a = P.wrap_module(st, sample_module(), "src/a.py")
    b = types.ModuleType("mod_b")
    b.a = a
    exec(
        "import asyncio\n"
        "def via(x):\n    return a.helper(x)\n"
        "async def avia(x):\n    await asyncio.sleep(0)\n    return a.helper(x)\n",
        b.__dict__,
    )
    pb = P.wrap_module(st, b, "src/b.py")
    P.start_test(st, "t.py", "t")
    assert pb.via(1) == 2

    async def main():
        return await asyncio.gather(pb.avia(1), pb.avia(2))

    assert asyncio.run(main()) == [2, 4]
    calls = of_type(st, "OBSERVE_CALL")
    assert [(c["export"], c["depth"]) for c in calls] == [
        ("via", 0),
        ("helper", 1),
        ("avia", 0),
        ("avia", 0),
        ("helper", 1),
        ("helper", 1),
    ]
