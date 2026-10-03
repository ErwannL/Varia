"""Rejeu du jeu de conformité de la norme (packages/probe-protocol/conformance/) par la sonde Python.

Chaque cas construit la valeur Python correspondant au vocabulaire neutre (`$in`), appelle la fonction
de la sonde et compare la sortie à `expected` (jokers `$match` et `$prefix`). Un cas portant sur un
concept absent de Python est déclaré non rejouable (liste NOT_REPLAYABLE), jamais compté réussi.
"""

import base64
from collections import OrderedDict
import datetime as dt
import hashlib
import json
import math
import os

import pytest

from varia_probe import probe as P
from varia_probe import serialize as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
CONFORMANCE = os.path.join(ROOT, "packages", "probe-protocol", "conformance")

#: Cas non rejouables en Python, avec leur raison (la sortie est tout de même vérifiée autrement).
NOT_REPLAYABLE = {
    # Un `set` Python n'a pas d'ordre d'insertion : la sonde ordonne les valeurs canoniquement
    # (empreintes stables d'un processus à l'autre). Contenu vérifié par test_set_ordre_canonique.
    "values/set": "ensemble sans ordre d'insertion en Python",
}


def manifest():
    with open(os.path.join(CONFORMANCE, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def all_cases():
    out = []
    for name in manifest()["files"]:
        with open(os.path.join(CONFORMANCE, "cases", name), encoding="utf-8") as f:
            out.extend(json.load(f)["cases"])
    return out


CASES = all_cases()


class Point:
    pass


def _error_class(names):
    base = Exception
    for n in reversed(names):
        base = type(n, (base,), {})
    return base


def build(j, parent=None):
    """Valeur Python du vocabulaire neutre (conformance/README.md)."""
    if j is None or isinstance(j, (bool, int, float, str)):
        return j
    if isinstance(j, list):
        out = []
        out.extend(build(x, out) for x in j)
        return out
    kind = j.get("$in")
    if kind is None:
        out = {}
        for k, v in j.items():
            out[k] = build(v, out)
        return out
    if kind == "object":
        out = {}
        for k, v in j["entries"]:
            out[k] = build(v, out)
        return out
    if kind == "instance":
        obj = type(j["class"], (Point,), {})()
        for k, v in j["entries"]:
            setattr(obj, k, build(v, obj))
        return obj
    if kind == "undefined":
        return S.UNDEFINED
    if kind == "number":
        return -0.0 if j["v"] == "-0" else float(j["v"].replace("Infinity", "inf"))
    if kind == "bigint":
        return int(j["v"])
    if kind == "date":
        return dt.datetime.fromisoformat(j["v"].replace("Z", "+00:00"))
    if kind == "map":
        # Table associative distincte d'un objet simple : OrderedDict (même à clés textuelles).
        return OrderedDict((build(k), build(v)) for k, v in j["entries"])
    if kind == "set":
        return {build(v) for v in j["values"]}
    if kind == "bytes":
        return base64.b64decode(j["base64"])
    if kind == "error":
        cls = _error_class(j.get("chain") or [])
        e = cls(j["message"])
        for field in ("code", "status"):
            if field in j:
                setattr(e, field, j[field])
        return e
    if kind == "function":
        f = lambda: None  # noqa: E731
        f.__name__ = j["name"]
        return f
    if kind == "string":
        return j["repeat"] * j["times"]
    if kind == "array":
        return [build(j["repeat"]) for _ in range(j["times"])]
    if kind == "nest":
        leaf = build(j["leaf"])
        for _ in range(j["depth"]):
            leaf = {j["key"]: leaf}
        return leaf
    assert kind == "self", kind
    return parent


def options(inp, secrets=None):
    red = S.Redaction(inp.get("redact") or {})
    return red.args_options(inp.get("export", "f"), secrets if secrets is not None else [])


def run_case(case):
    op, inp = case["op"], case["input"]
    if op == "serialize":
        return S.serialize(build(inp["value"]))
    if op == "serializeArgs":
        args = S.serialize_args(build(inp["args"]), options(inp))
        return {"args": args, "argsFingerprint": S.fingerprint(args)}
    if op == "serializeError":
        secrets = []
        S.serialize_args(build(inp.get("args") or []), options(inp, secrets))
        return P.serialize_error(build(inp["error"]), secrets)
    if op == "testId":
        return S.test_id(inp["file"], inp["name"], inp["rank"])
    if op == "callSiteId":
        return S.call_site_id(inp["testId"], inp["module"], inp["export"], inp["depth"], inp["sequence"])
    assert op == "canonical", op
    text = S.stable_stringify(inp["value"], inp["indent"])
    return {"text": text, "sha256": S.sha256(text)}


def same(actual, expected):
    """Égalité JSON stricte (-0 ≠ 0), jokers `$match` et `$prefix`."""
    if isinstance(expected, dict) and set(expected) == {"$match"}:
        return isinstance(actual, str)
    if isinstance(expected, dict) and set(expected) == {"$prefix"}:
        p = expected["$prefix"]
        return isinstance(actual, list) and len(actual) >= len(p) and all(
            same(a, e) for a, e in zip(actual, p)
        )
    if isinstance(expected, dict):
        return isinstance(actual, dict) and set(actual) == set(expected) and all(
            same(actual[k], expected[k]) for k in expected
        )
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            same(a, e) for a, e in zip(actual, expected)
        )
    if isinstance(expected, bool) or isinstance(actual, bool):
        return actual is expected
    if isinstance(expected, (int, float)):
        return (
            isinstance(actual, (int, float))
            and actual == expected
            and math.copysign(1, actual) == math.copysign(1, expected)
        )
    return actual == expected


def test_version_et_empreinte_du_jeu():
    m = manifest()
    assert m["protocolVersion"] == "%d.%d" % (P.PROTOCOL_VERSION, P.PROTOCOL_MINOR)
    h = hashlib.sha256()
    for name in sorted(os.listdir(os.path.join(CONFORMANCE, "cases"))):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(CONFORMANCE, "cases", name), "rb") as f:
            h.update(name.encode() + b"\0" + f.read() + b"\0")
    assert h.hexdigest() == m["sha256"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_cas_de_conformite(case):
    if case["id"] in NOT_REPLAYABLE:
        # Non rejouable : jamais compté réussi (xfail strict : réussir ici serait une incohérence).
        pytest.xfail(NOT_REPLAYABLE[case["id"]])
    actual = run_case(case)
    assert same(actual, case["expected"]), json.dumps(actual, ensure_ascii=False)
    # La sortie est du JSON (les messages sont écrits avec le même sérialiseur).
    json.loads(S.dumps(actual))


def test_set_ordre_canonique():
    out = S.serialize({3, "trois", S.UNDEFINED})
    assert out == {"$t": "set", "values": ["trois", 3, {"$t": "undefined"}]}


def test_comparateur_refuse_les_ecarts():
    assert not same(0.0, -0.0)
    assert not same([1], [1, 2])
    assert not same({"a": 1}, {"a": 1, "b": 2})
    assert not same(1, True)
    assert not same(1, {"$match": "string"})
    assert not same(["x"], {"$prefix": ["y"]})

