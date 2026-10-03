package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/**
 * Rejeu de TOUTES les fixtures de conformité (packages/probe-protocol/conformance) par la sonde Java.
 * Un cas non rejouable (concept absent de Java) est listé à part, jamais compté réussi.
 */
class ConformanceTest {
  static final Path DIR = Path.of(System.getProperty("varia.conformance", "../../../probe-protocol/conformance"));

  /** Cas non rejouables en Java, avec la raison (vérifiés : ni plus, ni moins). */
  static final Map<String, String> NOT_REPLAYABLE = Map.of(
      "values/undefined", "UNDEFINED_ABSENT_IN_JAVA",
      "values/set", "UNDEFINED_ABSENT_IN_JAVA",
      "values/tableau", "UNDEFINED_ABSENT_IN_JAVA",
      "fingerprint/etiquetees", "UNDEFINED_ABSENT_IN_JAVA",
      "redaction/cle-de-map", "STRING_KEYED_MAP_IS_PLAIN_OBJECT_IN_JAVA");

  @SuppressWarnings("unchecked")
  static Object run(Map<String, Object> c) throws Fixtures.Absent {
    Map<String, Object> in = (Map<String, Object>) c.get("input");
    switch ((String) c.get("op")) {
      case "serialize":
        return Serializer.serialize(Fixtures.build(in.get("value")), new Serializer.Options(), "");
      case "serializeArgs": {
        List<String> secrets = new ArrayList<>();
        Serializer.Options o = redaction(in).argsOptions((String) in.getOrDefault("export", "f"), secrets);
        List<Object> args = Serializer.serializeArgs(((List<Object>) Fixtures.build(in.get("args"))).toArray(), o);
        return Probe.fields("args", args, "argsFingerprint", Serializer.fingerprint(args));
      }
      case "serializeError": {
        List<String> secrets = new ArrayList<>();
        if (in.containsKey("args")) {
          Serializer.Options o = redaction(in).argsOptions((String) in.getOrDefault("export", "f"), secrets);
          Serializer.serializeArgs(((List<Object>) Fixtures.build(in.get("args"))).toArray(), o);
        }
        return Errors.serialize((Throwable) Fixtures.build(in.get("error")), secrets);
      }
      case "testId":
        return Probe.testIdOf((String) in.get("file"), (String) in.get("name"), ((Long) in.get("rank")).intValue());
      case "callSiteId":
        return Probe.callSiteIdOf((String) in.get("testId"), (String) in.get("module"), (String) in.get("export"),
            ((Long) in.get("depth")).intValue(), ((Long) in.get("sequence")).intValue());
      default: {
        String text = Json.canonical(in.get("value"), ((Long) in.get("indent")).intValue());
        return Probe.fields("text", text, "sha256", Json.sha256(text));
      }
    }
  }

  static Serializer.Redaction redaction(Map<String, Object> in) {
    Object r = in.get("redact");
    return new Serializer.Redaction(r == null ? Map.of() : (Map<?, ?>) r, java.util.Set.of());
  }

  /** Égalité JSON stricte avec les jokers {@code $match} et {@code $prefix}. */
  static boolean matches(Object expected, Object actual) {
    if (expected instanceof Map && ((Map<?, ?>) expected).containsKey("$match"))
      return actual instanceof String;
    if (expected instanceof Map && ((Map<?, ?>) expected).containsKey("$prefix")) {
      List<?> p = (List<?>) ((Map<?, ?>) expected).get("$prefix");
      if (!(actual instanceof List) || ((List<?>) actual).size() < p.size()) return false;
      return matches(p, ((List<?>) actual).subList(0, p.size()));
    }
    if (expected instanceof Number && actual instanceof Number)
      return Double.compare(((Number) expected).doubleValue(), ((Number) actual).doubleValue()) == 0;
    if (expected instanceof List && actual instanceof List) {
      List<?> e = (List<?>) expected;
      List<?> a = (List<?>) actual;
      if (e.size() != a.size()) return false;
      for (int i = 0; i < e.size(); i++) if (!matches(e.get(i), a.get(i))) return false;
      return true;
    }
    if (expected instanceof Map && actual instanceof Map) {
      Map<?, ?> e = (Map<?, ?>) expected;
      Map<?, ?> a = (Map<?, ?>) actual;
      if (!e.keySet().equals(a.keySet())) return false;
      for (Object k : e.keySet()) if (!matches(e.get(k), a.get(k))) return false;
      return true;
    }
    return expected == null ? actual == null : expected.equals(actual);
  }

  @Test
  @SuppressWarnings("unchecked")
  void rejoueToutesLesFixtures() throws Exception {
    Map<String, Object> manifest = (Map<String, Object>) Json.parse(Files.readString(DIR.resolve("manifest.json")));
    assertEquals("1.2", manifest.get("protocolVersion"));
    // Empreinte du jeu (README) : la sonde sait quelle version elle rejoue.
    StringBuilder all = new StringBuilder();
    try (var files = Files.list(DIR.resolve("cases"))) {
      for (Path f : files.filter(p -> p.toString().endsWith(".json")).sorted((a, b) -> a.getFileName().toString().compareTo(b.getFileName().toString())).toList())
        all.append(f.getFileName()).append('\0').append(Files.readString(f, StandardCharsets.UTF_8)).append('\0');
    }
    assertEquals(manifest.get("sha256"), Json.sha256(all.toString()));
    Map<String, String> failures = new TreeMap<>();
    Map<String, String> skipped = new TreeMap<>();
    int passed = 0;
    for (Object file : (List<Object>) manifest.get("files")) {
      Map<String, Object> doc = (Map<String, Object>) Json.parse(Files.readString(DIR.resolve("cases").resolve((String) file)));
      for (Object o : (List<Object>) doc.get("cases")) {
        Map<String, Object> c = (Map<String, Object>) o;
        String id = (String) c.get("id");
        Object actual;
        try {
          actual = run(c);
        } catch (Fixtures.Absent e) {
          skipped.put(id, "UNDEFINED_ABSENT_IN_JAVA");
          continue;
        }
        if (matches(c.get("expected"), actual)) passed++;
        else if (NOT_REPLAYABLE.containsKey(id)) skipped.put(id, NOT_REPLAYABLE.get(id));
        else failures.put(id, Json.stringify(actual));
      }
    }
    assertEquals(Map.of(), failures);
    assertEquals(new TreeMap<>(NOT_REPLAYABLE), skipped);
    assertTrue(passed >= 60, "cas réussis : " + passed);
    System.out.println("[varia-conformance] passed=" + passed + " not-replayable=" + skipped.size());
  }

  @Test
  void leComparateurRefuseLesEcarts() {
    assertTrue(!matches(Map.of("a", 1L), Map.of("a", 2L)));
    assertTrue(!matches(List.of(1L), List.of(1L, 2L)));
    assertTrue(!matches(Map.of("$prefix", List.of("A")), List.of()));
    assertTrue(!matches(Map.of("$prefix", List.of("A")), "x"));
    assertTrue(!matches(Map.of("a", 1L), Map.of("b", 1L)));
    assertTrue(!matches("x", null));
    assertTrue(matches(null, null));
  }
}
