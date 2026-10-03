package com.example;

/** Appel interne à la même classe (méthode privée : non observée, listée). */
public final class MathOps {
  private MathOps() {}

  private static int helper(int a) {
    return a * 2;
  }

  public static int sumLocal(int a, int b) {
    return helper(a) + b;
  }
}
