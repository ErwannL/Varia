package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProbeTest {
  @TempDir Path tmp;

  final List<Map<String, Object>> lines = new ArrayList<>();

  @SuppressWarnings("unchecked")
  Probe probe(Map<?, ?> mutation) {
    Probe p = new Probe("fuzz", "r", tmp.toString(),
        new Serializer.Redaction(Map.of("fields", List.of("password")), Set.of()), mutation,
        l -> lines.add((Map<String, Object>) Json.parse(l)));
    p.now = () -> "T";
    return p;
  }

  List<String> types() {
    List<String> t = new ArrayList<>();
    for (Map<String, Object> l : lines) t.add((String) l.get("type"));
    return t;
  }

  static Map<String, Object> user(String name) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("name", name);
    m.put("password", "hunter2");
    return m;
  }

  @Test
  void fromEnvLitLesFichiers() throws IOException {
    assertNull(Probe.fromEnv(Map.of(), 1, Set.of()));
    assertNull(Probe.fromEnv(Map.of("VARIA_MODE", "autre", "VARIA_RUN_DIR", "x"), 1, Set.of()));
    assertNull(Probe.fromEnv(Map.of("VARIA_MODE", "observe"), 1, Set.of()));
    assertNull(Probe.fromEnv(Map.of("VARIA_MODE", "observe", "VARIA_RUN_DIR", ""), 1, Set.of()));
    Probe d = Probe.fromEnv(Map.of("VARIA_MODE", "observe", "VARIA_RUN_DIR", tmp.toString(), "VARIA_TARGETS", tmp.resolve("absent").toString()), 4, Set.of());
    assertEquals("", d.runId);
    assertEquals(System.getProperty("user.dir"), d.projectRoot);
    Files.writeString(tmp.resolve("t.json"), "{\"runId\":\"R\",\"projectRoot\":\"/p\"}");
    Files.writeString(tmp.resolve("bad.json"), "{");
    Files.writeString(tmp.resolve("arr.json"), "[]");
    Files.writeString(tmp.resolve("plan.json"), "{\"mutations\":[1,{\"id\":null},{\"id\":\"m_x\"},{\"id\":\"m_1\",\"callSiteId\":\"c\"}]}");
    Map<String, String> env = new HashMap<>(Map.of("VARIA_MODE", "fuzz", "VARIA_RUN_DIR", tmp.toString(),
        "VARIA_TARGETS", tmp.resolve("t.json").toString(), "VARIA_REDACT", tmp.resolve("bad.json").toString(),
        "VARIA_PLAN", tmp.resolve("plan.json").toString(), "VARIA_MUTATION_ID", "m_1"));
    Probe p = Probe.fromEnv(env, 7, Set.of());
    assertEquals("R", p.runId);
    assertEquals("/p", p.projectRoot);
    assertEquals("c", p.mutation.get("callSiteId"));
    p.hello(7);
    p.hello(7);
    assertEquals(2, Files.readAllLines(tmp.resolve("probe-7.jsonl")).size());
    env.put("VARIA_PLAN", tmp.resolve("arr.json").toString());
    assertNull(Probe.fromEnv(env, 8, Set.of()).mutation);
    assertEquals(Map.of(), Probe.readJson(null));
  }

  @Test
  void observeMuteEtEcritLesIssues() {
    Probe p = probe(null);
    p.hello(1);
    Probe.Call outside = p.enter("m.java", "f", new Object[] {1}, new Class<?>[] {int.class});
    // Hors d'un test, un appel n'est jamais muté (même si une mutation est chargée).
    Probe withPlan = probe(Map.of("id", "m", "callSiteId", "c_x"));
    assertNull(withPlan.enter("m.java", "f", new Object[0], new Class<?>[0]).replaced);
    assertNull(outside.callSiteId);
    p.exit(outside, 2, null, int.class);
    p.testStart("T.java", "t");
    String tid = Probe.testIdOf("T.java", "t", 0);
    String site = Probe.callSiteIdOf(tid, "m.java", "f", 0, 0);
    p.testEnd();
    // Même test rejoué : rang 1 ; mutation sur le premier appel du rang 0 (non atteint).
    lines.clear();
    Map<String, Object> plan = new HashMap<>();
    plan.put("id", "m_1");
    plan.put("callSiteId", site);
    Object[] args = {user("Ada")};
    String fp = Serializer.fingerprint(Serializer.serializeArgs(args, p.redaction.argsOptions("f", new ArrayList<>())));
    plan.put("argsFingerprint", fp);
    plan.put("path", List.of("0", "name"));
    plan.put("op", "set");
    plan.put("value", 5L);
    Probe q = probe(plan);
    q.testStart("T.java", "t");
    Probe.Call c = q.enter("m.java", "f", args, new Class<?>[] {Map.class});
    assertEquals(5, ((Map<?, ?>) c.replaced[0]).get("name"));
    assertEquals("Ada", ((Map<?, ?>) args[0]).get("name"));
    Probe.Call inner = q.enter("m.java", "g", new Object[0], new Class<?>[0]);
    assertEquals(1, inner.depth);
    assertEquals(List.of(c.callId, inner.callId), inner.chain);
    q.exit(inner, null, new IllegalStateException("vu"), void.class);
    q.exit(c, "ok", null, String.class);
    // Deuxième appel au même call site : séquence 1, pas de mutation.
    Probe.Call again = q.enter("m.java", "f", args, new Class<?>[] {Map.class});
    assertNull(again.replaced);
    q.testEnd();
    assertEquals(List.of("TEST_START", "MUTATE_CALL", "OBSERVE_CALL", "OBSERVE_CALL", "TARGET_THROW", "TARGET_RETURN",
        "OBSERVE_CALL", "TEST_END"), types());
    assertEquals(true, lines.get(1).get("applied"));
    assertEquals("vu", ((Map<?, ?>) lines.get(4).get("error")).get("message"));
    assertTrue(!Json.stringify(lines).contains("hunter2"));
  }

  @Test
  void empreinteDivergenteEtMutationInapplicable() {
    Probe.Call[] calls = new Probe.Call[2];
    for (int i = 0; i < 2; i++) {
      lines.clear();
      Map<String, Object> plan = new HashMap<>();
      plan.put("id", "m");
      plan.put("callSiteId", Probe.callSiteIdOf(Probe.testIdOf("F", "n", 0), "m", "f", 0, 0));
      plan.put("argsFingerprint", i == 0 ? "autre" : Serializer.fingerprint(List.of(1L)));
      plan.put("path", List.of("0"));
      plan.put("op", "set");
      plan.put("value", "texte");
      Probe p = probe(plan);
      p.testStart("F", "n");
      calls[i] = p.enter("m", "f", new Object[] {1}, new Class<?>[] {int.class});
      assertNull(calls[i].replaced);
      assertEquals(i == 0 ? "AMBIGUOUS_CALL_SITE" : "TYPE_MISMATCH", lines.get(1).get("reason"));
    }
    assertEquals("autre", lines.size() > 0 ? "autre" : "");
  }

  @Test
  void argumentsOmisAuDela20Appels() {
    Probe p = probe(null);
    p.testStart("F", "n");
    for (int i = 0; i < 21; i++) p.exit(p.enter("m", "f", new Object[0], new Class<?>[0]), null, null, void.class);
    Map<String, Object> last = lines.get(lines.size() - 2);
    assertEquals(true, last.get("argsOmitted"));
  }

  @Test
  void futures() {
    Probe p = probe(null);
    p.testStart("F", "n");
    CompletableFuture<Object> ok = new CompletableFuture<>();
    Object derived = p.exit(p.enter("m", "f", new Object[0], new Class<?>[0]), ok, null, CompletableFuture.class);
    ok.complete("v");
    assertEquals("v", ((CompletableFuture<?>) derived).join());
    CompletableFuture<Object> ko = new CompletableFuture<>();
    Object d2 = p.exit(p.enter("m", "f", new Object[0], new Class<?>[0]), ko, null, java.util.concurrent.Future.class);
    ko.completeExceptionally(new IllegalStateException("x"));
    assertTrue(((CompletableFuture<?>) d2).isCompletedExceptionally());
    // Type rendu plus précis que CompletableFuture : la future d'origine, issue synchrone.
    CompletableFuture<Object> keep = new CompletableFuture<>();
    assertSame(keep, p.exit(p.enter("m", "f", new Object[0], new Class<?>[0]), keep, null, Sub.class));
    List<String> t = types();
    assertEquals(List.of("TEST_START", "OBSERVE_CALL", "TARGET_RETURN", "OBSERVE_CALL", "TARGET_REJECT", "OBSERVE_CALL", "TARGET_RETURN"), t);
    assertEquals(true, lines.get(2).get("async"));
    assertEquals("IllegalStateException", ((Map<?, ?>) lines.get(4).get("error")).get("name"));
    assertEquals(false, lines.get(6).get("async"));
    IllegalStateException cause = new IllegalStateException();
    assertSame(cause, Probe.unwrap(new CompletionException(cause)));
    CompletionException bare = new CompletionException("x", null);
    assertSame(bare, Probe.unwrap(bare));
  }

  static final class Sub extends CompletableFuture<Object> {}

  @Test
  void exceptionsNonAttrapeesEtErreursDeLaSonde() {
    Probe p = probe(null);
    p.testStart("F", "n");
    Probe.Call c = p.enter("m", "f", new Object[] {user("x")}, new Class<?>[] {Map.class});
    assertSame(c, p.context.get());
    p.uncaught(Thread.currentThread(), new IllegalStateException("hunter2"), c);
    p.uncaught(Thread.currentThread(), new IllegalStateException(), null);
    Map<String, Object> u = lines.get(lines.size() - 2);
    assertEquals(List.of(c.callId), u.get("chain"));
    assertEquals("[REDACTED]", ((Map<?, ?>) u.get("error")).get("message"));
    assertNull(lines.get(lines.size() - 1).get("callSiteId"));
    p.exit(c, null, null, void.class);
    assertNull(p.context.get());
    // Journal qui lève : PROBE_ERROR, puis marqueur stderr si le journal reste inaccessible.
    ByteArrayOutputStream err = new ByteArrayOutputStream();
    p.stderr = new PrintStream(err, true);
    p.sink = l -> {
      throw new IOException("plein");
    };
    assertNull(p.enter("m", "f", new Object[0], new Class<?>[0]));
    p.exit(c, null, null, void.class);
    p.hello(1);
    p.discover("m", List.of(), List.of());
    p.testStart("F", "n");
    p.testEnd();
    p.uncaught(Thread.currentThread(), new RuntimeException(), null);
    String out = err.toString();
    for (String stage : new String[] {"prepare", "outcome", "hello", "wrap", "test", "unhandled-rejection"})
      assertTrue(out.contains(Probe.STDERR_MARKER + " " + stage), stage);
    // Journal qui ne lève qu'au premier essai : PROBE_ERROR écrit.
    lines.clear();
    int[] n = {0};
    p.sink = l -> {
      if (n[0]++ == 0) throw new IOException("une fois");
      lines.add(Probe.fields("type", "PROBE_ERROR"));
    };
    p.hello(1);
    assertEquals(List.of("PROBE_ERROR"), types());
  }
}
