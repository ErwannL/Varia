package com.orqea.varia.probe;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.math.BigInteger;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Valeurs Java de la sonde : reconstruction d'une valeur étiquetée du plan (norme §9), copie profonde
 * des arguments et application d'UNE mutation sur la copie.
 */
public final class Values {
  private Values() {}

  /** Mutation inapplicable en Java ; {@code reason} est écrit dans {@code MUTATE_CALL.reason}. */
  public static final class NotApplicable extends Exception {
    private static final long serialVersionUID = 1L;
    final String reason;

    NotApplicable(String reason) {
      super(reason, null, false, false);
      this.reason = reason;
    }
  }

  /** Reconstruit une valeur étiquetée (JSON lu par {@link Json#parse}). */
  public static Object deserialize(Object json) throws NotApplicable {
    if (json instanceof Long) {
      long l = (Long) json;
      return l == (int) l ? (Object) (int) l : (Object) l;
    }
    if (json instanceof List) {
      List<Object> out = new ArrayList<>();
      for (Object x : (List<?>) json) out.add(deserialize(x));
      return out;
    }
    if (!(json instanceof Map)) return json;
    Map<?, ?> m = (Map<?, ?>) json;
    Object t = m.get("$t");
    if (t == null) return fields(m);
    switch (String.valueOf(t)) {
      case "number":
        String v = String.valueOf(m.get("v"));
        return v.equals("-0") ? -0.0 : Double.parseDouble(v);
      case "bigint":
        return new BigInteger(String.valueOf(m.get("v")));
      case "date":
        if (m.get("v") == null) throw new NotApplicable("VALUE_NOT_RECONSTRUCTIBLE");
        try {
          return Instant.parse(String.valueOf(m.get("v")));
        } catch (java.time.format.DateTimeParseException e) {
          throw new NotApplicable("VALUE_NOT_RECONSTRUCTIBLE");
        }
      case "regexp":
        return Pattern.compile(String.valueOf(m.get("source")));
      case "map":
        Map<Object, Object> map = new LinkedHashMap<>();
        for (Object e : (List<?>) m.get("entries")) {
          List<?> pair = (List<?>) e;
          map.put(deserialize(pair.get(0)), deserialize(pair.get(1)));
        }
        return map;
      case "set":
        Set<Object> set = new LinkedHashSet<>();
        for (Object x : (List<?>) m.get("values")) set.add(deserialize(x));
        return set;
      case "bytes":
        return Base64.getDecoder().decode(String.valueOf(m.get("base64")));
      case "error":
        return new RuntimeException(String.valueOf(m.get("message")));
      case "object":
        if (m.containsKey("ctor")) throw new NotApplicable("VALUE_NOT_RECONSTRUCTIBLE");
        return fields((Map<?, ?>) m.get("v"));
      case "undefined":
        // Java n'a pas de valeur « absente » distincte de null (norme §5).
        throw new NotApplicable("UNDEFINED_UNSUPPORTED");
      default:
        throw new NotApplicable("VALUE_NOT_RECONSTRUCTIBLE");
    }
  }

  private static Map<String, Object> fields(Map<?, ?> m) throws NotApplicable {
    Map<String, Object> out = new LinkedHashMap<>();
    for (Map.Entry<?, ?> e : m.entrySet()) out.put((String) e.getKey(), deserialize(e.getValue()));
    return out;
  }

  // ---------------------------------------------------------------- copie profonde

  /** Valeurs immuables : partagées telles quelles. */
  static boolean immutable(Object v) {
    return v == null
        || v instanceof String
        || v instanceof Number
        || v instanceof Boolean
        || v instanceof Character
        || v instanceof Enum
        || v instanceof Pattern
        || v instanceof java.time.temporal.TemporalAccessor
        || v instanceof Class;
  }

  /**
   * Copie profonde (collections, tableaux, objets sérialisables, autres objets champ par champ) ;
   * {@link NotApplicable} « NOT_COPYABLE » si un objet ne peut pas être copié sans risque.
   */
  public static Object deepCopy(Object v, IdentityHashMap<Object, Object> seen) throws NotApplicable {
    if (immutable(v)) return v;
    if (seen.containsKey(v)) return seen.get(v);
    if (v instanceof Map) {
      Map<Object, Object> out = new LinkedHashMap<>();
      seen.put(v, out);
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet())
        out.put(e.getKey(), deepCopy(e.getValue(), seen));
      return out;
    }
    if (v instanceof Set) {
      Set<Object> out = new LinkedHashSet<>();
      seen.put(v, out);
      for (Object x : (Set<?>) v) out.add(deepCopy(x, seen));
      return out;
    }
    if (v instanceof Collection) {
      List<Object> out = new ArrayList<>();
      seen.put(v, out);
      for (Object x : (Collection<?>) v) out.add(deepCopy(x, seen));
      return out;
    }
    Class<?> c = v.getClass();
    if (c.isArray()) {
      int n = Array.getLength(v);
      Object out = Array.newInstance(c.getComponentType(), n);
      seen.put(v, out);
      for (int i = 0; i < n; i++) Array.set(out, i, deepCopy(Array.get(v, i), seen));
      return out;
    }
    if (v instanceof Serializable) {
      Object out = roundTrip((Serializable) v);
      seen.put(v, out);
      return out;
    }
    throw new NotApplicable("NOT_COPYABLE");
  }

  /** Copie par sérialisation Java ; échec ⇒ « NOT_COPYABLE ». */
  static Object roundTrip(Serializable v) throws NotApplicable {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
        out.writeObject(v);
      }
      ClassLoader loader = v.getClass().getClassLoader();
      try (ObjectInputStream in =
          new ObjectInputStream(new ByteArrayInputStream(bytes.toByteArray())) {
            @Override
            protected Class<?> resolveClass(java.io.ObjectStreamClass d)
                throws java.io.IOException, ClassNotFoundException {
              return loader == null ? super.resolveClass(d) : Class.forName(d.getName(), false, loader);
            }
          }) {
        return in.readObject();
      }
    } catch (java.io.IOException | ClassNotFoundException e) {
      throw new NotApplicable("NOT_COPYABLE");
    }
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Applique UNE mutation ({@code path} : indice d'argument puis clés / indices) sur une copie des
   * arguments ; les types des paramètres sont vérifiés (Java est typé : un argument d'un type
   * impossible n'est jamais forcé, {@code TYPE_MISMATCH}).
   */
  public static Object[] apply(Object[] args, Class<?>[] params, List<?> path, String op, Object value)
      throws NotApplicable {
    int index = Integer.parseInt(String.valueOf(path.get(0)));
    if (index < 0 || index >= args.length) throw new NotApplicable("PATH_NOT_FOUND");
    // « Absent » dans un conteneur (clé de Map) = clé retirée ; un argument Java ne peut pas l'être.
    boolean absent = value instanceof Map && "undefined".equals(((Map<?, ?>) value).get("$t"));
    boolean delete = op.equals("delete") || (absent && path.size() > 1);
    Object v = delete ? null : deserialize(value);
    Object[] copy = new Object[args.length];
    IdentityHashMap<Object, Object> seen = new IdentityHashMap<>();
    for (int i = 0; i < args.length; i++) copy[i] = deepCopy(args[i], seen);
    if (path.size() == 1) {
      // Un argument Java ne peut pas être omis.
      if (delete) throw new NotApplicable("UNDEFINED_UNSUPPORTED");
      copy[index] = coerce(v, params[index]);
      return copy;
    }
    Object parent = copy[index];
    for (Object seg : path.subList(1, path.size() - 1)) parent = child(parent, String.valueOf(seg));
    put(parent, String.valueOf(path.get(path.size() - 1)), v, delete);
    return copy;
  }

  /** Conversion vers le type du paramètre (élargissement numérique de Java), sinon TYPE_MISMATCH. */
  static Object coerce(Object v, Class<?> type) throws NotApplicable {
    Class<?> boxed = box(type);
    if (v == null) {
      if (type.isPrimitive()) throw new NotApplicable("TYPE_MISMATCH");
      return null;
    }
    if (boxed.isInstance(v)) return v;
    if ((v instanceof Integer || v instanceof Long) && boxed == Long.class)
      return ((Number) v).longValue();
    if ((v instanceof Integer || v instanceof Long) && boxed == Double.class)
      return ((Number) v).doubleValue();
    if (v instanceof List && type.isArray()) {
      List<?> l = (List<?>) v;
      Object out = Array.newInstance(type.getComponentType(), l.size());
      for (int i = 0; i < l.size(); i++) Array.set(out, i, coerce(l.get(i), type.getComponentType()));
      return out;
    }
    throw new NotApplicable("TYPE_MISMATCH");
  }

  static Class<?> box(Class<?> t) {
    if (!t.isPrimitive()) return t;
    if (t == int.class) return Integer.class;
    if (t == long.class) return Long.class;
    if (t == double.class) return Double.class;
    if (t == boolean.class) return Boolean.class;
    if (t == float.class) return Float.class;
    if (t == short.class) return Short.class;
    if (t == byte.class) return Byte.class;
    return Character.class;
  }

  private static Object child(Object parent, String seg) throws NotApplicable {
    if (parent instanceof Map) {
      Map<?, ?> m = (Map<?, ?>) parent;
      if (!m.containsKey(seg)) throw new NotApplicable("PATH_NOT_FOUND");
      return m.get(seg);
    }
    if (parent instanceof List) {
      List<?> l = (List<?>) parent;
      int i = indexIn(seg, l.size());
      return l.get(i);
    }
    if (parent != null && parent.getClass().isArray()) return Array.get(parent, indexIn(seg, Array.getLength(parent)));
    if (parent == null || immutable(parent)) throw new NotApplicable("PATH_NOT_FOUND");
    return Serializer.read(field(parent, seg), parent);
  }

  private static int indexIn(String seg, int size) throws NotApplicable {
    if (!seg.matches("\\d{1,9}") || Integer.parseInt(seg) >= size)
      throw new NotApplicable("PATH_NOT_FOUND");
    return Integer.parseInt(seg);
  }

  private static Field field(Object o, String name) throws NotApplicable {
    for (Field f : Serializer.instanceFields(o.getClass()))
      if (f.getName().equals(name)) return f;
    throw new NotApplicable("PATH_NOT_FOUND");
  }

  @SuppressWarnings("unchecked")
  private static void put(Object parent, String key, Object v, boolean delete) throws NotApplicable {
    if (parent instanceof Map) {
      Map<Object, Object> m = (Map<Object, Object>) parent;
      if (delete) m.remove(key);
      else m.put(key, v);
      return;
    }
    if (delete) throw new NotApplicable("UNDEFINED_UNSUPPORTED");
    if (parent instanceof List) {
      List<Object> l = (List<Object>) parent;
      l.set(indexIn(key, l.size()), v);
      return;
    }
    if (parent != null && parent.getClass().isArray()) {
      int i = indexIn(key, Array.getLength(parent));
      Array.set(parent, i, coerce(v, parent.getClass().getComponentType()));
      return;
    }
    if (parent == null || immutable(parent)) throw new NotApplicable("PATH_NOT_FOUND");
    Field f = field(parent, key);
    Object value = coerce(v, f.getType());
    try {
      f.setAccessible(true);
      f.set(parent, value);
    } catch (RuntimeException | IllegalAccessException e) {
      throw new NotApplicable("PATH_NOT_FOUND");
    }
  }
}
