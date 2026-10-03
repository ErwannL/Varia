package com.orqea.varia.sample;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

/** Classe instrumentée par l'agent réel dans AgentTest (jamais chargée avant l'installation). */
public class Target {
  public static String name(Map<String, Object> m) {
    return ((String) m.get("name")).trim();
  }

  /** Surcharge : même export « twice ». */
  public static long twice(long x) {
    return x;
  }

  public static int twice(int x) {
    return helper(x) * 1;
  }

  private static int helper(int x) {
    return x * 2;
  }

  public static void fail(String why) {
    throw new IllegalArgumentException(why);
  }

  public static void nothing() {}

  public static CompletableFuture<Integer> later(int x) {
    return x > 0 ? CompletableFuture.completedFuture(x) : CompletableFuture.failedFuture(new IllegalStateException("neg"));
  }

  public static CompletionStage<Integer> stage(int x) {
    return CompletableFuture.supplyAsync(() -> x);
  }

  public static Object outer(List<String> l) {
    return Inner.size(l);
  }

  /** Classe imbriquée : export « Inner.size ». */
  public static final class Inner {
    public static int size(List<String> l) {
      return l.size();
    }
  }
}
