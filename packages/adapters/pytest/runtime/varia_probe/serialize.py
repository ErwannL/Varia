"""Sérialisation étiquetée, redaction, JSON canonique et identités (norme docs/probe-protocol.md, 1.2).

Équivalent Python de packages/probe-runtime/runtime/serialize.cjs : mêmes plafonds, mêmes chemins,
mêmes empreintes (rejoue packages/probe-protocol/conformance/). Aucune dépendance hors bibliothèque
standard ; aucune IA, aucun réseau.
"""

import base64
from collections.abc import Mapping
import datetime as _dt
import decimal
import hashlib
import hmac as _hmac
import io
import json
import math
import re
import socket
import types

MAX_DEPTH = 8
MAX_STRING = 4096
MAX_ITEMS = 200
MAX_SAFE_INTEGER = 2**53 - 1


class _Undefined:
    """Valeur « absente » (JS `undefined`) : argument omis, clé de dictionnaire retirée."""

    __slots__ = ()

    def __repr__(self):
        return "UNDEFINED"

    def __copy__(self):
        return self

    def __deepcopy__(self, memo):
        return self


UNDEFINED = _Undefined()

_OPAQUE_TYPES = (
    io.IOBase,
    socket.socket,
    types.GeneratorType,
    types.CoroutineType,
    types.AsyncGeneratorType,
    types.ModuleType,
    types.FrameType,
)
_FUNCTION_TYPES = (
    types.FunctionType,
    types.BuiltinFunctionType,
    types.MethodType,
    types.BuiltinMethodType,
)
_RE_FLAGS = ((re.IGNORECASE, "i"), (re.MULTILINE, "m"), (re.DOTALL, "s"), (re.VERBOSE, "x"))


def sha256(text):
    """Hexadécimal du SHA-256 des octets UTF-8 de `text`."""
    return hashlib.sha256(_utf8(text)).hexdigest()


def hmac_hex(key, text):
    return _hmac.new(_utf8(key), _utf8(text), hashlib.sha256).hexdigest()


def _utf8(text):
    # Une demi-paire de substitution isolée (impossible à encoder) est écrite comme JSON.stringify.
    return text.encode("utf-8", "surrogatepass")


def utf16_length(text):
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def test_id(file, name, rank):
    """Identité d'un test (§8.1)."""
    return "t_" + sha256("\0".join([file, name, str(rank)]))[:16]


test_id.__test__ = False  # nom commençant par « test » : jamais collecté par pytest


def call_site_id(test_id_, module, export, depth, sequence):
    """Identité d'un call site (§8.2)."""
    return "c_" + sha256("\0".join([test_id_, module, export, str(depth), str(sequence)]))[:16]


# --- JSON canonique (§10) ---------------------------------------------------------------------


def _js_number(v):
    """Nombre au format ECMAScript `Number.prototype.toString` (entiers et flottants finis)."""
    if isinstance(v, int):
        return str(v)
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    # Plus courte représentation exacte (repr), puis règles de mise en forme d'ECMAScript.
    _, digits_tuple, exp = decimal.Decimal(repr(abs(v))).as_tuple()
    digits = "".join(map(str, digits_tuple))
    stripped = digits.rstrip("0")
    exp += len(digits) - len(stripped)
    digits = stripped.lstrip("0")
    k = len(digits)
    n = k + exp
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    rest = "." + digits[1:] if k > 1 else ""
    return sign + digits[0] + rest + "e" + ("+" if e >= 0 else "-") + str(abs(e))


_LONE = re.compile("[\ud800-\udfff]")


def _js_string(s):
    out = json.dumps(s, ensure_ascii=False)
    return _LONE.sub(lambda m: "\\u%04x" % ord(m.group(0)), out)


def _is_index(key):
    return re.fullmatch(r"0|[1-9][0-9]*", key) is not None and int(key) <= 4294967294


def _key_order(key):
    # Clés « index » d'abord (valeur numérique), puis ordre des unités de code UTF-16.
    return (0, int(key), b"") if _is_index(key) else (1, 0, key.encode("utf-16-be", "surrogatepass"))


def dumps(value, indent=0, sort=True, _level=0):
    """JSON compact (indent 0) ou indenté de 2 espaces, nombres et chaînes comme ECMAScript."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return _js_string(value)
    pad = "\n" + " " * (indent * (_level + 1)) if indent else ""
    end = "\n" + " " * (indent * _level) if indent else ""
    sep = ": " if indent else ":"
    if isinstance(value, list):
        if not value:
            return "[]"
        items = [dumps(v, indent, sort, _level + 1) for v in value]
        return "[" + pad + ("," + pad).join(items) + end + "]"
    keys = sorted(value, key=_key_order) if sort else list(value)
    if not keys:
        return "{}"
    items = [_js_string(k) + sep + dumps(value[k], indent, sort, _level + 1) for k in keys]
    return "{" + pad + ("," + pad).join(items) + end + "}"


def stable_stringify(value, indent=0):
    return dumps(value, indent)


def fingerprint(serialized):
    """Empreinte des arguments (forme déjà redigée, §8.3)."""
    return sha256(stable_stringify(serialized))


# --- Sérialisation (§5) -----------------------------------------------------------------------


def _is_plain_dict(v):
    # Objet simple : un `dict` exact à clés textuelles. Toute autre table (clés non textuelles,
    # OrderedDict, sous-classe, MappingProxyType) est une table associative (`map`).
    return type(v) is dict and all(isinstance(k, str) for k in v)


def type_of(v):
    """Type runtime d'une valeur brute : celui de sa forme sérialisée."""
    if v is None:
        return "null"
    if v is UNDEFINED:
        return "undefined"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "number" if abs(v) <= MAX_SAFE_INTEGER else "bigint"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, (list, tuple)):
        return "array"
    if isinstance(v, Mapping):
        return "object" if _is_plain_dict(v) else "map"
    if isinstance(v, (set, frozenset)):
        return "set"
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "bytes"
    if isinstance(v, (_dt.datetime, _dt.date)):
        return "date"
    if isinstance(v, re.Pattern):
        return "regexp"
    if isinstance(v, BaseException):
        return "error"
    if isinstance(v, _FUNCTION_TYPES):
        return "function"
    return "object"


class Options:
    """Options de sérialisation (redaction compilée, plafonds, collecteur de secrets)."""

    def __init__(self, fields=(), patterns=(), paths=(), hmac_key="varia", secrets=None):
        self.fields = set(fields)
        self.patterns = list(patterns)
        self.paths = set(paths)
        self.hmac_key = hmac_key
        self.secrets = secrets

    def without_fields(self):
        return Options((), self.patterns, (), self.hmac_key, self.secrets)


def _date_iso(v):
    if not isinstance(v, _dt.datetime):
        v = _dt.datetime(v.year, v.month, v.day, tzinfo=_dt.timezone.utc)
    elif v.tzinfo is None:
        # Instant naïf : lu comme UTC (jamais l'heure locale de la machine, qui varie).
        v = v.replace(tzinfo=_dt.timezone.utc)
    v = v.astimezone(_dt.timezone.utc)
    return v.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (v.microsecond // 1000)


def _instance_fields(obj):
    if hasattr(obj, "__dict__"):
        return [(k, v) for k, v in vars(obj).items() if isinstance(k, str)]
    names = []
    for klass in type(obj).__mro__:
        slots = klass.__dict__.get("__slots__", ())
        names.extend([slots] if isinstance(slots, str) else slots)
    return [(n, getattr(obj, n)) for n in names if n not in ("__dict__", "__weakref__") and hasattr(obj, n)]


def _redacted_key(key, child_path, opts):
    return (
        key.lower() in opts.fields
        or child_path in opts.paths
        or any(re.search(p, key, re.IGNORECASE) for p in opts.patterns)
    )


def _redacted(raw, opts):
    if isinstance(raw, str) and raw and opts.secrets is not None:
        opts.secrets.append(raw)
    inner = _ser(raw, opts.without_fields(), "", 0, set())
    return {
        "$redacted": True,
        "fingerprint": hmac_hex(opts.hmac_key, stable_stringify(inner)),
        "type": type_of(raw),
    }


def _fields_out(pairs, opts, path, depth, seen):
    out = {}
    for key, raw in pairs[:MAX_ITEMS]:
        child = path + "." + key
        if _redacted_key(key, child, opts):
            out[key] = _redacted(raw, opts)
        else:
            out[key] = _ser(raw, opts, child, depth + 1, seen)
    return out


def _ser(value, opts, path, depth, seen):
    if value is None or isinstance(value, bool):
        return value
    if value is UNDEFINED:
        return {"$t": "undefined"}
    if isinstance(value, int):
        return value if abs(value) <= MAX_SAFE_INTEGER else {"$t": "bigint", "v": str(value)}
    if isinstance(value, float):
        if math.isnan(value):
            return {"$t": "number", "v": "NaN"}
        if math.isinf(value):
            return {"$t": "number", "v": "Infinity" if value > 0 else "-Infinity"}
        if value == 0 and math.copysign(1.0, value) < 0:
            return {"$t": "number", "v": "-0"}
        return value
    if isinstance(value, str):
        n = utf16_length(value)
        if n > MAX_STRING:
            return {"$t": "string", "truncated": True, "length": n, "sha256": sha256(value)}
        return value
    if isinstance(value, _FUNCTION_TYPES):
        return {"$t": "opaque", "kind": "function", "name": str(getattr(value, "__name__", ""))}
    if isinstance(value, type):
        return {"$t": "opaque", "kind": "type", "name": value.__name__}
    if isinstance(value, _OPAQUE_TYPES):
        return {"$t": "opaque", "kind": type(value).__name__}
    if id(value) in seen:
        return {"$t": "circular"}
    kind = type_of(value)
    if depth >= MAX_DEPTH:
        return {"$t": "truncated", "type": kind}
    seen.add(id(value))
    try:
        return _ser_container(value, kind, opts, path, depth, seen)
    finally:
        seen.discard(id(value))


def _ser_container(value, kind, opts, path, depth, seen):
    if kind == "date":
        return {"$t": "date", "v": _date_iso(value)}
    if kind == "regexp":
        flags = "".join(c for f, c in _RE_FLAGS if value.flags & f)
        return {"$t": "regexp", "source": str(value.pattern), "flags": flags}
    if kind == "error":
        return {"$t": "error", "name": type(value).__name__, "message": _safe_str(value)}
    if kind == "bytes":
        data = bytes(value)
        return {"$t": "bytes", "kind": type(value).__name__, "base64": base64.b64encode(data).decode("ascii")}
    if kind == "set":
        items = [_ser(v, opts, "%s[%d]" % (path, i), depth + 1, seen) for i, v in enumerate(value)]
        # Un ensemble Python n'a pas d'ordre d'insertion (ordre de hachage, variable d'un processus à
        # l'autre) : ordre canonique, pour des empreintes stables.
        items.sort(key=lambda x: stable_stringify(x).encode("utf-16-be", "surrogatepass"))
        return {"$t": "set", "values": items[:MAX_ITEMS]}
    if kind == "map":
        entries = []
        for i, (k, v) in enumerate(list(value.items())[:MAX_ITEMS]):
            key = _ser(k, opts, "%s.<key%d>" % (path, i), depth + 1, seen)
            if isinstance(k, str) and _redacted_key(k, path + "." + k, opts):
                entries.append([key, _redacted(v, opts)])
            else:
                entries.append([key, _ser(v, opts, "%s.<value%d>" % (path, i), depth + 1, seen)])
        return {"$t": "map", "entries": entries}
    if kind == "array":
        out = [_ser(v, opts, "%s[%d]" % (path, i), depth + 1, seen) for i, v in enumerate(value[:MAX_ITEMS])]
        if len(value) > MAX_ITEMS:
            return {"$t": "array", "truncated": True, "length": len(value), "items": out}
        return out
    if _is_plain_dict(value):
        fields = _fields_out(list(value.items()), opts, path, depth, seen)
        return {"$t": "object", "v": fields} if "$t" in fields or "$redacted" in fields else fields
    fields = _fields_out(_instance_fields(value), opts, path, depth, seen)
    return {"$t": "object", "ctor": type(value).__name__, "v": fields}


def _safe_str(v):
    try:
        return str(v)
    except Exception:
        return ""


def serialize(value, opts=None, root=""):
    """Sérialise une valeur racine (chemin de base `root`, ex. « arg0 »)."""
    opts = opts or Options()
    if root in opts.paths:
        return _redacted(value, opts)
    return _ser(value, opts, root, 0, set())


def serialize_args(args, opts=None):
    opts = opts or Options()
    return [serialize(a, opts, "arg%d" % i) for i, a in enumerate(args)]


class Redaction:
    """Contenu compilé de `VARIA_REDACT` (`fields`, `patterns`, `skipPaths`, `hmacKey`)."""

    def __init__(self, raw):
        self.fields = {str(f).lower() for f in raw.get("fields") or []}
        self.patterns = [str(p) for p in raw.get("patterns") or []]
        self.skip_paths = [str(p) for p in raw.get("skipPaths") or []]
        self.hmac_key = str(raw.get("hmacKey") or "varia")

    def args_options(self, export, secrets):
        prefix = export + "#"
        paths = [p[len(prefix):] for p in self.skip_paths if p.startswith(prefix)]
        return Options(self.fields, self.patterns, paths, self.hmac_key, secrets)


# --- Reconstruction (valeurs du plan, §9) ------------------------------------------------------


def _drop_undefined(d):
    # Clé « absente » : retirée du dictionnaire (équivalent Python d'une propriété `undefined`).
    return {k: v for k, v in d.items() if v is not UNDEFINED}


def deserialize(j):
    """Reconstruit une valeur Python à partir de sa forme étiquetée."""
    if j is None or isinstance(j, (bool, int, float, str)):
        return j
    if isinstance(j, list):
        return [deserialize(x) for x in j]
    t = j.get("$t")
    if t is None:
        return _drop_undefined({k: deserialize(v) for k, v in j.items()})
    if t in ("undefined", "hole"):
        return UNDEFINED
    if t == "number":
        return -0.0 if j["v"] == "-0" else float(j["v"].replace("Infinity", "inf"))
    if t == "bigint":
        return int(j["v"])
    if t == "date":
        return None if j["v"] is None else _dt.datetime.fromisoformat(j["v"].replace("Z", "+00:00"))
    if t == "regexp":
        flags = 0
        for f, c in _RE_FLAGS:
            if c in j["flags"]:
                flags |= f
        return re.compile(j["source"], flags)
    if t == "map":
        return {deserialize(k): deserialize(v) for k, v in j["entries"]}
    if t == "set":
        return {deserialize(v) for v in j["values"]}
    if t == "bytes":
        return base64.b64decode(j["base64"])
    if t == "error":
        return type(str(j["name"]), (Exception,), {})(j["message"])
    if t == "object":
        return _drop_undefined({k: deserialize(v) for k, v in j["v"].items()})
    raise ValueError("valeur non reconstructible : " + str(t))

