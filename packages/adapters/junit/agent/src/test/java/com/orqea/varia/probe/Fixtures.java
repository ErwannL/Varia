package com.orqea.varia.probe;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Classes et constructeur des valeurs natives du vocabulaire neutre {@code $in} (conformance/README). */
final class Fixtures {
  private Fixtures() {}

  /** Classe utilisateur {@code Point} (cas objects/instance). */
  static final class Point {
    Object x;
    Object y;
  }

  static class AppError extends RuntimeException {
    AppError(String m) {
      super(m);
    }
  }

  static final class ValidationError extends AppError {
    ValidationError(String m) {
      super(m);
    }
  }

  static final class HttpError extends RuntimeException {
    final Object code;
    final Object status;

    HttpError(String m, Object code, Object status) {
      super(m);
      this.code = code;
      this.status = status;
    }
  }

  /** « Fonction nommée rappel » : objet fonctionnel d'une classe nommée. */
  @SuppressWarnings("checkstyle:TypeName")
  static final class rappel implements Runnable {
    @Override
    public void run() {}
  }

  /** Concept absent de Java (norme §5 : « absent — non applicable »). */
  static final class Absent extends Exception {
    private static final long serialVersionUID = 1L;

    Absent() {
      super("undefined", null, false, false);
    }
  }

  static Object build(Object in) throws Absent {
    return build(in, null);
  }

  @SuppressWarnings("unchecked")
  static Object build(Object in, Object[] parent) throws Absent {
    if (in instanceof Long) {
      long l = (Long) in;
      return l == (int) l ? (Object) (int) l : (Object) l;
    }
    if (in instanceof List) {
      List<Object> out = new ArrayList<>();
      Object[] self = {out};
      for (Object x : (List<?>) in) out.add(build(x, self));
      return out;
    }
    if (!(in instanceof Map)) return in;
    Map<String, Object> m = (Map<String, Object>) in;
    Object kind = m.get("$in");
    if (kind == null) return entries(m.entrySet().stream().map(e -> List.of(e.getKey(), e.getValue() == null ? NULL : e.getValue())).toList());
    switch ((String) kind) {
      case "object":
        return entries((List<Object>) m.get("entries"));
      case "instance":
        Point p = new Point();
        for (Object e : (List<Object>) m.get("entries")) {
          List<Object> pair = (List<Object>) e;
          Object v = build(pair.get(1));
          if (pair.get(0).equals("x")) p.x = v;
          else p.y = v;
        }
        return p;
      case "undefined":
        throw new Absent();
      case "number":
        String v = (String) m.get("v");
        return v.equals("-0") ? -0.0 : Double.parseDouble(v);
      case "bigint":
        return new java.math.BigInteger((String) m.get("v"));
      case "date":
        return java.time.Instant.parse((String) m.get("v"));
      case "map":
        Map<Object, Object> map = new LinkedHashMap<>();
        for (Object e : (List<Object>) m.get("entries")) {
          List<Object> pair = (List<Object>) e;
          map.put(build(pair.get(0)), build(pair.get(1)));
        }
        return map;
      case "set":
        Set<Object> set = new LinkedHashSet<>();
        for (Object x : (List<Object>) m.get("values")) set.add(build(x));
        return set;
      case "bytes":
        return Base64.getDecoder().decode((String) m.get("base64"));
      case "error":
        return error(m);
      case "function":
        return new rappel();
      case "string":
        return ((String) m.get("repeat")).repeat(((Long) m.get("times")).intValue());
      case "array":
        List<Object> list = new ArrayList<>();
        for (int i = 0; i < (Long) m.get("times"); i++) list.add(build(m.get("repeat")));
        return list;
      case "nest":
        Object leaf = build(m.get("leaf"));
        for (int i = 0; i < (Long) m.get("depth"); i++) {
          Map<String, Object> o = new LinkedHashMap<>();
          o.put((String) m.get("key"), leaf);
          leaf = o;
        }
        return leaf;
      default:
        // "self" : le conteneur englobant le plus proche.
        return parent[0];
    }
  }

  private static final Object NULL = new Object();

  private static Map<String, Object> entries(List<?> pairs) throws Absent {
    Map<String, Object> out = new LinkedHashMap<>();
    Object[] self = {out};
    for (Object e : pairs) {
      List<?> pair = (List<?>) e;
      Object raw = pair.get(1) == NULL ? null : pair.get(1);
      out.put((String) pair.get(0), build(raw, self));
    }
    return out;
  }

  private static RuntimeException error(Map<String, Object> m) {
    String message = (String) m.get("message");
    List<?> chain = (List<?>) m.getOrDefault("chain", List.of());
    String first = chain.isEmpty() ? "" : (String) chain.get(0);
    if (first.equals("ValidationError")) return new ValidationError(message);
    if (first.equals("HttpError")) return new HttpError(message, m.get("code"), m.get("status"));
    return new RuntimeException(message);
  }
}
