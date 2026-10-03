package com.orqea.varia.probe;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Date;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Sérialisation étiquetée (norme §5), redaction (§7) et empreinte des arguments (§8.3), à
 * l'identique de la sonde de référence JavaScript ({@code serialize.cjs}).
 *
 * <p>Correspondances propres à Java (DECISIONS) : une {@link Map} dont toutes les clés sont des
 * chaînes est l'« objet simple » (comme un {@code dict} Python à clés {@code str}) ; une {@link Map}
 * à clés quelconques est une {@code map} ; un objet d'une autre classe est une instance {@code
 * {"$t":"object","ctor":…}} ; ce que la sonde ne sait pas lire (classes du JDK encapsulées, flux,
 * types déclarés opaques) est {@code opaque}.
 */
public final class Serializer {
  static final long MAX_SAFE = 9007199254740991L;
  private static final DateTimeFormatter ISO_MILLIS =
      DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

  private Serializer() {}

  /** Options d'une sérialisation (équivalent de {@code SerializeOptions}). */
  public static final class Options {
    Set<String> fields = Set.of();
    List<Pattern> patterns = List.of();
    Set<String> paths = Set.of();
    String hmacKey = "varia";
    Set<String> opaqueTypes = Set.of();
    int maxDepth = 8;
    int maxString = 4096;
    int maxItems = 200;
    /** Collecteur des chaînes masquées (retirées des messages d'erreur), ou {@code null}. */
    List<String> secrets;

    Options copy() {
      Options o = new Options();
      o.fields = fields;
      o.patterns = patterns;
      o.paths = paths;
      o.hmacKey = hmacKey;
      o.opaqueTypes = opaqueTypes;
      o.maxDepth = maxDepth;
      o.maxString = maxString;
      o.maxItems = maxItems;
      o.secrets = secrets;
      return o;
    }
  }

  /** Règles de redaction compilées depuis {@code VARIA_REDACT} (norme §7). */
  public static final class Redaction {
    final Set<String> fields;
    final List<Pattern> patterns;
    final List<String> skipPaths;
    final String hmacKey;
    final Set<String> opaqueTypes;

    Redaction(Map<?, ?> redact, Set<String> opaqueTypes) {
      Set<String> f = new java.util.HashSet<>();
      for (Object x : list(redact.get("fields"))) f.add(String.valueOf(x).toLowerCase());
      List<Pattern> p = new ArrayList<>();
      for (Object x : list(redact.get("patterns")))
        p.add(Pattern.compile(String.valueOf(x), Pattern.CASE_INSENSITIVE));
      List<String> s = new ArrayList<>();
      for (Object x : list(redact.get("skipPaths"))) s.add(String.valueOf(x));
      Object key = redact.get("hmacKey");
      this.fields = f;
      this.patterns = p;
      this.skipPaths = s;
      this.hmacKey = key == null ? "varia" : String.valueOf(key);
      this.opaqueTypes = opaqueTypes;
    }

    private static List<?> list(Object v) {
      return v instanceof List ? (List<?>) v : List.of();
    }

    /** Options des arguments d'un appel à {@code export} : chemins « export#chemin » de cet export. */
    Options argsOptions(String export, List<String> secrets) {
      Options o = new Options();
      Set<String> paths = new java.util.HashSet<>();
      for (String p : skipPaths)
        if (p.startsWith(export + "#")) paths.add(p.substring(export.length() + 1));
      o.fields = fields;
      o.patterns = patterns;
      o.paths = paths;
      o.hmacKey = hmacKey;
      o.opaqueTypes = opaqueTypes;
      o.secrets = secrets;
      return o;
    }
  }

  /** Sérialise une valeur racine (chemin de base {@code root}, ex. « arg0 »). */
  public static Object serialize(Object value, Options o, String root) {
    if (o.paths.contains(root)) return redacted(value, o);
    return ser(value, o, root, 0, new IdentityHashMap<>());
  }

  /** Sérialise une liste d'arguments (chemins arg0, arg1…). */
  public static List<Object> serializeArgs(Object[] args, Options o) {
    List<Object> out = new ArrayList<>();
    for (int i = 0; i < args.length; i++) out.add(serialize(args[i], o, "arg" + i));
    return out;
  }

  /** Empreinte des arguments : sha256 du JSON canonique de leur forme (déjà redigée). */
  public static String fingerprint(Object serialized) {
    return Json.sha256(Json.canonical(serialized, 0));
  }

  private static Map<String, Object> tag(String t) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("$t", t);
    return m;
  }

  private static Map<String, Object> tag(String t, String k, Object v) {
    Map<String, Object> m = tag(t);
    m.put(k, v);
    return m;
  }

  static boolean isFunction(Object v) {
    Class<?> c = v.getClass();
    if (c.isSynthetic() || v instanceof Runnable) return true;
    if (v instanceof java.util.concurrent.Callable) return true;
    for (Class<?> k = c; k != null; k = k.getSuperclass())
      for (Class<?> i : k.getInterfaces())
        if (i.getName().startsWith("java.util.function.")) return true;
    return false;
  }

  /** Classe ou supertype déclaré opaque (configuration {@code opaqueTypes}). */
  static boolean declaredOpaque(Class<?> c, Set<String> names) {
    if (names.isEmpty()) return false;
    for (Class<?> k = c; k != null; k = k.getSuperclass()) {
      if (names.contains(k.getName())) return true;
      for (Class<?> i : k.getInterfaces()) if (names.contains(i.getName())) return true;
    }
    return false;
  }

  /** Objets à identité ou ressource (flux, fils, futures…) : jamais lus champ par champ. */
  static boolean builtinOpaque(Object v) {
    return v instanceof AutoCloseable
        || v instanceof Class
        || v instanceof ClassLoader
        || v instanceof java.util.concurrent.Future
        || v instanceof java.util.Iterator
        || v instanceof java.util.Optional
        || v instanceof Enum;
  }

  static String simpleName(Class<?> c) {
    String n = c.getSimpleName();
    if (!n.isEmpty()) return n;
    String full = c.getName();
    return full.substring(full.lastIndexOf('.') + 1);
  }

  private static boolean stringKeys(Map<?, ?> m) {
    for (Object k : m.keySet()) if (!(k instanceof String)) return false;
    return true;
  }

  /** Type runtime d'une valeur Java, au sens de la norme §5 (forme sérialisée). */
  public static String typeOf(Object v) {
    if (v == null) return "null";
    if (v instanceof String || v instanceof Character) return "string";
    if (v instanceof Boolean) return "boolean";
    if (v instanceof BigInteger) return "bigint";
    if (v instanceof Long) return Math.abs((Long) v) <= MAX_SAFE ? "number" : "bigint";
    if (v instanceof Integer
        || v instanceof Short
        || v instanceof Byte
        || v instanceof Double
        || v instanceof Float
        || v instanceof BigDecimal) return "number";
    if (v instanceof Instant
        || v instanceof Date
        || v instanceof ZonedDateTime
        || v instanceof OffsetDateTime) return "date";
    if (v instanceof Pattern) return "regexp";
    if (v instanceof Throwable) return "error";
    if (v instanceof byte[] || v instanceof ByteBuffer) return "bytes";
    if (v instanceof Map) return stringKeys((Map<?, ?>) v) ? "object" : "map";
    if (v instanceof Set) return "set";
    if (v instanceof Collection || v.getClass().isArray()) return "array";
    if (isFunction(v)) return "function";
    return "object";
  }

  private static Object number(double d) {
    if (Double.isNaN(d)) return tag("number", "v", "NaN");
    if (d == Double.POSITIVE_INFINITY) return tag("number", "v", "Infinity");
    if (d == Double.NEGATIVE_INFINITY) return tag("number", "v", "-Infinity");
    if (d == 0 && 1 / d < 0) return tag("number", "v", "-0");
    return d;
  }

  static Object ser(Object v, Options o, String path, int depth, IdentityHashMap<Object, Boolean> seen) {
    if (v == null) return null;
    if (v instanceof String) {
      String s = (String) v;
      if (s.length() <= o.maxString) return s;
      Map<String, Object> m = tag("string");
      m.put("truncated", true);
      m.put("length", (long) s.length());
      m.put("sha256", Json.sha256(s));
      return m;
    }
    if (v instanceof Character) return String.valueOf(v);
    if (v instanceof Boolean) return v;
    if (v instanceof Integer || v instanceof Short || v instanceof Byte)
      return ((Number) v).longValue();
    if (v instanceof Long) {
      long l = (Long) v;
      return Math.abs(l) <= MAX_SAFE ? (Object) l : tag("bigint", "v", Long.toString(l));
    }
    if (v instanceof BigInteger) return tag("bigint", "v", v.toString());
    if (v instanceof Double || v instanceof Float || v instanceof BigDecimal)
      return number(((Number) v).doubleValue());
    Class<?> c = v.getClass();
    if (declaredOpaque(c, o.opaqueTypes)) return tag("opaque", "kind", simpleName(c));
    if (isFunction(v)) {
      Map<String, Object> m = tag("opaque", "kind", "function");
      m.put("name", c.isSynthetic() ? "" : simpleName(c));
      return m;
    }
    if (seen.containsKey(v)) return tag("circular");
    String type = typeOf(v);
    if (depth >= o.maxDepth) return tag("truncated", "type", type);
    seen.put(v, Boolean.TRUE);
    try {
      return container(v, c, type, o, path, depth, seen);
    } finally {
      seen.remove(v);
    }
  }

  private static Object container(
      Object v, Class<?> c, String type, Options o, String path, int depth,
      IdentityHashMap<Object, Boolean> seen) {
    if (type.equals("date")) return tag("date", "v", ISO_MILLIS.format(instant(v).truncatedTo(ChronoUnit.MILLIS)));
    if (v instanceof java.time.temporal.TemporalAccessor
        || v instanceof java.time.temporal.TemporalAmount
        || v instanceof java.time.ZoneId) {
      // Valeur java.time sans instant (LocalDate, Duration…) : opaque, mais distinguable (empreinte).
      Map<String, Object> m = tag("opaque", "kind", simpleName(c));
      m.put("name", v.toString());
      return m;
    }
    if (v instanceof Pattern) {
      Pattern p = (Pattern) v;
      Map<String, Object> m = tag("regexp", "source", p.pattern());
      m.put("flags", flags(p.flags()));
      return m;
    }
    if (v instanceof Throwable) {
      Map<String, Object> m = tag("error", "name", simpleName(c));
      m.put("message", Errors.message((Throwable) v));
      return m;
    }
    if (v instanceof byte[]) return bytes("byte[]", (byte[]) v);
    if (v instanceof ByteBuffer) {
      ByteBuffer b = ((ByteBuffer) v).duplicate();
      byte[] out = new byte[b.remaining()];
      b.get(out);
      return bytes("ByteBuffer", out);
    }
    if (v instanceof Map) return map((Map<?, ?>) v, type, o, path, depth, seen);
    if (v instanceof Set) {
      List<Object> values = new ArrayList<>();
      int i = 0;
      for (Object x : (Set<?>) v) {
        if (i >= o.maxItems) break;
        values.add(ser(x, o, path + "[" + i + "]", depth + 1, seen));
        i++;
      }
      return tag("set", "values", values);
    }
    if (type.equals("array")) return array(v, o, path, depth, seen);
    if (builtinOpaque(v)) {
      Map<String, Object> m = tag("opaque", "kind", simpleName(c));
      if (v instanceof Enum) m.put("name", ((Enum<?>) v).name());
      return m;
    }
    return instance(v, c, o, path, depth, seen);
  }

  private static Instant instant(Object v) {
    if (v instanceof Date) return ((Date) v).toInstant();
    if (v instanceof ZonedDateTime) return ((ZonedDateTime) v).toInstant();
    if (v instanceof OffsetDateTime) return ((OffsetDateTime) v).toInstant();
    return (Instant) v;
  }

  /** Drapeaux d'une expression Java, en lettres JavaScript (i, m, s, u, x). */
  static String flags(int f) {
    StringBuilder b = new StringBuilder();
    if ((f & Pattern.CASE_INSENSITIVE) != 0) b.append('i');
    if ((f & Pattern.MULTILINE) != 0) b.append('m');
    if ((f & Pattern.DOTALL) != 0) b.append('s');
    if ((f & Pattern.UNICODE_CASE) != 0) b.append('u');
    if ((f & Pattern.COMMENTS) != 0) b.append('x');
    return b.toString();
  }

  private static Object bytes(String kind, byte[] data) {
    Map<String, Object> m = tag("bytes", "kind", kind);
    m.put("base64", Base64.getEncoder().encodeToString(data));
    return m;
  }

  private static Object map(
      Map<?, ?> v, String type, Options o, String path, int depth,
      IdentityHashMap<Object, Boolean> seen) {
    if (type.equals("object")) {
      Map<String, Object> fields = new LinkedHashMap<>();
      int i = 0;
      for (Map.Entry<?, ?> e : v.entrySet()) {
        if (i++ >= o.maxItems) break;
        field(fields, (String) e.getKey(), e.getValue(), o, path, depth, seen);
      }
      return fields.containsKey("$t") || fields.containsKey("$redacted")
          ? tag("object", "v", fields)
          : fields;
    }
    List<Object> entries = new ArrayList<>();
    int i = 0;
    for (Map.Entry<?, ?> e : v.entrySet()) {
      if (i >= o.maxItems) break;
      Object k = e.getKey();
      Object key = ser(k, o, path + ".<key" + i + ">", depth + 1, seen);
      // Une clé de Map textuelle est un nom de champ comme un autre : même redaction (norme 1.2).
      Object value =
          k instanceof String && redactedKey((String) k, path + "." + k, o)
              ? redacted(e.getValue(), o)
              : ser(e.getValue(), o, path + ".<value" + i + ">", depth + 1, seen);
      entries.add(java.util.Arrays.asList(key, value));
      i++;
    }
    return tag("map", "entries", entries);
  }

  private static Object array(
      Object v, Options o, String path, int depth, IdentityHashMap<Object, Boolean> seen) {
    List<Object> items = new ArrayList<>();
    int length;
    if (v instanceof Collection) {
      Collection<?> col = (Collection<?>) v;
      length = col.size();
      for (Object x : col) {
        if (items.size() >= o.maxItems) break;
        items.add(ser(x, o, path + "[" + items.size() + "]", depth + 1, seen));
      }
    } else {
      length = java.lang.reflect.Array.getLength(v);
      for (int i = 0; i < length && i < o.maxItems; i++)
        items.add(ser(java.lang.reflect.Array.get(v, i), o, path + "[" + i + "]", depth + 1, seen));
    }
    if (length <= items.size()) return items;
    Map<String, Object> m = tag("array");
    m.put("truncated", true);
    m.put("length", (long) length);
    m.put("items", items);
    return m;
  }

  /** Instance d'une classe : champs (record : composants) ; illisible (JDK encapsulé) ⇒ opaque. */
  private static Object instance(
      Object v, Class<?> c, Options o, String path, int depth,
      IdentityHashMap<Object, Boolean> seen) {
    Map<String, Object> fields = new LinkedHashMap<>();
    for (Field f : instanceFields(c)) {
      if (fields.size() >= o.maxItems) break;
      Object raw = read(f, v);
      if (raw == UNREADABLE) return tag("opaque", "kind", simpleName(c));
      field(fields, f.getName(), raw, o, path, depth, seen);
    }
    Map<String, Object> m = tag("object", "ctor", simpleName(c));
    m.put("v", fields);
    return m;
  }

  /** Marque d'un champ illisible. */
  static final Object UNREADABLE = new Object();

  /** Champs d'instance, de la classe la plus générale à la plus dérivée (record : ses composants). */
  static List<Field> instanceFields(Class<?> c) {
    List<Class<?>> chain = new ArrayList<>();
    for (Class<?> k = c; k != Object.class; k = k.getSuperclass()) chain.add(0, k);
    List<Field> list = new ArrayList<>();
    for (Class<?> k : chain)
      for (Field f : k.getDeclaredFields())
        if (!Modifier.isStatic(f.getModifiers()) && !f.isSynthetic()) list.add(f);
    return list;
  }

  /** Lecture d'un champ ; {@link #UNREADABLE} si l'accès est refusé (module du JDK encapsulé). */
  static Object read(Field f, Object target) {
    try {
      f.setAccessible(true);
      return f.get(target);
    } catch (RuntimeException | IllegalAccessException e) {
      return UNREADABLE;
    }
  }

  private static void field(
      Map<String, Object> fields, String key, Object raw, Options o, String path, int depth,
      IdentityHashMap<Object, Boolean> seen) {
    String child = path + "." + key;
    fields.put(key, redactedKey(key, child, o) ? redacted(raw, o) : ser(raw, o, child, depth + 1, seen));
  }

  /** Nom de champ (ou clé textuelle de Map) à masquer : champ listé, chemin listé ou motif. */
  static boolean redactedKey(String key, String childPath, Options o) {
    if (o.fields.contains(key.toLowerCase()) || o.paths.contains(childPath)) return true;
    for (Pattern p : o.patterns) if (p.matcher(key).find()) return true;
    return false;
  }

  /** Valeur masquée : empreinte HMAC de sa sérialisation (sans champs ni chemins, avec les motifs). */
  static Object redacted(Object raw, Options o) {
    if (raw instanceof String && !((String) raw).isEmpty() && o.secrets != null)
      o.secrets.add((String) raw);
    Options inner = o.copy();
    inner.fields = Set.of();
    inner.paths = Set.of();
    Object s = ser(raw, inner, "", 0, new IdentityHashMap<>());
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("$redacted", true);
    m.put("fingerprint", Json.hmac(o.hmacKey, Json.canonical(s, 0)));
    m.put("type", typeOf(raw));
    return m;
  }
}
