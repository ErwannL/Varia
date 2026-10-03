package com.example;

import java.util.LinkedHashMap;
import java.util.Map;

/** Écho, boucle infinie, sortie du processus, valeur non déterministe. */
public final class Values {
  private Values() {}

  /** Renvoie l'argument tel quel, sans validation (ECHO). */
  public static Map<String, Object> echoValue(Object x) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("received", x);
    return out;
  }

  /** Termine pour un entier positif ou nul ; boucle indéfiniment pour NaN, décimal, négatif, infini. */
  public static String repeat(String label, double count) {
    double n = count;
    while (n != 0) {
      n -= 1;
    }
    return label;
  }

  /** Quitte le processus pour "boom". */
  public static String exitOn(String flag) {
    if ("boom".equals(flag)) System.exit(1);
    return flag;
  }

  /** Non déterministe. */
  public static String stamp(String label) {
    return label + ":" + System.nanoTime();
  }
}
