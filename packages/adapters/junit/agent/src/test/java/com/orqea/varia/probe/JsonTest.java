package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonTest {
  @Test
  void litToutesLesFormes() {
    assertEquals(
        Arrays.asList(true, false, null, 1L, -2.5, 1e300, "a\"\\/\b\f\n\r\té", Map.of(), List.of()),
        Json.parse(" [true,false,null,1,-2.5,1e300,\"a\\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\",{},[]] "));
    assertEquals(Map.of("a", Map.of("b", 1L)), Json.parse("{\"a\" : { \"b\" : 1 } }"));
    assertEquals(9007199254740993.0, Json.parse("9007199254740993"));
  }

  @Test
  void refuseUnJsonInvalide() {
    for (String bad : new String[] {"", "[1,]x", "[1 2]", "{\"a\":1 \"b\"}", "{1:2}", "tru", "\"\\x\"",
        "\"\\u12\"", "\"\\uzzzz\"", "-", "1 2", "\"abc"})
      assertThrows(IllegalArgumentException.class, () -> Json.parse(bad), bad);
  }

  @Test
  void ecritCommeJsonStringify() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("z", 1);
    m.put("a", List.of(2.5, "\u0001\ud800x\udc00", "\u001f\b\f\r"));
    m.put("b", true);
    assertEquals("{\"z\":1,\"a\":[2.5,\"\\u0001\\ud800x\\udc00\",\"\\u001f\\b\\f\\r\"],\"b\":true}",
        Json.stringify(m));
    assertEquals("\"\\ud83d\"", Json.stringify("\ud83d"));
    assertEquals("\"\\udc00x\"", Json.stringify("\udc00x"));
    assertEquals("\"🙂\"", Json.stringify("🙂"));
  }

  @Test
  void formatDesNombresEcmaScript() {
    assertEquals("0", Json.number(-0.0));
    assertEquals("-1.5", Json.number(-1.5));
    assertEquals("100", Json.number(100));
    assertEquals("1e+21", Json.number(1e21));
    assertEquals("123456789012345680000", Json.number(1.2345678901234568e20));
    assertEquals("0.000001", Json.number(1e-6));
    assertEquals("1e-7", Json.number(1e-7));
    assertEquals("1.5e-7", Json.number(1.5e-7));
    assertEquals("1.2e+22", Json.number(1.2e22));
  }

  @Test
  void ordreCanoniqueDesCles() {
    Map<String, Object> m = new LinkedHashMap<>();
    for (String k : new String[] {"b", "4294967295", "10", "4294967294", "01", "2"}) m.put(k, 0);
    assertEquals("{\"2\":0,\"10\":0,\"4294967294\":0,\"01\":0,\"4294967295\":0,\"b\":0}", Json.canonical(m, 0));
    assertEquals("[\n  1\n]", Json.canonical(List.of(1), 2));
  }

  @Test
  void empreintes() {
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Json.sha256(""));
    assertEquals(64, Json.hmac("", "x").length());
    assertThrows(IllegalStateException.class, () -> Json.digest("PAS-UN-ALGO", "x"));
    assertThrows(IllegalStateException.class, () -> Json.mac("PasUnMac", "k", "x"));
  }
}
