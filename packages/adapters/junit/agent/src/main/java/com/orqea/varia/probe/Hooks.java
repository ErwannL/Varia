package com.orqea.varia.probe;

import java.lang.reflect.Method;

/** Points d'entrée appelés par le code inséré dans les méthodes cibles (doivent rester publics). */
public final class Hooks {
  private Hooks() {}

  /** Entrée d'une méthode cible ; {@code null} si la sonde est inactive ou a échoué. */
  public static Object enter(Method m, Object[] args) {
    Probe p = Probe.current;
    String module = Targets.moduleOf(m.getDeclaringClass().getName());
    if (p == null || module == null) return null;
    return p.enter(module, Targets.exportOf(m), args, m.getParameterTypes());
  }

  /** Arguments mutés à substituer, ou {@code null}. */
  public static Object[] replaced(Object call) {
    return call == null ? null : ((Probe.Call) call).replaced;
  }

  /** Sortie d'une méthode cible : valeur rendue (éventuellement une future dérivée). */
  public static Object exit(Object call, Object result, Throwable thrown, Method m) {
    Probe p = Probe.current;
    if (call == null || p == null) return result;
    return p.exit((Probe.Call) call, result, thrown, m.getReturnType());
  }
}
