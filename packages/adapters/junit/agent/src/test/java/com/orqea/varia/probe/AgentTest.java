package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.orqea.varia.sample.Target;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.instrument.Instrumentation;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import net.bytebuddy.agent.ByteBuddyAgent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.engine.UniqueId;
import org.junit.platform.engine.support.descriptor.AbstractTestDescriptor;
import org.junit.platform.launcher.TestIdentifier;

/** Agent réel : instrumentation ByteBuddy de {@link Target}, écouteur JUnit, exceptions non attrapées. */
class AgentTest {
  @TempDir Path tmp;

  @AfterEach
  void reset() {
    Probe.current = null;
  }

  List<Map<String, Object>> log(long pid) throws Exception {
    List<Map<String, Object>> out = new ArrayList<>();
    for (String l : Files.readAllLines(tmp.resolve("probe-" + pid + ".jsonl"))) {
      @SuppressWarnings("unchecked")
      Map<String, Object> m = (Map<String, Object>) Json.parse(l);
      out.add(m);
    }
    return out;
  }

  static TestIdentifier id(String uid, boolean test) {
    return TestIdentifier.from(new AbstractTestDescriptor(UniqueId.parse(uid), "d") {
      @Override
      public Type getType() {
        return test ? Type.TEST : Type.CONTAINER;
      }
    });
  }

  @Test
  void inactiveHorsDunRun() throws Exception {
    // Surefire ne fixe pas VARIA_MODE : premain laisse la sonde inactive.
    Agent.premain(null, null);
    assertNull(Probe.current);
    assertNull(Agent.start(null, Map.of(), 1, null));
    Files.writeString(tmp.resolve("c.json"), "{\"classes\":[]}");
    Probe p = Agent.start(tmp.resolve("c.json").toString(), Map.of("VARIA_MODE", "observe", "VARIA_RUN_DIR", tmp.toString()), 3, null);
    assertTrue(Targets.MODULES.isEmpty());
    java.lang.reflect.Method own = AgentTest.class.getDeclaredMethod("inactiveHorsDunRun");
    // Méthode d'une classe non ciblée : rien ; appel connu mais sonde retirée : valeur inchangée.
    assertNull(Hooks.enter(own, new Object[0]));
    Probe.Call c = p.enter("m", "f", new Object[0], new Class<?>[0]);
    Probe.current = null;
    assertEquals("r", Hooks.exit(c, "r", null, own));
    // Code inséré, appelé directement (ByteBuddy l'inline : JaCoCo ne le voit pas sinon).
    Object[] args = {1};
    assertNull(Agent.ValueAdvice.enter(own, args));
    Agent.ValueAdvice.exit(own, null, "r", null);
    assertNull(Agent.VoidAdvice.enter(own, args));
    Agent.VoidAdvice.exit(own, null, null);
    Probe.current = p;
    Targets.MODULES.put(AgentTest.class.getName(), "m");
    Map<String, Object> plan = new HashMap<>();
    p.testStart("F", "n");
    try {
      Object call = Agent.ValueAdvice.enter(own, args);
      Agent.ValueAdvice.exit(own, call, "r", null);
      Agent.VoidAdvice.exit(own, Agent.VoidAdvice.enter(own, args), null);
      Probe.Call fake = p.enter("m", "f", new Object[0], new Class<?>[0]);
      fake.replaced = new Object[] {2};
      assertEquals(fake.replaced, Hooks.replaced(fake));
      // Mutation appliquée : le code inséré substitue les arguments.
      java.lang.reflect.Method sink = AgentTest.class.getDeclaredMethod("sink", Object.class);
      Map<String, Object> m = new HashMap<>();
      m.put("id", "m");
      m.put("callSiteId", Probe.callSiteIdOf(Probe.testIdOf("F", "n", 0), "m", "sink", 0, 0));
      m.put("argsFingerprint", Serializer.fingerprint(List.of(1L)));
      m.put("path", List.of("0"));
      m.put("op", "set");
      m.put("value", "z");
      for (int i = 0; i < 2; i++) {
        Probe q = new Probe("fuzz", "r", tmp.toString(), new Serializer.Redaction(Map.of(), java.util.Set.of()), m, l -> {});
        Probe.current = q;
        q.testStart("F", "n");
        Object[] a = {1};
        Object done = i == 0 ? Agent.ValueAdvice.enter(sink, a) : Agent.VoidAdvice.enter(sink, a);
        assertEquals(List.of("z"), List.of(((Probe.Call) done).replaced));
      }
    } finally {
      Targets.MODULES.clear();
      Probe.current = null;
    }
    assertTrue(plan.isEmpty());
    new Listener().executionStarted(id("[engine:e]", true));
    new Listener().executionFinished(id("[engine:e]", true), TestExecutionResult.successful());
    assertNull(Hooks.enter(Object.class.getMethods()[0], new Object[0]));
    assertNull(Hooks.replaced(null));
    assertEquals("r", Hooks.exit(null, "r", null, Object.class.getMethods()[0]));
  }

  @Test
  void instrumenteLesMethodesPubliques() throws Exception {
    Files.writeString(tmp.resolve("cfg.json"), "{\"classes\":{\"com.orqea.varia.sample.Target\":\"src/Target.java\"},"
        + "\"testRoots\":[\"src/test/java\"],\"opaqueTypes\":[\"x.Y\"]}");
    Files.writeString(tmp.resolve("redact.json"), "{\"fields\":[\"password\"]}");
    Map<String, String> env = new HashMap<>(Map.of("VARIA_MODE", "observe", "VARIA_RUN_DIR", tmp.toString(),
        "VARIA_REDACT", tmp.resolve("redact.json").toString()));
    Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
    Instrumentation inst = ByteBuddyAgent.install();
    Probe p = Agent.start(tmp.resolve("cfg.json").toString(), env, 11, inst);
    try {
      assertEquals(Probe.current, p);
      Listener l = new Listener();
      l.executionStarted(id("[engine:junit-jupiter]/[class:a.B]", false));
      l.executionStarted(id("[engine:junit-jupiter]/[class:a.B]/[method:m()]", true));
      assertEquals("x", Target.name(new HashMap<>(Map.of("name", " x ", "password", "pw"))));
      assertEquals(4, Target.twice(2));
      assertThrows(IllegalArgumentException.class, () -> Target.fail("non"));
      Target.nothing();
      assertEquals(3, Target.later(3).join());
      assertTrue(Target.later(-1).isCompletedExceptionally());
      assertEquals(5, Target.stage(5).toCompletableFuture().join());
      assertEquals(2, Target.outer(List.of("a", "b")));
      l.executionFinished(id("[engine:junit-jupiter]/[class:a.B]/[method:m()]", true), TestExecutionResult.successful());
      l.executionFinished(id("[engine:junit-jupiter]/[class:a.B]", false), TestExecutionResult.successful());
      // Exception non attrapée dans un fil créé pendant un appel : attribuée à cet appel.
      Thread.UncaughtExceptionHandler h = Thread.getDefaultUncaughtExceptionHandler();
      PrintStream saved = System.err;
      ByteArrayOutputStream err = new ByteArrayOutputStream();
      System.setErr(new PrintStream(err, true));
      try {
        h.uncaughtException(Thread.currentThread(), new IllegalStateException("fil"));
      } finally {
        System.setErr(saved);
      }
      assertTrue(err.toString().contains("Exception in thread"));
      List<Map<String, Object>> lines = log(11);
      List<String> types = new ArrayList<>();
      for (Map<String, Object> m : lines) types.add((String) m.get("type"));
      assertEquals("HELLO", types.get(0));
      assertTrue(types.contains("UNHANDLED_REJECTION"));
      Map<String, Object> discover = lines.stream().filter(m -> "DISCOVER".equals(m.get("type")) && "src/Target.java".equals(m.get("module")))
          .filter(m -> ((List<?>) m.get("wrapped")).contains("name")).findFirst().orElseThrow();
      assertEquals(List.of("name", "twice", "fail", "nothing", "later", "stage", "outer"), discover.get("wrapped"));
      assertEquals(List.of("helper"), discover.get("unsupported"));
      List<String> exports = new ArrayList<>();
      for (Map<String, Object> m : lines) if ("OBSERVE_CALL".equals(m.get("type"))) exports.add(m.get("export") + "@" + m.get("depth"));
      assertEquals(List.of("name@0", "twice@0", "fail@0", "nothing@0", "later@0", "later@0", "stage@0", "outer@0", "Inner.size@1"), exports);
      String all = Files.readString(tmp.resolve("probe-11.jsonl"));
      assertTrue(!all.contains("\"pw\""));
      assertTrue(all.contains("TARGET_REJECT") && all.contains("TARGET_THROW"));
      assertTrue(all.contains("\"name\":\"a.B#m()\"") && all.contains("\"file\":\"src/test/java/a/B.java\""));
      // Gestionnaire précédent conservé.
      List<Throwable> seen = new ArrayList<>();
      Thread.setDefaultUncaughtExceptionHandler((t, e) -> seen.add(e));
      Agent.start(tmp.resolve("cfg.json").toString(), env, 12, null);
      Thread.getDefaultUncaughtExceptionHandler().uncaughtException(Thread.currentThread(), new IllegalStateException("x"));
      assertEquals(1, seen.size());
      mutation();
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(before);
      Targets.MODULES.clear();
      Targets.TEST_ROOTS.clear();
    }
  }

  /** Appel muté par le code inséré (Target déjà instrumentée dans cette JVM). */
  void mutation() {
    Map<String, Object> plan = new HashMap<>();
    String tid = Probe.testIdOf("F", "n", 0);
    plan.put("id", "m");
    plan.put("callSiteId", Probe.callSiteIdOf(tid, "src/Target.java", "twice", 0, 0));
    plan.put("argsFingerprint", Serializer.fingerprint(List.of(2L)));
    plan.put("path", List.of("0"));
    plan.put("op", "set");
    plan.put("value", 10L);
    List<String> lines = new ArrayList<>();
    Probe p = new Probe("fuzz", "r", tmp.toString(), new Serializer.Redaction(Map.of(), java.util.Set.of()), plan, lines::add);
    Probe.current = p;
    p.testStart("F", "n");
    assertEquals(20, Target.twice(2));
    assertEquals(4, Target.twice(2));
    assertTrue(lines.stream().anyMatch(x -> x.contains("\"applied\":true")));
  }

  static void sink(Object x) {}
}
