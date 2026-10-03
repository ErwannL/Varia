package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.math.BigInteger;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ValuesTest {
  static Object de(String json) throws Values.NotApplicable {
    return Values.deserialize(Json.parse(json));
  }

  static String reason(Values.NotApplicable e) {
    return e.reason;
  }

  static final class Box implements Serializable {
    private static final long serialVersionUID = 1L;
    Object v;
    int n;
  }

  static final class NotSer {
    Object v;
  }

  static final class BadSer implements Serializable {
    private static final long serialVersionUID = 1L;
    final Object hold = new Object();
  }

  record Rec(Object v) implements Serializable {}

  @Test
  void reconstruitChaqueEtiquette() throws Exception {
    assertEquals(Arrays.asList(1, 9007199254740991L, 1.5, "s", null, true), de("[1,9007199254740991,1.5,\"s\",null,true]"));
    assertEquals(-0.0, de("{\"$t\":\"number\",\"v\":\"-0\"}"));
    assertTrue(Double.isNaN((Double) de("{\"$t\":\"number\",\"v\":\"NaN\"}")));
    assertEquals(Double.NEGATIVE_INFINITY, de("{\"$t\":\"number\",\"v\":\"-Infinity\"}"));
    assertEquals(new BigInteger("18446744073709551616"), de("{\"$t\":\"bigint\",\"v\":\"18446744073709551616\"}"));
    assertEquals(Instant.EPOCH, de("{\"$t\":\"date\",\"v\":\"1970-01-01T00:00:00.000Z\"}"));
    assertEquals("a+", ((Pattern) de("{\"$t\":\"regexp\",\"source\":\"a+\",\"flags\":\"\"}")).pattern());
    Map<Object, Object> m = new LinkedHashMap<>();
    m.put(1, "un");
    assertEquals(m, de("{\"$t\":\"map\",\"entries\":[[1,\"un\"]]}"));
    assertEquals(new LinkedHashSet<>(List.of(1)), de("{\"$t\":\"set\",\"values\":[1]}"));
    assertArrayEquals(new byte[] {0, 1}, (byte[]) de("{\"$t\":\"bytes\",\"kind\":\"Buffer\",\"base64\":\"AAE=\"}"));
    assertEquals("m", ((RuntimeException) de("{\"$t\":\"error\",\"name\":\"E\",\"message\":\"m\"}")).getMessage());
    assertEquals(Map.of("$t", 1), de("{\"$t\":\"object\",\"v\":{\"$t\":1}}"));
    assertEquals(Map.of("a", List.of()), de("{\"a\":[]}"));
    for (String bad : new String[] {"{\"$t\":\"date\",\"v\":null}", "{\"$t\":\"date\",\"v\":\"+275760-09-13T00:00:00.000Z x\"}",
        "{\"$t\":\"object\",\"ctor\":\"P\",\"v\":{}}", "{\"$t\":\"hole\"}"})
      assertEquals("VALUE_NOT_RECONSTRUCTIBLE", reason(assertThrows(Values.NotApplicable.class, () -> de(bad))));
    assertEquals("UNDEFINED_UNSUPPORTED", reason(assertThrows(Values.NotApplicable.class, () -> de("{\"$t\":\"undefined\"}"))));
  }

  @Test
  void copieProfonde() throws Exception {
    Map<String, Object> inner = new LinkedHashMap<>();
    inner.put("x", new ArrayList<>(List.of(1)));
    List<Object> self = new ArrayList<>();
    self.add(self);
    Box box = new Box();
    box.v = "b";
    Object[] args = {inner, new LinkedHashSet<>(Set.of(2)), new int[] {3}, box, self, Pattern.compile("p"), 'c'};
    IdentityHashMap<Object, Object> seen = new IdentityHashMap<>();
    Object[] copy = new Object[args.length];
    for (int i = 0; i < args.length; i++) copy[i] = Values.deepCopy(args[i], seen);
    assertEquals(inner, copy[0]);
    assertNotSame(inner.get("x"), ((Map<?, ?>) copy[0]).get("x"));
    assertEquals(Set.of(2), copy[1]);
    assertArrayEquals(new int[] {3}, (int[]) copy[2]);
    assertEquals("b", ((Box) copy[3]).v);
    assertNotSame(box, copy[3]);
    assertTrue(((List<?>) copy[4]).get(0) == copy[4]);
    assertEquals("NOT_COPYABLE", reason(assertThrows(Values.NotApplicable.class, () -> Values.deepCopy(new NotSer(), new IdentityHashMap<>()))));
    assertEquals("NOT_COPYABLE", reason(assertThrows(Values.NotApplicable.class, () -> Values.roundTrip(new BadSer()))));
    assertEquals("x", ((Rec) Values.roundTrip(new Rec("x"))).v());
    assertEquals(List.of("s"), Values.roundTrip(new ArrayList<>(List.of("s"))));
  }

  static Object[] apply(Object[] args, Class<?>[] params, String path, String op, String value) throws Values.NotApplicable {
    return Values.apply(args, params, (List<?>) Json.parse(path), op, value == null ? null : Json.parse(value));
  }

  @Test
  void appliqueUneMutationSurUneCopie() throws Exception {
    Map<String, Object> user = new LinkedHashMap<>();
    user.put("name", "Ada");
    user.put("tags", new ArrayList<>(List.of("a")));
    Box box = new Box();
    box.v = new Object[] {"z"};
    Object[] args = {user, 3, box, new String[] {"q"}};
    Class<?>[] params = {Map.class, double.class, Box.class, String[].class};
    Object[] r = apply(args, params, "[\"0\",\"name\"]", "set", "null");
    assertNull(((Map<?, ?>) r[0]).get("name"));
    assertEquals("Ada", user.get("name"));
    assertEquals(List.of("b"), ((Map<?, ?>) apply(args, params, "[\"0\",\"tags\",\"0\"]", "set", "\"b\"")[0]).get("tags"));
    assertTrue(!((Map<?, ?>) apply(args, params, "[\"0\",\"name\"]", "delete", null)[0]).containsKey("name"));
    assertTrue(!((Map<?, ?>) apply(args, params, "[\"0\",\"name\"]", "set", "{\"$t\":\"undefined\"}")[0]).containsKey("name"));
    assertEquals(5.0, apply(args, params, "[\"1\"]", "set", "5")[1]);
    assertEquals(Double.NaN, apply(args, params, "[\"1\"]", "set", "{\"$t\":\"number\",\"v\":\"NaN\"}")[1]);
    assertEquals(7, ((Box) apply(args, params, "[\"2\",\"n\"]", "set", "7")[2]).n);
    assertEquals("w", ((Object[]) ((Box) apply(args, params, "[\"2\",\"v\",\"0\"]", "set", "\"w\"")[2]).v)[0]);
    assertArrayEquals(new String[] {"k"}, (String[]) apply(args, params, "[\"3\",\"0\"]", "set", "\"k\"")[3]);
    assertArrayEquals(new String[] {"m"}, (String[]) apply(args, params, "[\"3\"]", "set", "[\"m\"]")[3]);
    String[][] bad = {
      {"[\"9\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"-1\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"1\"]", "set", "null", "TYPE_MISMATCH"},
      {"[\"1\"]", "set", "\"3\"", "TYPE_MISMATCH"},
      {"[\"1\"]", "delete", null, "UNDEFINED_UNSUPPORTED"},
      {"[\"0\",\"zz\",\"a\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"0\",\"tags\",\"5\",\"a\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"0\",\"tags\",\"x\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"0\",\"name\",\"a\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"0\",\"tags\",\"0\"]", "delete", null, "UNDEFINED_UNSUPPORTED"},
      {"[\"0\",\"name\",\"a\",\"b\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"2\",\"nope\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"2\",\"n\"]", "set", "\"x\"", "TYPE_MISMATCH"},
      {"[\"2\",\"v\",\"3\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"3\",\"0\"]", "set", "1", "TYPE_MISMATCH"},
      {"[\"3\"]", "set", "[1]", "TYPE_MISMATCH"},
      {"[\"0\",\"tags\",\"0\",\"x\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"3\",\"0\",\"x\"]", "set", "1", "PATH_NOT_FOUND"},
      {"[\"0\",\"tags\",\"0\"]", "set", "{\"$t\":\"undefined\"}", "UNDEFINED_UNSUPPORTED"},
      {"[\"1\"]", "set", "{\"$t\":\"undefined\"}", "UNDEFINED_UNSUPPORTED"},
    };
    for (String[] b : bad)
      assertEquals(b[3], reason(assertThrows(Values.NotApplicable.class, () -> apply(args, params, b[0], b[1], b[2]))), b[0]);
    Map<String, Object> withNull = new LinkedHashMap<>();
    withNull.put("n", null);
    assertEquals("PATH_NOT_FOUND", reason(assertThrows(Values.NotApplicable.class,
        () -> apply(new Object[] {withNull}, new Class<?>[] {Map.class}, "[\"0\",\"n\",\"x\"]", "set", "1"))));
    assertEquals("PATH_NOT_FOUND", reason(assertThrows(Values.NotApplicable.class,
        () -> apply(new Object[] {withNull}, new Class<?>[] {Map.class}, "[\"0\",\"n\",\"x\",\"y\"]", "set", "1"))));
    assertEquals("PATH_NOT_FOUND", reason(assertThrows(Values.NotApplicable.class,
        () -> apply(new Object[] {new Rec(1)}, new Class<?>[] {Rec.class}, "[\"0\",\"v\"]", "set", "2"))));
  }

  @Test
  void conversionsEtBoites() throws Exception {
    assertEquals(4L, Values.coerce(4, long.class));
    assertEquals(4L, Values.coerce(4L, Long.class));
    assertEquals(4.0, Values.coerce(4L, double.class));
    assertEquals("TYPE_MISMATCH", reason(assertThrows(Values.NotApplicable.class, () -> Values.coerce(1.5, int.class))));
    assertEquals("TYPE_MISMATCH", reason(assertThrows(Values.NotApplicable.class, () -> Values.coerce(List.of(), String.class))));
    assertEquals("TYPE_MISMATCH", reason(assertThrows(Values.NotApplicable.class, () -> Values.coerce(true, long.class))));
    assertEquals(List.of(Integer.class, Long.class, Double.class, Boolean.class, Float.class, Short.class, Byte.class, Character.class, String.class),
        Arrays.asList(Values.box(int.class), Values.box(long.class), Values.box(double.class), Values.box(boolean.class),
            Values.box(float.class), Values.box(short.class), Values.box(byte.class), Values.box(char.class), Values.box(String.class)));
    assertTrue(Values.immutable(Instant.EPOCH) && Values.immutable(String.class) && Values.immutable(Thread.State.NEW) && Values.immutable(true));
    assertNull(Values.coerce(null, String.class));
  }
}
