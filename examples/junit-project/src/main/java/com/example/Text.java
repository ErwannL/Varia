package com.example;

/** Cible appelée par une autre classe (profondeur 1). */
public final class Text {
  private Text() {}

  public static int inner(String x) {
    return x.length();
  }
}
