package com.orqea.varia.probe;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Correspondances classe ↔ fichier source (configuration écrite par l'adaptateur hors du projet) et
 * identité des tests JUnit dérivée de l'identifiant unique (même règle que {@code junit-report.ts}).
 */
public final class Targets {
  /** Classe de premier niveau ciblée → module (chemin relatif POSIX de son fichier source). */
  static final Map<String, String> MODULES = new ConcurrentHashMap<>();
  /** Racines des sources de test, relatives au projet. */
  static final List<String> TEST_ROOTS = new ArrayList<>();

  private Targets() {}

  /** Module d'une classe (classes imbriquées : celui de la classe englobante), sinon {@code null}. */
  public static String moduleOf(String className) {
    int i = className.indexOf('$');
    return MODULES.get(i < 0 ? className : className.substring(0, i));
  }

  /** Nom d'export : nom de la méthode, préfixé des classes imbriquées (« Inner.m »). */
  static String exportOf(Method m) {
    String n = m.getDeclaringClass().getName();
    int i = n.indexOf('$');
    return i < 0 ? m.getName() : n.substring(i + 1).replace('$', '.') + "." + m.getName();
  }

  static String decode(String s) {
    StringBuilder b = new StringBuilder();
    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '%' && i + 2 < s.length() && s.substring(i + 1, i + 3).matches("[0-9A-Fa-f]{2}")) {
        bytes.write(Integer.parseInt(s.substring(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
      if (bytes.size() > 0) {
        b.append(bytes.toString(java.nio.charset.StandardCharsets.UTF_8));
        bytes.reset();
      }
      b.append(c);
    }
    b.append(bytes.toString(java.nio.charset.StandardCharsets.UTF_8));
    return b.toString();
  }

  /**
   * Nom Varia d'un test : {@code <classe>#<méthode>(<types>)} suivi de {@code [n]} par invocation
   * (test paramétré, test dynamique) ; identifiant non Jupiter : l'identifiant lui-même.
   */
  public static String testName(String uniqueId) {
    String cls = null;
    String method = null;
    StringBuilder suffix = new StringBuilder();
    for (String seg : uniqueId.split("/")) {
      if (!seg.startsWith("[") || !seg.endsWith("]") || seg.indexOf(':') < 0) return uniqueId;
      String type = seg.substring(1, seg.indexOf(':'));
      String value = decode(seg.substring(seg.indexOf(':') + 1, seg.length() - 1));
      switch (type) {
        case "class":
          cls = value;
          break;
        case "nested-class":
          cls = cls + "$" + value;
          break;
        case "method":
        case "test-template":
        case "test-factory":
          method = value;
          break;
        case "test-template-invocation":
        case "dynamic-test":
        case "dynamic-container":
          suffix.append(" [").append(value.replace("#", "")).append(']');
          break;
        default:
          break;
      }
    }
    if (cls == null || method == null) return uniqueId;
    return cls + "#" + method + suffix;
  }

  /** Fichier source (relatif, POSIX) de la classe de test : première racine où il existe. */
  public static String testFile(String uniqueId, Path projectRoot) {
    String name = testName(uniqueId);
    int hash = name.indexOf('#');
    if (hash < 0) return "";
    String cls = name.substring(0, hash);
    int dollar = cls.indexOf('$');
    String rel = (dollar < 0 ? cls : cls.substring(0, dollar)).replace('.', '/') + ".java";
    for (String root : TEST_ROOTS)
      if (Files.exists(projectRoot.resolve(root).resolve(rel))) return root + "/" + rel;
    return (TEST_ROOTS.isEmpty() ? "src/test/java" : TEST_ROOTS.get(0)) + "/" + rel;
  }
}
