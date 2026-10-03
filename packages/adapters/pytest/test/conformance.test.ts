// Suite de conformité d'adapter (CDC §9.3) contre l'adapter pytest RÉEL, sur un projet jetable construit
// à partir de examples/pytest-project (environnement virtuel lié). Dialecte Python : mêmes cibles et
// mêmes noms de tests que les fichiers JavaScript de la suite. Un nom pytest est l'identifiant du test
// sans le fichier (« classe test ») : un conftest du projet jetable collecte les cas sous un groupe
// `conformance` dont les éléments s'appellent `observe`, `param 1`… (noms complets identiques).
import { PytestAdapter } from '@varia/adapter-pytest'
import { runConformance, TESTS } from '@varia/adapter-conformance'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TARGET = `import asyncio


class ConformanceError(Exception):
    pass


def greet(user):
    return "Hello " + user["name"]


async def fetchLater(id):
    await asyncio.sleep(0)
    return {"id": id}


def add(a, b):
    return a + b


def fail(message):
    raise ConformanceError(message)


def double(n):
    return n * 2
`

const CASES = `import asyncio

import pytest

from src.conformance import add, double, fail, fetchLater, greet


def observe():
    assert greet({"name": "Ada"}) == "Hello Ada"


def async_():
    assert asyncio.run(fetchLater(7)) == {"id": 7}


def multiple():
    assert [add(1, 2), add(3, 4), add(5, 6)] == [3, 7, 11]


def throw():
    with pytest.raises(Exception, match="refus"):
        fail("refus")


def param(n):
    assert double(n) == n * 2


CASES = [
    (${JSON.stringify(TESTS.observe.slice(12))}, observe, ()),
    (${JSON.stringify(TESTS.async.slice(12))}, async_, ()),
    (${JSON.stringify(TESTS.multiple.slice(12))}, multiple, ()),
    (${JSON.stringify(TESTS.throw.slice(12))}, throw, ()),
    (${JSON.stringify(TESTS.param(1).slice(12))}, param, (1,)),
    (${JSON.stringify(TESTS.param(2).slice(12))}, param, (2,)),
]
`

const CONFTEST = `import runpy

import pytest


class Case(pytest.Item):
    def __init__(self, *, fn, args, **kw):
        super().__init__(**kw)
        self.fn = fn
        self.args = args

    def runtest(self):
        self.fn(*self.args)

    def reportinfo(self):
        return self.path, 0, self.name


class Group(pytest.Collector):
    def __init__(self, *, cases, **kw):
        super().__init__(**kw)
        self.cases = cases

    def collect(self):
        for name, fn, args in self.cases:
            yield Case.from_parent(self, name=name, fn=fn, args=args)


class Cases(pytest.File):
    def collect(self):
        cases = runpy.run_path(str(self.path))["CASES"]
        yield Group.from_parent(self, name="conformance", cases=cases)


def pytest_collect_file(parent, file_path):
    if file_path.name == "conformance_cases.py":
        return Cases.from_parent(parent, path=file_path)
`

describe('conformité de l’adapter pytest', () => {
  it('pytest passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new PytestAdapter(),
      example: resolve('examples/pytest-project'),
      dialect: {
        module: 'cjs',
        ext: 'py',
        link: '.venv',
        baseError: 'Exception',
        files: {
          'src/__init__.py': '',
          'src/conformance.py': TARGET,
          'tests/conftest.py': CONFTEST,
          'tests/conformance_cases.py': CASES,
        },
      },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(r.checks).toHaveLength(9)
  })
})
