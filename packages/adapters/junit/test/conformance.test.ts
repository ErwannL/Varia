// Suite de conformité d'adaptateur (CDC §9.3) contre l'adaptateur JUnit RÉEL : projet jetable Maven
// (pom de examples/junit-project) avec la cible et les tests de conformité écrits en Java.
import { runConformance } from '@varia/adapter-conformance'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JUnitAdapter } from '../src/adapter.js'

const TARGET = `package conformance;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

public final class Conformance {
  public static class ConformanceError extends RuntimeException {
    public ConformanceError(String m) {
      super(m);
    }
  }

  public static String greet(Object user) {
    return "Hello " + ((Map<?, ?>) user).get("name");
  }

  public static CompletableFuture<Map<String, Object>> fetchLater(int id) {
    return CompletableFuture.supplyAsync(() -> Map.of("id", id));
  }

  public static int add(int a, int b) {
    return a + b;
  }

  public static void fail(String message) {
    throw new ConformanceError(message);
  }

  public static int double_(int n) {
    return n * 2;
  }
}
`

const TEST = `package conformance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ConformanceTest {
  @Test
  void observe() {
    assertEquals("Hello Ada", Conformance.greet(Map.of("name", "Ada")));
  }

  @Test
  void async() {
    assertEquals(Map.of("id", 7), Conformance.fetchLater(7).join());
  }

  @Test
  void multiple() {
    assertEquals(List.of(3, 7, 11), List.of(Conformance.add(1, 2), Conformance.add(3, 4), Conformance.add(5, 6)));
  }

  @Test
  void raises() {
    assertThrows(Conformance.ConformanceError.class, () -> Conformance.fail("refus"));
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2})
  void param(int n) {
    assertEquals(n * 2, Conformance.double_(n));
  }
}
`

/** Noms JUnit (méthode, puis indice d'invocation) des tests de conformité. */
const NAMES: Record<string, string> = {
  'conformance observe': 'conformance.ConformanceTest#observe()',
  'conformance param 1': 'conformance.ConformanceTest#param(int) [1]',
  'conformance param 2': 'conformance.ConformanceTest#param(int) [2]',
}

describe('conformité de l’adaptateur JUnit', () => {
  it('JUnit (agent Java) passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new JUnitAdapter(),
      example: resolve('examples/junit-project'),
      dialect: {
        module: 'cjs',
        ext: 'java',
        link: 'target',
        baseError: 'RuntimeException',
        files: {
          'src/main/java/conformance/Conformance.java': TARGET,
          'src/test/java/conformance/ConformanceTest.java': TEST,
        },
        testName: (n) => NAMES[n] ?? n,
        // `double` est un mot réservé de Java.
        exportName: (n) => (n === 'double' ? 'double_' : n),
      },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(r.checks).toHaveLength(9)
  }, 600_000)
})
