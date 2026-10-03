package com.orqea.varia.probe;

import static net.bytebuddy.matcher.ElementMatchers.isAbstract;
import static net.bytebuddy.matcher.ElementMatchers.isBridge;
import static net.bytebuddy.matcher.ElementMatchers.isMethod;
import static net.bytebuddy.matcher.ElementMatchers.isPublic;
import static net.bytebuddy.matcher.ElementMatchers.isSynthetic;
import static net.bytebuddy.matcher.ElementMatchers.not;
import static net.bytebuddy.matcher.ElementMatchers.returns;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.implementation.bytecode.assign.Assigner;
import net.bytebuddy.matcher.ElementMatcher;

/**
 * Agent {@code -javaagent:varia-junit-agent.jar=<config.json>} : instrumente les méthodes publiques
 * des classes ciblées (ByteBuddy, Advice inséré dans le code de la méthode) ; les méthodes non
 * publiques (appels internes) ne sont pas observées et sont listées {@code unsupported}.
 */
public final class Agent {
  private Agent() {}

  /** Méthodes observées : publiques, concrètes, ni synthétiques ni ponts. */
  static final ElementMatcher.Junction<MethodDescription> OBSERVED =
      isMethod().and(isPublic()).and(not(isAbstract())).and(not(isSynthetic())).and(not(isBridge()));

  public static void premain(String args, Instrumentation inst) {
    start(args, System.getenv(), ProcessHandle.current().pid(), inst);
  }

  /** Démarrage (testable) : configuration, sonde, écouteur d'exceptions non attrapées, instrumentation. */
  static Probe start(String configFile, Map<String, String> env, long pid, Instrumentation inst) {
    Map<?, ?> config = Probe.readJson(configFile);
    Set<String> opaque = new HashSet<>();
    for (Object o : list(config.get("opaqueTypes"))) opaque.add(String.valueOf(o));
    Probe p = Probe.fromEnv(env, pid, opaque);
    if (p == null) return null;
    Object classes = config.get("classes");
    if (classes instanceof Map)
      for (Map.Entry<?, ?> e : ((Map<?, ?>) classes).entrySet())
        Targets.MODULES.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
    for (Object r : list(config.get("testRoots"))) Targets.TEST_ROOTS.add(String.valueOf(r));
    Probe.current = p;
    p.hello(pid);
    Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
    Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
      p.uncaught(t, e, p.context.get());
      if (previous != null) previous.uncaughtException(t, e);
      else {
        System.err.print("Exception in thread \"" + t.getName() + "\" ");
        e.printStackTrace();
      }
    });
    if (inst != null) install(inst, p);
    return p;
  }

  private static List<?> list(Object v) {
    return v instanceof List ? (List<?>) v : List.of();
  }

  static void install(Instrumentation inst, Probe p) {
    new AgentBuilder.Default()
        .disableClassFormatChanges()
        .with(AgentBuilder.Listener.NoOp.INSTANCE)
        .type(t -> Targets.moduleOf(t.getName()) != null)
        .transform((builder, type, loader, module, domain) -> {
          announce(p, type);
          return builder
              .visit(Advice.to(ValueAdvice.class).on(OBSERVED.and(not(returns(void.class)))))
              .visit(Advice.to(VoidAdvice.class).on(OBSERVED.and(returns(void.class))));
        })
        .installOn(inst);
  }

  /** DISCOVER : méthodes observées et non observées (non publiques) d'une classe ciblée. */
  static void announce(Probe p, TypeDescription type) {
    List<String> wrapped = new ArrayList<>();
    List<String> unsupported = new ArrayList<>();
    String n = type.getName();
    int i = n.indexOf('$');
    String prefix = i < 0 ? "" : n.substring(i + 1).replace('$', '.') + ".";
    for (MethodDescription.InDefinedShape m :
        type.getDeclaredMethods().filter(isMethod().and(not(isSynthetic())).and(not(isBridge())))) {
      List<String> into = OBSERVED.matches(m) ? wrapped : unsupported;
      if (!into.contains(prefix + m.getName())) into.add(prefix + m.getName());
    }
    p.discover(Targets.moduleOf(n), wrapped, unsupported);
  }

  /** Code inséré dans une méthode qui rend une valeur. */
  public static final class ValueAdvice {
    private ValueAdvice() {}

    @Advice.OnMethodEnter
    static Object enter(
        @Advice.Origin Method m,
        @Advice.AllArguments(readOnly = false, typing = Assigner.Typing.DYNAMIC) Object[] args) {
      Object call = Hooks.enter(m, args);
      Object[] r = Hooks.replaced(call);
      if (r != null) args = r;
      return call;
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class)
    static void exit(
        @Advice.Origin Method m,
        @Advice.Enter Object call,
        @Advice.Return(readOnly = false, typing = Assigner.Typing.DYNAMIC) Object ret,
        @Advice.Thrown Throwable thrown) {
      ret = Hooks.exit(call, ret, thrown, m);
    }
  }

  /** Code inséré dans une méthode {@code void}. */
  public static final class VoidAdvice {
    private VoidAdvice() {}

    @Advice.OnMethodEnter
    static Object enter(
        @Advice.Origin Method m,
        @Advice.AllArguments(readOnly = false, typing = Assigner.Typing.DYNAMIC) Object[] args) {
      Object call = Hooks.enter(m, args);
      Object[] r = Hooks.replaced(call);
      if (r != null) args = r;
      return call;
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class)
    static void exit(
        @Advice.Origin Method m, @Advice.Enter Object call, @Advice.Thrown Throwable thrown) {
      Hooks.exit(call, null, thrown, m);
    }
  }
}
