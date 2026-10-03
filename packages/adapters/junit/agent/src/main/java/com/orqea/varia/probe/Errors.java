package com.orqea.varia.probe;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Sérialisation d'erreur (norme §6) : ne lève jamais (accès hostiles ⇒ champs vides). */
public final class Errors {
  /** Préfixes des cadres retirés de la pile : sonde, ByteBuddy, JDK interne, JUnit. */
  static final String[] HIDDEN = {
    "com.orqea.varia.", "java.base/jdk.internal.", "jdk.internal.", "org.junit.", "sun.reflect."
  };

  private Errors() {}

  /** Message d'une erreur ({@code getMessage()} qui lève ⇒ chaîne vide). */
  static String message(Throwable t) {
    try {
      String m = t.getMessage();
      return m == null ? "" : m;
    } catch (RuntimeException e) {
      return "";
    }
  }

  static String scrub(String s, List<String> secrets) {
    for (String x : secrets) s = s.replace(x, "[REDACTED]");
    return s;
  }

  /** Forme sérialisée ({@code name}, {@code message}, {@code code}?, {@code status}?, pile, chaîne). */
  public static Map<String, Object> serialize(Throwable e, List<String> secrets) {
    Map<String, Object> out = new LinkedHashMap<>();
    Class<?> c = e.getClass();
    out.put("name", scrub(Serializer.simpleName(c), secrets));
    out.put("message", scrub(message(e), secrets));
    Object code = property(e, "getErrorCode", "code");
    if (code == null) code = property(e, "getCode", "code");
    if (code != null) out.put("code", scrub(String.valueOf(code), secrets));
    Object status = property(e, "getStatus", "status");
    if (status instanceof Number && Double.isFinite(((Number) status).doubleValue())) {
      Object n = Serializer.ser(status, new Serializer.Options(), "", 0, new java.util.IdentityHashMap<>());
      out.put("status", n);
    }
    out.put("stack", scrub(stack(e), secrets));
    List<Object> chain = new ArrayList<>();
    for (Class<?> k = c; k != Object.class && chain.size() < 10; k = k.getSuperclass())
      chain.add(Serializer.simpleName(k));
    out.put("constructorChain", chain);
    return out;
  }

  /** Pile filtrée : 15 cadres au plus, sans la sonde, le JDK interne ni le lanceur. */
  static String stack(Throwable e) {
    List<String> lines = new ArrayList<>();
    StackTraceElement[] frames;
    try {
      frames = e.getStackTrace();
    } catch (RuntimeException x) {
      frames = new StackTraceElement[0];
    }
    for (StackTraceElement f : frames) {
      String s = f.toString();
      boolean hidden = false;
      for (String h : HIDDEN) hidden |= s.startsWith(h) || f.getClassName().startsWith(h);
      if (!hidden && lines.size() < 15) lines.add("    at " + s);
    }
    return String.join("\n", lines);
  }

  /** Accesseur public sans argument, sinon champ (même privé) ; {@code null} si absent ou hostile. */
  static Object property(Object o, String getter, String field) {
    try {
      Method m = o.getClass().getMethod(getter);
      return m.invoke(o);
    } catch (ReflectiveOperationException | RuntimeException ignored) {
      // Pas d'accesseur lisible : on essaie le champ.
    }
    for (Class<?> k = o.getClass(); k != null; k = k.getSuperclass()) {
      try {
        Field f = k.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(o);
      } catch (ReflectiveOperationException | RuntimeException ignored) {
        // Champ absent à ce niveau : classe parente.
      }
    }
    return null;
  }
}
