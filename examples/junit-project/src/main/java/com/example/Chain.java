package com.example;

/** Appel transitif vers une autre classe cible (profondeurs 0 et 1). */
public final class Chain {
  private Chain() {}

  public static int outer(String x) {
    return Text.inner(x);
  }
}
