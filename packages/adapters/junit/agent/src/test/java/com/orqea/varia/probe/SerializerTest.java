package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class SerializerTest {
  static String ser(Object v) {
    return Json.stringify(Serializer.serialize(v, new Serializer.Options(), ""));
  }

  record Pair(Object left, int right) {}

  enum Color { RED }

  static class Base {
    Object a = 1;
  }

  static final class Derived extends Base {
    static int ignored = 3;
    Object b = "x";
  }

  interface Secret {}

  static final class Hidden implements Secret {}

  static final class HiddenChild extends Base implements Secret {}

  static final class Callable0 implements java.util.concurrent.Callable<Integer> {
    public Integer call() {
      return 1;
    }
  }

  static class Fn implements Function<Integer, Integer> {
    public Integer apply(Integer x) {
      return x;
    }
  }

  static final class SubFn extends Fn {}

  @Test
  void typesPrimitifsEtNombres() {
    assertEquals("[\"c\",1,2,3,{\"$t\":\"bigint\",\"v\":\"9007199254740992\"},{\"$t\":\"bigint\",\"v\":\"-9007199254740992\"},1.5,0.5,2.25,{\"$t\":\"number\",\"v\":\"-0\"},{\"$t\":\"number\",\"v\":\"Infinity\"},{\"$t\":\"number\",\"v\":\"-Infinity\"},{\"$t\":\"number\",\"v\":\"NaN\"},{\"$t\":\"bigint\",\"v\":\"12\"},false,9007199254740991]",
        ser(Arrays.asList('c', (short) 1, (byte) 2, 3, 9007199254740992L, -9007199254740992L, 1.5, 0.5f,
            new BigDecimal("2.25"), -0.0, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NaN,
            BigInteger.valueOf(12), false, 9007199254740991L)));
    assertEquals("0", ser(0.0));
  }

  @Test
  void datesEtTemps() {
    Instant i = Instant.parse("2024-02-29T23:59:59.123456Z");
    assertEquals("{\"$t\":\"date\",\"v\":\"2024-02-29T23:59:59.123Z\"}", ser(i));
    assertEquals("{\"$t\":\"date\",\"v\":\"1970-01-01T00:00:00.000Z\"}", ser(new Date(0)));
    assertEquals("{\"$t\":\"date\",\"v\":\"2024-02-29T22:59:59.123Z\"}", ser(ZonedDateTime.ofInstant(i, ZoneId.of("UTC")).minusHours(1)));
    assertEquals("{\"$t\":\"date\",\"v\":\"2024-02-29T23:59:59.123Z\"}", ser(OffsetDateTime.ofInstant(i, ZoneId.of("UTC"))));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"LocalDate\",\"name\":\"2024-01-02\"}", ser(LocalDate.of(2024, 1, 2)));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"Duration\",\"name\":\"PT1S\"}", ser(Duration.ofSeconds(1)));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"ZoneRegion\",\"name\":\"Europe/Paris\"}", ser(ZoneId.of("Europe/Paris")));
  }

  @Test
  void expressionsOctetsErreurs() {
    assertEquals("{\"$t\":\"regexp\",\"source\":\"a.b\",\"flags\":\"imsux\"}", ser(Pattern.compile("a.b",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL | Pattern.UNICODE_CASE | Pattern.COMMENTS)));
    assertEquals("{\"$t\":\"regexp\",\"source\":\"x\",\"flags\":\"\"}", ser(Pattern.compile("x")));
    assertEquals("{\"$t\":\"bytes\",\"kind\":\"ByteBuffer\",\"base64\":\"AQI=\"}", ser(ByteBuffer.wrap(new byte[] {0, 1, 2}, 1, 2)));
    assertEquals("{\"$t\":\"error\",\"name\":\"IllegalStateException\",\"message\":\"\"}", ser(new IllegalStateException()));
  }

  @Test
  void collections() {
    Map<Object, Object> mixed = new LinkedHashMap<>();
    mixed.put(1, null);
    mixed.put("password", "s3cret");
    mixed.put("ok", 2);
    Serializer.Options o = new Serializer.Options();
    o.fields = Set.of("password");
    o.secrets = new ArrayList<>();
    Object out = Serializer.serialize(mixed, o, "arg0");
    String json = Json.stringify(out);
    // Règle 1.2 : la valeur d'une clé textuelle de Map est masquée comme un champ.
    assertEquals(true, json.startsWith("{\"$t\":\"map\",\"entries\":[[1,null],[\"password\",{\"$redacted\":true"));
    assertEquals(List.of("s3cret"), o.secrets);
    Map<String, Object> esc = new LinkedHashMap<>();
    esc.put("$redacted", 1);
    assertEquals("{\"$t\":\"object\",\"v\":{\"$redacted\":1}}", ser(esc));
    assertEquals("[1,2]", ser(new int[] {1, 2}));
    assertEquals("{\"$t\":\"set\",\"values\":[1]}", ser(new LinkedHashSet<>(List.of(1))));
    Serializer.Options small = new Serializer.Options();
    small.maxItems = 1;
    Map<Object, Object> two = new LinkedHashMap<>();
    two.put(1, 1);
    two.put(2, 2);
    Map<String, Object> twoS = new LinkedHashMap<>();
    twoS.put("a", 1);
    twoS.put("b", 2);
    assertEquals("[{\"$t\":\"array\",\"truncated\":true,\"length\":2,\"items\":[1]},{\"$t\":\"array\",\"truncated\":true,\"length\":2,\"items\":[1]},{\"$t\":\"set\",\"values\":[1]},{\"$t\":\"map\",\"entries\":[[1,1]]},{\"a\":1},{\"$t\":\"object\",\"ctor\":\"Derived\",\"v\":{\"a\":1}}]",
        Json.stringify(Serializer.serializeArgs(new Object[] {List.of(1, 2), new int[] {1, 2},
            new LinkedHashSet<>(List.of(1, 2)), two, twoS, new Derived()}, small      )));
  }

  @Test
  void instancesEtOpaques() {
    assertEquals("{\"$t\":\"object\",\"ctor\":\"Pair\",\"v\":{\"left\":\"l\",\"right\":2}}", ser(new Pair("l", 2)));
    assertEquals("{\"$t\":\"object\",\"ctor\":\"Derived\",\"v\":{\"a\":1,\"b\":\"x\"}}", ser(new Derived()));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"Color\",\"name\":\"RED\"}", ser(Color.RED));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"CompletableFuture\"}", ser(new CompletableFuture<>()));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"Optional\"}", ser(Optional.empty()));
    // Un Thread est un Runnable : opaque « function », jamais lu champ par champ.
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"function\",\"name\":\"Thread\"}", ser(new Thread(() -> {})));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"Class\"}", ser(String.class));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"ByteArrayInputStream\"}", ser(new java.io.ByteArrayInputStream(new byte[0])));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"Itr\"}", ser(new ArrayList<>().iterator()));
    assertTrue(ser(new ClassLoader() {}).matches("\\{\"\\$t\":\"opaque\",\"kind\":\"SerializerTest\\$\\d+\"\\}"));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"function\",\"name\":\"\"}", ser((Runnable) () -> {}));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"function\",\"name\":\"Callable0\"}", ser(new Callable0()));
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"function\",\"name\":\"SubFn\"}", ser(new SubFn()));
    // Classe anonyme : nom binaire (le nom simple est vide).
    assertEquals(true, ser(new Object() {}).matches("\\{\"\\$t\":\"object\",\"ctor\":\"SerializerTest\\$\\d+\",\"v\":\\{\\}\\}"));
    // Classe du JDK encapsulée (champs privés illisibles) : opaque, jamais une erreur.
    assertEquals("{\"$t\":\"opaque\",\"kind\":\"StringBuilder\"}", ser(new StringBuilder("x")));
    Serializer.Options o = new Serializer.Options();
    o.opaqueTypes = Set.of(Secret.class.getName(), Base.class.getName());
    assertEquals("[{\"$t\":\"opaque\",\"kind\":\"Hidden\"},{\"$t\":\"opaque\",\"kind\":\"Derived\"},{\"$t\":\"object\",\"ctor\":\"HashMap\",\"v\":{}}]",
        Json.stringify(Serializer.serializeArgs(new Object[] {new Hidden(), new Derived(), new Object[0]}, o))
            .replace("[]]", "{\"$t\":\"object\",\"ctor\":\"HashMap\",\"v\":{}}]"));
    o.opaqueTypes = Set.of("autre.Type");
    assertEquals("{\"$t\":\"object\",\"ctor\":\"HiddenChild\",\"v\":{\"a\":1}}", Json.stringify(Serializer.serialize(new HiddenChild(), o, "")));
  }

  @Test
  void typeOfCouvreChaqueFamille() {
    Object[] values = {null, "s", 'c', true, BigInteger.ONE, 1L, Long.MAX_VALUE, 1, (short) 1, (byte) 1, 1.0, 1f,
        BigDecimal.ONE, Instant.EPOCH, new Date(0), ZonedDateTime.now(), OffsetDateTime.now(), Pattern.compile("x"),
        new RuntimeException(), new byte[0], ByteBuffer.allocate(0), Map.of("a", 1), Map.of(1, 1), Set.of(),
        List.of(), new int[0], (Runnable) () -> {}, new Object()};
    List<String> types = new ArrayList<>();
    for (Object v : values) types.add(Serializer.typeOf(v));
    assertEquals(List.of("null", "string", "string", "boolean", "bigint", "number", "bigint", "number", "number",
        "number", "number", "number", "number", "date", "date", "date", "date", "regexp", "error", "bytes", "bytes",
        "object", "map", "set", "array", "array", "function", "object"), types);
    assertEquals(true, Serializer.simpleName(new HashMap<String, Object>() {}.getClass()).matches("SerializerTest\\$\\d+"));
  }

  @Test
  void redactionParCheminEtMotif() {
    Serializer.Redaction r = new Serializer.Redaction(Map.of("fields", List.of("PIN"), "patterns", List.of("^tok"),
        "skipPaths", List.of("login#arg1", "other#arg0"), "hmacKey", "k"), Set.of());
    Serializer.Options o = r.argsOptions("login", new ArrayList<>());
    Map<String, Object> obj = new LinkedHashMap<>();
    obj.put("pin", 1);
    obj.put("Token", "");
    obj.put("x", 2);
    String out = Json.stringify(Serializer.serializeArgs(new Object[] {obj, "pw"}, o));
    assertEquals(true, out.contains("\"x\":2") && !out.contains("pw") && out.contains("\"type\":\"number\""));
    assertEquals(List.of("pw"), o.secrets);
    Serializer.Options none = new Serializer.Redaction(Map.of("fields", "pas une liste"), Set.of()).argsOptions("f", null);
    assertEquals("[{\"pin\":1,\"Token\":\"\",\"x\":2}]", Json.stringify(Serializer.serializeArgs(new Object[] {obj}, none)));
    Object red = Serializer.redacted("v", none);
    assertEquals("string", ((Map<?, ?>) red).get("type"));
  }
}
