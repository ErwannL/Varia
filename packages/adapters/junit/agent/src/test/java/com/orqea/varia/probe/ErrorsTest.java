package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ErrorsTest {
  static final class Hostile extends RuntimeException {
    @Override
    public String getMessage() {
      throw new IllegalStateException("hostile");
    }

    @Override
    public StackTraceElement[] getStackTrace() {
      throw new IllegalStateException("hostile");
    }

    public Object getErrorCode() {
      throw new IllegalStateException("hostile");
    }
  }

  static final class WithCode extends RuntimeException {
    WithCode() {
      super((String) null);
    }

    public String getErrorCode() {
      return "E1";
    }

    public double getStatus() {
      return Double.NaN;
    }
  }

  static final class WithGetCode extends RuntimeException {
    private final int status = 404;

    public Object getCode() {
      return 7;
    }
  }

  static class Parent extends RuntimeException {
    protected Object code = "P";
  }

  static final class Child extends Parent {}

  static final class Deep extends RuntimeException {
    public String getStatus(int x) {
      return "x";
    }
  }

  @Test
  void champsEtChaine() {
    Map<String, Object> s = Errors.serialize(new WithCode(), List.of());
    assertEquals("", s.get("message"));
    assertEquals("E1", s.get("code"));
    assertFalse(s.containsKey("status"));
    assertEquals(List.of("WithCode", "RuntimeException", "Exception", "Throwable"), s.get("constructorChain"));
    Map<String, Object> g = Errors.serialize(new WithGetCode(), List.of());
    assertEquals("7", g.get("code"));
    assertEquals(404L, g.get("status"));
    assertEquals("P", Errors.serialize(new Child(), List.of()).get("code"));
    assertFalse(Errors.serialize(new Deep(), List.of()).containsKey("status"));
  }

  @Test
  void neLeveJamaisEtRetireLesSecrets() {
    Map<String, Object> h = Errors.serialize(new Hostile(), List.of());
    assertEquals("", h.get("message"));
    assertEquals("", h.get("stack"));
    assertFalse(h.containsKey("code"));
    Map<String, Object> s = Errors.serialize(new RuntimeException("mot hunter2"), List.of("hunter2"));
    assertEquals("mot [REDACTED]", s.get("message"));
    // Pile filtrée : ni la sonde, ni JUnit ; 15 cadres au plus.
    String stack = (String) s.get("stack");
    assertFalse(stack.contains("org.junit.") || stack.contains("com.orqea.varia."));
    RuntimeException many = new RuntimeException();
    StackTraceElement[] frames = new StackTraceElement[20];
    for (int i = 0; i < 20; i++) frames[i] = new StackTraceElement("a.B", "m" + i, "B.java", i);
    many.setStackTrace(frames);
    assertEquals(15, Errors.stack(many).split("\n").length);
  }

  @Test
  void deepNeDepassePas10Classes() {
    class L0 extends RuntimeException {}
    class L1 extends L0 {}
    class L2 extends L1 {}
    class L3 extends L2 {}
    class L4 extends L3 {}
    class L5 extends L4 {}
    class L6 extends L5 {}
    class L7 extends L6 {}
    assertEquals(10, ((List<?>) Errors.serialize(new L7(), List.of()).get("constructorChain")).size());
  }
}
