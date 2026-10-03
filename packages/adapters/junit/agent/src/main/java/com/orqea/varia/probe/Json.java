package com.orqea.varia.probe;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * JSON minimal de la sonde (aucune dépendance) : lecture, écriture à la manière de {@code
 * JSON.stringify}, JSON canonique (norme §10) et empreintes SHA-256 / HMAC-SHA256.
 *
 * <p>Modèle : {@code null}, {@link Boolean}, {@link String}, {@link Long} / {@link Integer} / {@link
 * Double}, {@link List}, {@link Map} à clés textuelles (ordre d'insertion).
 */
public final class Json {
  private static final long MAX_SAFE = 9007199254740991L;

  private Json() {}

  // ---------------------------------------------------------------- lecture

  /** Lit un texte JSON ; lève {@link IllegalArgumentException} s'il est invalide. */
  public static Object parse(String text) {
    Reader r = new Reader(text);
    Object v = r.value();
    r.skipSpace();
    if (r.pos != text.length()) throw r.error();
    return v;
  }

  private static final class Reader {
    final String s;
    int pos;

    Reader(String s) {
      this.s = s;
    }

    IllegalArgumentException error() {
      return new IllegalArgumentException("JSON invalide à la position " + pos);
    }

    void skipSpace() {
      while (pos < s.length() && " \t\r\n".indexOf(s.charAt(pos)) >= 0) pos++;
    }

    char peek() {
      if (pos >= s.length()) throw error();
      return s.charAt(pos);
    }

    void expect(String word) {
      if (!s.startsWith(word, pos)) throw error();
      pos += word.length();
    }

    Object value() {
      skipSpace();
      char c = peek();
      switch (c) {
        case '{':
          return object();
        case '[':
          return array();
        case '"':
          return string();
        case 't':
          expect("true");
          return Boolean.TRUE;
        case 'f':
          expect("false");
          return Boolean.FALSE;
        case 'n':
          expect("null");
          return null;
        default:
          return number();
      }
    }

    Map<String, Object> object() {
      pos++;
      Map<String, Object> out = new LinkedHashMap<>();
      skipSpace();
      if (peek() == '}') {
        pos++;
        return out;
      }
      while (true) {
        skipSpace();
        if (peek() != '"') throw error();
        String key = string();
        skipSpace();
        expect(":");
        out.put(key, value());
        skipSpace();
        char c = peek();
        pos++;
        if (c == '}') return out;
        if (c != ',') throw error();
      }
    }

    List<Object> array() {
      pos++;
      List<Object> out = new ArrayList<>();
      skipSpace();
      if (peek() == ']') {
        pos++;
        return out;
      }
      while (true) {
        out.add(value());
        skipSpace();
        char c = peek();
        pos++;
        if (c == ']') return out;
        if (c != ',') throw error();
      }
    }

    String string() {
      pos++;
      StringBuilder b = new StringBuilder();
      while (true) {
        char c = peek();
        pos++;
        if (c == '"') return b.toString();
        if (c != '\\') {
          b.append(c);
          continue;
        }
        char e = peek();
        pos++;
        switch (e) {
          case 'b':
            b.append('\b');
            break;
          case 'f':
            b.append('\f');
            break;
          case 'n':
            b.append('\n');
            break;
          case 'r':
            b.append('\r');
            break;
          case 't':
            b.append('\t');
            break;
          case 'u':
            if (pos + 4 > s.length()) throw error();
            try {
              b.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
            } catch (NumberFormatException x) {
              throw error();
            }
            pos += 4;
            break;
          default:
            // `"`, `\` et `/` : le caractère lui-même ; tout autre échappement est invalide.
            if ("\"\\/".indexOf(e) < 0) throw error();
            b.append(e);
        }
      }
    }

    Object number() {
      int start = pos;
      while (pos < s.length() && "+-0123456789.eE".indexOf(s.charAt(pos)) >= 0) pos++;
      String t = s.substring(start, pos);
      try {
        if (t.matches("-?\\d+")) {
          // Entier exact jusqu'à 2^53−1 (comme un nombre JSON en JavaScript), sinon flottant.
          BigDecimal d = new BigDecimal(t);
          if (d.abs().compareTo(BigDecimal.valueOf(MAX_SAFE)) <= 0) return d.longValueExact();
        }
        return Double.parseDouble(t);
      } catch (NumberFormatException x) {
        throw error();
      }
    }
  }

  // ---------------------------------------------------------------- écriture

  /** Texte JSON compact, clés dans l'ordre d'insertion (comme {@code JSON.stringify}). */
  public static String stringify(Object v) {
    StringBuilder b = new StringBuilder();
    write(b, v, false, 0, 0);
    return b.toString();
  }

  /** JSON canonique (norme §10) : clés triées, indentation 0 (empreintes) ou 2 (plan). */
  public static String canonical(Object v, int indent) {
    StringBuilder b = new StringBuilder();
    write(b, v, true, indent, 0);
    return b.toString();
  }

  private static void write(StringBuilder b, Object v, boolean sorted, int indent, int level) {
    if (v == null) {
      b.append("null");
    } else if (v instanceof String) {
      quote(b, (String) v);
    } else if (v instanceof Boolean) {
      b.append(v);
    } else if (v instanceof Double) {
      b.append(number((Double) v));
    } else if (v instanceof Number) {
      b.append(((Number) v).longValue());
    } else if (v instanceof List) {
      List<?> list = (List<?>) v;
      if (list.isEmpty()) {
        b.append("[]");
        return;
      }
      b.append('[');
      for (int i = 0; i < list.size(); i++) {
        if (i > 0) b.append(',');
        newline(b, indent, level + 1);
        write(b, list.get(i), sorted, indent, level + 1);
      }
      newline(b, indent, level);
      b.append(']');
    } else {
      Map<?, ?> map = (Map<?, ?>) v;
      if (map.isEmpty()) {
        b.append("{}");
        return;
      }
      List<String> keys = new ArrayList<>();
      for (Object k : map.keySet()) keys.add((String) k);
      if (sorted) keys.sort(Json::compareKeys);
      b.append('{');
      boolean first = true;
      for (String k : keys) {
        if (!first) b.append(',');
        first = false;
        newline(b, indent, level + 1);
        quote(b, k);
        b.append(indent > 0 ? ": " : ":");
        write(b, map.get(k), sorted, indent, level + 1);
      }
      newline(b, indent, level);
      b.append('}');
    }
  }

  private static void newline(StringBuilder b, int indent, int level) {
    if (indent == 0) return;
    b.append('\n');
    for (int i = 0; i < indent * level; i++) b.append(' ');
  }

  /** Clé « index » d'ECMAScript : entier décimal canonique de 0 à 2^32−2. */
  static boolean isIndex(String k) {
    if (!k.matches("0|[1-9]\\d{0,9}")) return false;
    return Long.parseLong(k) <= 4294967294L;
  }

  /** Ordre des propriétés d'ECMAScript : index par valeur, puis unités de code UTF-16. */
  static int compareKeys(String a, String b) {
    boolean ia = isIndex(a);
    boolean ib = isIndex(b);
    if (ia && ib) return Long.compare(Long.parseLong(a), Long.parseLong(b));
    if (ia) return -1;
    if (ib) return 1;
    return a.compareTo(b);
  }

  /** Chaîne échappée comme {@code JSON.stringify} (contrôles et surrogates isolés en \\uXXXX). */
  static void quote(StringBuilder b, String s) {
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':
          b.append("\\\"");
          break;
        case '\\':
          b.append("\\\\");
          break;
        case '\b':
          b.append("\\b");
          break;
        case '\f':
          b.append("\\f");
          break;
        case '\n':
          b.append("\\n");
          break;
        case '\r':
          b.append("\\r");
          break;
        case '\t':
          b.append("\\t");
          break;
        default:
          if (c < 0x20 || lone(s, i)) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
      }
    }
    b.append('"');
  }

  /** Surrogate sans sa moitié (JSON.stringify bien formé l'échappe). */
  private static boolean lone(String s, int i) {
    char c = s.charAt(i);
    if (Character.isHighSurrogate(c))
      return i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1));
    if (Character.isLowSurrogate(c)) return i == 0 || !Character.isHighSurrogate(s.charAt(i - 1));
    return false;
  }

  /**
   * Format de {@code Number.prototype.toString} (ECMAScript) pour un double fini : à partir des
   * chiffres les plus courts de {@link Double#toString} (Java 19+).
   */
  static String number(double d) {
    if (d == 0) return "0";
    String sign = d < 0 ? "-" : "";
    BigDecimal bd = new BigDecimal(Double.toString(Math.abs(d))).stripTrailingZeros();
    String digits = bd.unscaledValue().toString();
    int k = digits.length();
    int n = k - bd.scale();
    StringBuilder b = new StringBuilder(sign);
    if (k <= n && n <= 21) {
      b.append(digits);
      for (int i = k; i < n; i++) b.append('0');
    } else if (0 < n && n <= 21) {
      b.append(digits, 0, n).append('.').append(digits, n, k);
    } else if (-6 < n && n <= 0) {
      b.append("0.");
      for (int i = n; i < 0; i++) b.append('0');
      b.append(digits);
    } else {
      int e = n - 1;
      b.append(digits.charAt(0));
      if (k > 1) b.append('.').append(digits, 1, k);
      b.append('e').append(e >= 0 ? "+" : "-").append(Math.abs(e));
    }
    return b.toString();
  }

  // ---------------------------------------------------------------- empreintes

  /** Hexadécimal minuscule du SHA-256 des octets UTF-8. */
  public static String sha256(String s) {
    return digest("SHA-256", s);
  }

  /** HMAC-SHA256 (clé et message en UTF-8), hexadécimal minuscule. */
  public static String hmac(String key, String s) {
    return mac("HmacSHA256", key, s);
  }

  static String digest(String algorithm, String s) {
    try {
      return hex(MessageDigest.getInstance(algorithm).digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  static String mac(String algorithm, String key, String s) {
    try {
      Mac mac = Mac.getInstance(algorithm);
      byte[] k = key.getBytes(StandardCharsets.UTF_8);
      // Clé vide : HMAC la complète par des zéros ; SecretKeySpec refuse un tableau vide.
      mac.init(new SecretKeySpec(k.length == 0 ? new byte[1] : k, algorithm));
      return hex(mac.doFinal(s.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String hex(byte[] bytes) {
    StringBuilder b = new StringBuilder();
    for (byte x : bytes) b.append(String.format("%02x", x));
    return b.toString();
  }
}
