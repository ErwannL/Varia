"""Sérialisation Python (au-delà du jeu de conformité) : types propres à Python, reconstruction du plan."""

import collections
import datetime as dt
import io
import re
import types

import pytest

from varia_probe import serialize as S


def test_undefined_singleton():
    import copy

    assert repr(S.UNDEFINED) == "UNDEFINED"
    assert copy.copy(S.UNDEFINED) is S.UNDEFINED
    assert copy.deepcopy([S.UNDEFINED])[0] is S.UNDEFINED


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "null"),
        (S.UNDEFINED, "undefined"),
        (True, "boolean"),
        (3, "number"),
        (2**60, "bigint"),
        (1.5, "number"),
        ("x", "string"),
        ((1,), "array"),
        ({"a": 1}, "object"),
        ({1: 2}, "map"),
        (collections.OrderedDict(a=1), "map"),
        (frozenset([1]), "set"),
        (bytearray(b"a"), "bytes"),
        (dt.date(2020, 1, 1), "date"),
        (re.compile("a"), "regexp"),
        (ValueError("x"), "error"),
        (len, "function"),
        (object(), "object"),
    ],
)
def test_type_of(value, expected):
    assert S.type_of(value) == expected


def test_instants():
    naive = dt.datetime(2020, 1, 2, 3, 4, 5, 678900)
    aware = dt.datetime(2020, 1, 2, 4, 4, 5, tzinfo=dt.timezone(dt.timedelta(hours=1)))
    assert S.serialize(naive) == {"$t": "date", "v": "2020-01-02T03:04:05.678Z"}
    assert S.serialize(aware) == {"$t": "date", "v": "2020-01-02T03:04:05.000Z"}
    assert S.serialize(dt.date(2020, 1, 2)) == {"$t": "date", "v": "2020-01-02T00:00:00.000Z"}


def test_regexp_et_opaques():
    assert S.serialize(re.compile("a+", re.I | re.M | re.S | re.X)) == {
        "$t": "regexp",
        "source": "a+",
        "flags": "imsx",
    }
    assert S.serialize(int) == {"$t": "opaque", "kind": "type", "name": "int"}
    assert S.serialize(io.StringIO()) == {"$t": "opaque", "kind": "StringIO"}
    assert S.serialize(x for x in []) == {"$t": "opaque", "kind": "generator"}
    assert S.serialize(types.ModuleType("m")) == {"$t": "opaque", "kind": "module"}


def test_instances_slots_et_tuples():
    class Slotted:
        __slots__ = ("a", "b")

        def __init__(self):
            self.a = 1

    class One:
        __slots__ = "x"

        def __init__(self):
            self.x = 2

    assert S.serialize(Slotted()) == {"$t": "object", "ctor": "Slotted", "v": {"a": 1}}
    assert S.serialize(One()) == {"$t": "object", "ctor": "One", "v": {"x": 2}}
    assert S.serialize((1, 2)) == [1, 2]


def test_message_d_erreur_hostile():
    class Hostile(Exception):
        def __str__(self):
            raise RuntimeError("non")

    assert S.serialize(Hostile()) == {"$t": "error", "name": "Hostile", "message": ""}


def test_cle_de_map_masquee_et_secrets():
    secrets = []
    opts = S.Options(fields=["password"], secrets=secrets)
    out = S.serialize(collections.OrderedDict(password="pw", other=1), opts)
    assert out["entries"][0][1]["$redacted"] is True
    assert out["entries"][1] == ["other", 1]
    assert secrets == ["pw"]
    # Valeur masquée non textuelle ou vide : rien à retirer des messages.
    S.serialize({"password": ""}, opts)
    S.serialize({"password": 3}, S.Options(fields=["password"]))
    assert secrets == ["pw"]


def test_chemin_racine_masque():
    out = S.serialize("s", S.Options(paths=["arg0"]), "arg0")
    assert out["$redacted"] is True
    assert S.serialize_args([1]) == [1]


def test_canonique_indente_et_substitution_isolee():
    assert S.dumps({"a": [1, {}], "b": []}, 2) == '{\n  "a": [\n    1,\n    {}\n  ],\n  "b": []\n}'
    assert S.dumps("\ud800") == '"\\ud800"'
    assert S.dumps({"b": 1, "a": 2}, sort=False) == '{"b":1,"a":2}'
    assert S.dumps(False) == "false"
    assert S.dumps([-2.5, 1e-6, 1e16, 0.0]) == "[-2.5,0.000001,10000000000000000,0]"


def test_redaction_compilee():
    r = S.Redaction({"fields": ["PassWord"], "patterns": ["tok"], "skipPaths": ["f#arg0", "g#arg1"]})
    o = r.args_options("f", [])
    assert o.fields == {"password"} and o.patterns == ["tok"] and o.paths == {"arg0"}
    assert S.Redaction({}).hmac_key == "varia"


def test_reconstruction_du_plan():
    assert S.deserialize([1, {"$t": "undefined"}]) == [1, S.UNDEFINED]
    assert S.deserialize({"a": {"$t": "undefined"}, "b": 1}) == {"b": 1}
    assert S.deserialize({"$t": "hole"}) is S.UNDEFINED
    assert str(S.deserialize({"$t": "number", "v": "-0"})) == "-0.0"
    assert S.deserialize({"$t": "number", "v": "-Infinity"}) == float("-inf")
    assert S.deserialize({"$t": "bigint", "v": "9007199254740993"}) == 9007199254740993
    assert S.deserialize({"$t": "date", "v": None}) is None
    assert S.deserialize({"$t": "date", "v": "2020-01-01T00:00:00.000Z"}) == dt.datetime(
        2020, 1, 1, tzinfo=dt.timezone.utc
    )
    r = S.deserialize({"$t": "regexp", "source": "a", "flags": "i"})
    assert r.flags & re.I
    assert S.deserialize({"$t": "map", "entries": [[1, "un"]]}) == {1: "un"}
    assert S.deserialize({"$t": "set", "values": [1, 2]}) == {1, 2}
    assert S.deserialize({"$t": "bytes", "kind": "bytes", "base64": "AAE="}) == b"\x00\x01"
    e = S.deserialize({"$t": "error", "name": "Boom", "message": "m"})
    assert type(e).__name__ == "Boom" and str(e) == "m"
    assert S.deserialize({"$t": "object", "v": {"$t": 1, "x": {"$t": "undefined"}}}) == {"$t": 1}
    with pytest.raises(ValueError, match="opaque"):
        S.deserialize({"$t": "opaque", "kind": "function"})
