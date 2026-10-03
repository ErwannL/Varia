"""Sonde Varia pour Python (norme docs/probe-protocol.md, 1.2 ; équivalent de probe.cjs).

Elle n'a aucune politique : elle observe les appels des fonctions des modules ciblés, applique au plus
UNE mutation (sur une copie profonde des arguments) et écrit des JSONL. Elle est DÉFENSIVE : une erreur
de son propre code est signalée `PROBE_ERROR` et la cible est appelée sans mutation, avec ses arguments
d'origine. Aucun réseau, aucune écriture hors de `VARIA_RUN_DIR`, aucune modification du projet.
"""

import contextvars
import copy
import datetime as _dt
import functools
import importlib.abc
import inspect
import json
import math
import os
import re
import sys
import time
import traceback
import types
import weakref

from . import serialize as S

PROTOCOL_VERSION = 1
PROTOCOL_MINOR = 2
MAX_LOGGED_CALLS = 20
STDERR_MARKER = "[varia] PROBE_ERROR"
WRAPPED = "__varia_wrapped__"

#: Contexte d'appel courant (profondeur, chaîne d'appels) : suivi par `contextvars`, jamais par un
#: compteur global (les tâches asyncio copient le contexte à leur création).
CALL = contextvars.ContextVar("varia_call", default=None)

_HERE = os.path.dirname(os.path.abspath(__file__))
#: Cadres retirés des piles : la sonde, le lanceur (pytest, pluggy) et les cadres gelés de Python.
_HIDDEN = re.compile(r"[\\/](?:_pytest|pluggy)[\\/]|[\\/]site-packages[\\/]pytest[\\/]|^<frozen ")


class CallStore:
    __slots__ = ("depth", "call_id", "call_site_id", "chain", "secrets")

    def __init__(self, depth, call_id, call_site_id, chain, secrets):
        self.depth = depth
        self.call_id = call_id
        self.call_site_id = call_site_id
        self.chain = chain
        self.secrets = secrets


def _read_json(path):
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _now():
    t = _dt.datetime.now(_dt.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


class State:
    """État de la sonde dans un processus de test."""

    def __init__(self, env):
        self.mode = env["VARIA_MODE"]
        self.run_dir = env["VARIA_RUN_DIR"]
        targets = _read_json(env.get("VARIA_TARGETS")) or {}
        self.run_id = str(targets.get("runId", ""))
        self.project_root = str(targets.get("projectRoot") or os.getcwd())
        self.redaction = S.Redaction(_read_json(env.get("VARIA_REDACT")) or {})
        self.mutation = None
        if self.mode == "fuzz":
            plan = _read_json(env.get("VARIA_PLAN")) or {}
            wanted = env.get("VARIA_MUTATION_ID")
            self.mutation = next((m for m in plan.get("mutations") or [] if m.get("id") == wanted), None)
        self.current_test = None
        self.sequences = {}
        self.name_counts = {}
        self.call_counter = 0
        self.announced = set()
        self._fd = None
        self._fd_pid = None
        self.now = _now
        self.stderr = sys.stderr.write

    @property
    def log_file(self):
        return os.path.join(self.run_dir, "probe-%d.jsonl" % os.getpid())

    def write(self, line):
        # Écriture non tamponnée (os.write) : chaque ligne atteint le système avant de continuer et
        # survit à os._exit. Un processus enfant (fork) écrit dans son propre fichier.
        if self._fd_pid != os.getpid():
            self._fd = os.open(self.log_file, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            self._fd_pid = os.getpid()
        data = line.encode("utf-8", "surrogatepass")
        while data:
            data = data[os.write(self._fd, data):]


def init(env):
    """État de la sonde, ou `None` hors d'un run Varia (mode inconnu, dossier absent)."""
    if env.get("VARIA_MODE") not in ("observe", "fuzz") or not env.get("VARIA_RUN_DIR"):
        return None
    return State(env)


def emit(st, type_, fields):
    msg = {
        "protocolVersion": PROTOCOL_VERSION,
        "runId": st.run_id,
        "type": type_,
        "testId": st.current_test["testId"] if st.current_test else None,
        "timestamp": st.now(),
    }
    msg.update(fields)
    st.write(S.dumps(msg, sort=False) + "\n")


def probe_error(st, stage, e, **extra):
    """Erreur du code de la sonde : journalisée, jamais propagée ; marqueur stderr si le journal échoue."""
    try:
        fields = {"reason": stage, "error": serialize_error(e, [])}
        fields.update(extra)
        emit(st, "PROBE_ERROR", fields)
    except Exception:
        try:
            st.stderr("%s %s\n" % (STDERR_MARKER, stage))
        except Exception:
            pass


def _str(v):
    try:
        return str(v)
    except Exception:
        return ""


def _status(v):
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(n):
        return None
    return int(n) if n == int(n) else n


def _frames(e):
    tb = e.__traceback__
    frames = traceback.extract_tb(tb) if tb is not None else []
    out = []
    # Du plus interne au plus externe, comme une pile JavaScript ; colonnes à partir de 1.
    for f in reversed(frames):
        if f.filename.startswith(_HERE) or _HIDDEN.search(f.filename):
            continue
        col = (getattr(f, "colno", None) or 0) + 1
        out.append("    at %s (%s:%d:%d)" % (f.name, f.filename, f.lineno or 0, col))
    return out[:15]


def serialize_error(e, secrets):
    """Erreur sérialisée (§6), chaînes masquées retirées ; ne lève jamais."""

    def scrub(s):
        for x in secrets:
            s = s.replace(x, "[REDACTED]")
        return s

    if not isinstance(e, BaseException):
        return {"name": type(e).__name__, "message": scrub(_str(e)), "stack": "", "constructorChain": []}
    chain = [k.__name__ for k in type(e).__mro__ if k is not object][:10]
    out = {"name": scrub(type(e).__name__), "message": scrub(_str(e))}
    code = getattr(e, "errno", None)
    if code is None:
        code = getattr(e, "code", None)
    if code is not None:
        out["code"] = _str(code)
    status = _status(getattr(e, "status", None))
    if status is not None:
        out["status"] = status
    out["stack"] = scrub("\n".join(_frames(e)))
    out["constructorChain"] = chain
    return out


# --- Mutation (§9) ----------------------------------------------------------------------------


class PathNotFound(Exception):
    pass


def _child(container, seg):
    if isinstance(container, dict):
        if seg not in container:
            raise PathNotFound(seg)
        return container[seg]
    if isinstance(container, (list, tuple)):
        i = _index(container, seg)
        return container[i]
    if hasattr(container, "__dict__") and seg in vars(container):
        return vars(container)[seg]
    raise PathNotFound(seg)


def _index(container, seg):
    if not re.fullmatch(r"[0-9]+", seg) or int(seg) >= len(container):
        raise PathNotFound(seg)
    return int(seg)


def _put(container, seg, op, value):
    """Pose (ou retire) `seg` dans `container` ; renvoie le conteneur (un n-uplet est reconstruit)."""
    if isinstance(container, dict):
        if op == "delete" or value is S.UNDEFINED:
            container.pop(seg, None)
        else:
            container[seg] = value
        return container
    if isinstance(container, (list, tuple)):
        items = list(container)
        items[_index(items, seg)] = S.UNDEFINED if op == "delete" else value
        return items if isinstance(container, list) else type(container)(items)
    if hasattr(container, "__dict__"):
        if op == "delete" or value is S.UNDEFINED:
            vars(container).pop(seg, None)
        else:
            setattr(container, seg, value)
        return container
    raise PathNotFound(seg)


def _set_in(container, path, op, value):
    if len(path) == 1:
        return _put(container, path[0], op, value)
    child = _child(container, path[0])
    return _put(container, path[0], "set", _set_in(child, path[1:], op, value))


def apply_mutation(args, m):
    """Applique UNE mutation sur une copie profonde des arguments ; `None` si le chemin est absent."""
    path = [str(p) for p in m["path"]]
    value = None if m["op"] == "delete" else S.deserialize(m.get("value"))
    try:
        return _set_in(copy.deepcopy(list(args)), path, m["op"], value)
    except PathNotFound:
        return None


# --- Appels ------------------------------------------------------------------------------------


def _split_kwargs(fn, args, kwargs):
    """Arguments positionnels (mots-clés positionnels compris) et reste nommé (`None` si vide)."""
    pos = list(args)
    if not kwargs:
        return pos, None
    kw = dict(kwargs)
    try:
        params = list(inspect.signature(fn).parameters.values())
    except (TypeError, ValueError):
        params = []
    for p in params[len(pos):]:
        if p.kind is not p.POSITIONAL_OR_KEYWORD or p.name not in kw:
            break
        pos.append(kw.pop(p.name))
    return pos, (kw or None)


def _call_parts(values, has_kwargs):
    """Sépare la liste d'arguments (mutée) en positionnels et nommés ; retire les absents finaux."""
    pos = list(values[:-1] if has_kwargs else values)
    kw = values[-1] if has_kwargs else {}
    if not (isinstance(kw, dict) and all(isinstance(k, str) for k in kw)):
        raise PathNotFound("kwargs")
    while pos and pos[-1] is S.UNDEFINED:
        pos.pop()
    return pos, kw


def prepare_call(st, fn, args, kwargs, module_id, export):
    """Observation et mutation d'un appel : peut lever (valeurs hostiles), jamais la cible."""
    parent = CALL.get()
    depth = parent.depth + 1 if parent else 0
    test = st.current_test
    key = (module_id, export, depth)
    sequence = st.sequences.get(key, 0)
    st.sequences[key] = sequence + 1
    call_site_id = S.call_site_id(test["testId"], module_id, export, depth, sequence) if test else None
    st.call_counter += 1
    call_id = st.call_counter
    secrets = []
    opts = st.redaction.args_options(export, secrets)
    pos, kw = _split_kwargs(fn, args, kwargs)
    values = pos + ([kw] if kw is not None else [])
    serialized = S.serialize_args(values, opts)
    args_fp = S.fingerprint(serialized)
    call_args, call_kwargs = pos, kw or {}
    mutated = False
    m = st.mutation
    if m and call_site_id is not None and call_site_id == m.get("callSiteId"):
        base = {"callId": call_id, "callSiteId": call_site_id, "mutationId": m["id"]}
        if args_fp != m.get("argsFingerprint"):
            emit(st, "MUTATE_CALL", dict(base, applied=False, reason="AMBIGUOUS_CALL_SITE",
                                         expectedFingerprint=m.get("argsFingerprint"), argsFingerprint=args_fp))
        else:
            nxt = apply_mutation(values, m)
            try:
                if nxt is None:
                    raise PathNotFound("path")
                call_args, call_kwargs = _call_parts(nxt, kw is not None)
                mutated = True
                emit(st, "MUTATE_CALL", dict(base, applied=True))
            except PathNotFound:
                emit(st, "MUTATE_CALL", dict(base, applied=False, reason="PATH_NOT_FOUND"))
    fields = {
        "callId": call_id,
        "callSiteId": call_site_id,
        "module": module_id,
        "export": export,
        "depth": depth,
        "sequence": sequence,
        "argsFingerprint": args_fp,
        "mutated": mutated,
    }
    if sequence < MAX_LOGGED_CALLS:
        fields["args"] = serialized
    else:
        fields["argsOmitted"] = True
    emit(st, "OBSERVE_CALL", fields)
    chain = (parent.chain if parent else []) + [call_id]
    return CallStore(depth, call_id, call_site_id, chain, secrets), call_args, call_kwargs, opts


class _Call:
    """Issue d'un appel observé (retour, levée, rejet), jamais une erreur pour la cible."""

    def __init__(self, st, store, opts):
        self.st = st
        self.store = store
        self.opts = opts
        self.started = time.perf_counter()

    def outcome(self, type_, extra):
        try:
            fields = {
                "callId": self.store.call_id,
                "callSiteId": self.store.call_site_id,
                "durationMs": (time.perf_counter() - self.started) * 1000,
            }
            fields.update(extra())
            emit(self.st, type_, fields)
        except Exception as e:
            probe_error(self.st, "outcome", e, callId=self.store.call_id)

    def value(self, v):
        opts = S.Options(self.opts.fields, self.opts.patterns, self.opts.paths, self.opts.hmac_key, [])
        return S.serialize(v, opts, "return")

    def error(self, e):
        return serialize_error(e, self.store.secrets)


async def _observe_awaitable(call, awaitable):
    token = CALL.set(call.store)
    try:
        value = await awaitable
    except BaseException as e:
        call.outcome("TARGET_REJECT", lambda: {"error": call.error(e)})
        raise
    finally:
        CALL.reset(token)
    call.outcome("TARGET_RETURN", lambda: {"async": True, "value": call.value(value)})
    return value


def wrap_function(st, fn, module_id, export):
    """Enveloppe d'une fonction cible : synchrone, ou coroutine pour une fonction `async def`."""

    def prepare(args, kwargs):
        try:
            return prepare_call(st, fn, args, kwargs, module_id, export)
        except Exception as e:
            # Échec de la sonde : appel d'origine, sans mutation ni observation.
            probe_error(st, "prepare", e, module=module_id, export=export)
            return None

    if inspect.iscoroutinefunction(fn):

        @functools.wraps(fn)
        async def async_wrapper(*args, **kwargs):
            prepared = prepare(args, kwargs)
            if prepared is None:
                return await fn(*args, **kwargs)
            store, call_args, call_kwargs, opts = prepared
            call = _Call(st, store, opts)
            return await _observe_awaitable(call, fn(*call_args, **call_kwargs))

        wrapper = async_wrapper
    else:

        @functools.wraps(fn)
        def sync_wrapper(*args, **kwargs):
            prepared = prepare(args, kwargs)
            if prepared is None:
                return fn(*args, **kwargs)
            store, call_args, call_kwargs, opts = prepared
            call = _Call(st, store, opts)
            token = CALL.set(store)
            try:
                result = fn(*call_args, **call_kwargs)
            except BaseException as e:
                call.outcome("TARGET_THROW", lambda: {"error": call.error(e)})
                raise
            finally:
                CALL.reset(token)
            if inspect.iscoroutine(result):
                # Fonction synchrone qui rend une coroutine : son issue est observée à l'attente.
                return _observe_awaitable(call, result)
            call.outcome("TARGET_RETURN", lambda: {"async": False, "value": call.value(result)})
            return result

        wrapper = sync_wrapper
    setattr(wrapper, WRAPPED, fn)
    return wrapper


# --- Modules ciblés ----------------------------------------------------------------------------


def exported_names(module):
    """Noms exportés : `__all__` s'il existe, sinon les noms publics (sans `_` initial)."""
    names = getattr(module, "__all__", None)
    if names is None:
        names = [n for n in vars(module) if not n.startswith("_")]
    return [n for n in names if isinstance(n, str)]


class ProxyModule(types.ModuleType):
    """Module vu par les importeurs : exports enveloppés ; le module d'origine (et ses appels internes,
    qui passent par ses propres globales) reste intact, comme les liaisons locales d'un module JS."""

    def __init__(self, original, wrappers):
        super().__init__(original.__name__, original.__doc__)
        object.__setattr__(self, "_varia_original", original)
        object.__setattr__(self, "_varia_wrappers", wrappers)

    def __getattribute__(self, name):
        if name in ("_varia_original", "_varia_wrappers", "__class__"):
            return object.__getattribute__(self, name)
        wrappers = object.__getattribute__(self, "_varia_wrappers")
        if name in wrappers:
            return wrappers[name]
        return getattr(object.__getattribute__(self, "_varia_original"), name)

    def __setattr__(self, name, value):
        object.__getattribute__(self, "_varia_wrappers").pop(name, None)
        setattr(object.__getattribute__(self, "_varia_original"), name, value)

    def __delattr__(self, name):
        object.__getattribute__(self, "_varia_wrappers").pop(name, None)
        delattr(object.__getattribute__(self, "_varia_original"), name)

    def __dir__(self):
        return dir(object.__getattribute__(self, "_varia_original"))


def wrap_module(st, module, module_id):
    """Enveloppe les fonctions exportées d'un module ciblé ; renvoie le module à publier."""
    wrapped, unsupported, wrappers = [], [], {}
    for name in exported_names(module):
        try:
            value = getattr(module, name)
            if isinstance(value, type):
                if getattr(value, "__module__", None) == module.__name__:
                    unsupported.append(name)
            elif inspect.isfunction(value) and value.__module__ == module.__name__:
                wrappers[name] = wrap_function(st, value, module_id, name)
                wrapped.append(name)
        except Exception as e:
            probe_error(st, "wrap", e, module=module_id, export=name)
    if module_id not in st.announced:
        st.announced.add(module_id)
        emit(st, "DISCOVER", {"module": module_id, "wrapped": wrapped, "unsupported": unsupported})
    return ProxyModule(module, wrappers) if wrappers else module


def relative_posix(path, root, pathmod=os.path):
    """Chemin relatif en séparateurs POSIX ; None sur un autre volume (Windows : `relpath` lève)."""
    try:
        return pathmod.relpath(path, root).replace(pathmod.sep, "/")
    except ValueError:
        return None


class Targeting:
    """Module ciblé ? d'après `include` / `exclude` (expressions sur le chemin relatif POSIX)."""

    def __init__(self, project_root, include, exclude):
        self.root = project_root
        self.include = [re.compile(p) for p in include]
        self.exclude = [re.compile(p) for p in exclude]

    def module_id(self, filename):
        if not filename:
            return None
        # Bibliothèque standard sur C:, projet sur D: : hors projet, jamais une erreur d'import.
        rel = relative_posix(os.path.realpath(filename), self.root)
        if rel is None:
            return None
        parts = rel.split("/")
        if (
            rel.startswith("..")
            or "site-packages" in parts
            or not any(r.search(rel) for r in self.include)
            or any(r.search(rel) for r in self.exclude)
        ):
            return None
        return rel


class _Loader(importlib.abc.Loader):
    """Chargeur d'origine, puis publication du module enveloppé dans `sys.modules`."""

    def __init__(self, original, st, module_id):
        self._original = original
        self._st = st
        self._module_id = module_id

    def create_module(self, spec):
        return self._original.create_module(spec)

    def exec_module(self, module):
        self._original.exec_module(module)
        # Le système d'import relit `sys.modules` après exec_module : c'est ce module qui est publié.
        sys.modules[module.__name__] = wrap_module(self._st, module, self._module_id)

    def __getattr__(self, name):
        return getattr(self._original, name)


class ImportHook(importlib.abc.MetaPathFinder):
    """Crochet `sys.meta_path` : délègue la recherche aux autres chercheurs, enveloppe les cibles."""

    def __init__(self, st, targeting):
        self.st = st
        self.targeting = targeting

    def find_spec(self, name, path=None, target=None):
        for finder in sys.meta_path:
            if finder is self or not hasattr(finder, "find_spec"):
                continue
            spec = finder.find_spec(name, path, target)
            if spec is None:
                continue
            module_id = self.targeting.module_id(spec.origin)
            if module_id is not None and hasattr(spec.loader, "exec_module"):
                spec.loader = _Loader(spec.loader, self.st, module_id)
            return spec
        return None


# --- Rejets non gérés (asyncio) ----------------------------------------------------------------

_TASKS = weakref.WeakKeyDictionary()


def on_unhandled(st, exc, task):
    """Exception d'une tâche jamais récupérée : attribuée à l'appel qui a créé la tâche."""
    tag = _TASKS.get(task) if task is not None else None
    try:
        fields = {}
        if tag is not None:
            fields["callId"] = tag.call_id
        fields["callSiteId"] = tag.call_site_id if tag else None
        fields["chain"] = list(tag.chain) if tag else []
        fields["error"] = serialize_error(exc, tag.secrets if tag else [])
        emit(st, "UNHANDLED_REJECTION", fields)
    except Exception as e:
        probe_error(st, "unhandled-rejection", e)


def install_asyncio_hooks(st, loop_class):
    """Étiquette les tâches créées pendant un appel de cible ; observe les exceptions jamais récupérées
    (« Task exception was never retrieved ») avant le gestionnaire d'origine (comportement conservé)."""
    if getattr(loop_class, "_varia_hooked", False):
        loop_class._varia_state = st
        return
    loop_class._varia_hooked = True
    loop_class._varia_state = st
    create_task = loop_class.create_task
    handler = loop_class.call_exception_handler

    def varia_create_task(self, coro, *args, **kwargs):
        task = create_task(self, coro, *args, **kwargs)
        store = CALL.get()
        if store is not None:
            _TASKS[task] = store
        return task

    def varia_exception_handler(self, context):
        exc = context.get("exception")
        task = context.get("future")
        if exc is not None and "never retrieved" in str(context.get("message", "")):
            on_unhandled(loop_class._varia_state, exc, task)
        return handler(self, context)

    loop_class.create_task = varia_create_task
    loop_class.call_exception_handler = varia_exception_handler


# --- Tests -------------------------------------------------------------------------------------


def start_test(st, file, name):
    key = (file, name)
    rank = st.name_counts.get(key, 0)
    st.name_counts[key] = rank + 1
    st.current_test = {"testId": S.test_id(file, name, rank), "file": file, "name": name}
    st.sequences = {}
    emit(st, "TEST_START", {"file": file, "name": name})


def end_test(st):
    emit(st, "TEST_END", {})
    st.current_test = None


def hello(st):
    emit(st, "HELLO", {
        "protocolMinor": PROTOCOL_MINOR,
        "mode": st.mode,
        "pid": os.getpid(),
        "mutationId": st.mutation["id"] if st.mutation else None,
    })
