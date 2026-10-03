package com.orqea.varia.probe;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/**
 * Sonde Java (norme 1.2) : aucune politique ; elle observe, applique au plus UNE mutation, écrit des
 * JSONL vidés ligne à ligne. Défensive : une erreur de son propre code est signalée {@code
 * PROBE_ERROR} et la cible est appelée avec ses arguments d'origine.
 */
public final class Probe {
  static final int PROTOCOL_VERSION = 1;
  static final int PROTOCOL_MINOR = 2;
  static final int MAX_LOGGED_CALLS = 20;
  static final String STDERR_MARKER = "[varia] PROBE_ERROR";

  /** Contexte d'un appel de cible (profondeur suivie par fil d'exécution). */
  public static final class Call {
    final long callId;
    final String callSiteId;
    final int depth;
    final List<Long> chain;
    final List<String> secrets;
    final Serializer.Options opts;
    final long started;
    Object[] replaced;

    Call(long callId, String callSiteId, int depth, List<Long> chain, List<String> secrets,
        Serializer.Options opts, long started) {
      this.callId = callId;
      this.callSiteId = callSiteId;
      this.depth = depth;
      this.chain = chain;
      this.secrets = secrets;
      this.opts = opts;
      this.started = started;
    }
  }

  /** Écriture d'une ligne (remplaçable en test : disque plein, journal inaccessible). */
  interface Sink {
    void write(String line) throws IOException;
  }

  final String mode;
  final String runId;
  final String projectRoot;
  final Serializer.Redaction redaction;
  final Map<?, ?> mutation;
  Sink sink;
  PrintStream stderr = System.err;
  Supplier<String> now = () -> Instant.now().toString();
  private final ThreadLocal<ArrayDeque<Call>> stack = ThreadLocal.withInitial(ArrayDeque::new);
  /** Appel englobant hérité par les fils créés pendant un appel (attribution des exceptions). */
  final InheritableThreadLocal<Call> context = new InheritableThreadLocal<>();
  private String testId;
  private final Map<String, Integer> sequences = new HashMap<>();
  private final Map<String, Integer> nameCounts = new HashMap<>();
  private long callCounter;

  /** Instance active du processus, {@code null} hors d'un run Varia. */
  static volatile Probe current;

  Probe(String mode, String runId, String projectRoot, Serializer.Redaction r, Map<?, ?> mutation, Sink sink) {
    this.mode = mode;
    this.runId = runId;
    this.projectRoot = projectRoot;
    this.redaction = r;
    this.mutation = mutation;
    this.sink = sink;
  }

  static Map<?, ?> readJson(String file) {
    if (file == null) return Map.of();
    try {
      Object v = Json.parse(Files.readString(Path.of(file), StandardCharsets.UTF_8));
      return v instanceof Map ? (Map<?, ?>) v : Map.of();
    } catch (IOException | IllegalArgumentException e) {
      return Map.of();
    }
  }

  /** Sonde depuis l'environnement (norme §2) ; {@code null} hors d'un run Varia. */
  static Probe fromEnv(Map<String, String> env, long pid, Set<String> opaqueTypes) {
    String mode = env.get("VARIA_MODE");
    String runDir = env.get("VARIA_RUN_DIR");
    if (!("observe".equals(mode) || "fuzz".equals(mode)) || runDir == null || runDir.isEmpty())
      return null;
    Map<?, ?> targets = readJson(env.get("VARIA_TARGETS"));
    Map<?, ?> mutation = null;
    if (mode.equals("fuzz")) {
      Object list = readJson(env.get("VARIA_PLAN")).get("mutations");
      String id = env.get("VARIA_MUTATION_ID");
      for (Object m : list instanceof List ? (List<?>) list : List.of())
        if (m instanceof Map && ((Map<?, ?>) m).get("id") != null && ((Map<?, ?>) m).get("id").equals(id))
          mutation = (Map<?, ?>) m;
    }
    Path log = Path.of(runDir, "probe-" + pid + ".jsonl");
    Object root = targets.get("projectRoot");
    return new Probe(
        mode,
        targets.get("runId") == null ? "" : String.valueOf(targets.get("runId")),
        root == null ? System.getProperty("user.dir") : String.valueOf(root),
        new Serializer.Redaction(readJson(env.get("VARIA_REDACT")), opaqueTypes),
        mutation,
        line -> {
          // Ouvert, écrit et fermé à chaque ligne : survit à System.exit et à un arrêt brutal.
          try (FileOutputStream out = new FileOutputStream(log.toFile(), true)) {
            out.write(line.getBytes(StandardCharsets.UTF_8));
          }
        });
  }

  synchronized void emit(String type, Map<String, Object> fields) throws IOException {
    Map<String, Object> msg = new LinkedHashMap<>();
    msg.put("protocolVersion", (long) PROTOCOL_VERSION);
    msg.put("runId", runId);
    msg.put("type", type);
    msg.put("testId", testId);
    msg.put("timestamp", now.get());
    msg.putAll(fields);
    sink.write(Json.stringify(msg) + "\n");
  }

  /** Erreur du code de la sonde : journal, sinon marqueur sur stderr ; ne lève jamais. */
  void probeError(String stage, Throwable e, Map<String, Object> extra) {
    try {
      Map<String, Object> f = new LinkedHashMap<>();
      f.put("reason", stage);
      f.put("error", Errors.serialize(e, List.of()));
      f.putAll(extra);
      emit("PROBE_ERROR", f);
    } catch (IOException | RuntimeException x) {
      stderr.println(STDERR_MARKER + " " + stage);
    }
  }

  static Map<String, Object> fields(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  void hello(long pid) {
    try {
      emit("HELLO", fields("protocolMinor", (long) PROTOCOL_MINOR, "mode", mode, "pid", pid,
          "mutationId", mutation == null ? null : mutation.get("id")));
    } catch (IOException | RuntimeException e) {
      probeError("hello", e, Map.of());
    }
  }

  void discover(String module, List<String> wrapped, List<String> unsupported) {
    try {
      emit("DISCOVER", fields("module", module, "wrapped", new ArrayList<Object>(wrapped),
          "unsupported", new ArrayList<Object>(unsupported)));
    } catch (IOException | RuntimeException e) {
      probeError("wrap", e, fields("module", module));
    }
  }

  // ---------------------------------------------------------------- tests

  static String testIdOf(String file, String name, int rank) {
    return "t_" + Json.sha256(file + "\0" + name + "\0" + rank).substring(0, 16);
  }

  static String callSiteIdOf(String testId, String module, String export, int depth, int sequence) {
    return "c_"
        + Json.sha256(testId + "\0" + module + "\0" + export + "\0" + depth + "\0" + sequence)
            .substring(0, 16);
  }

  synchronized void testStart(String file, String name) {
    String key = file + "\0" + name;
    int rank = nameCounts.getOrDefault(key, 0);
    nameCounts.put(key, rank + 1);
    testId = testIdOf(file, name, rank);
    sequences.clear();
    try {
      emit("TEST_START", fields("file", file, "name", name));
    } catch (IOException | RuntimeException e) {
      probeError("test", e, Map.of());
    }
  }

  synchronized void testEnd() {
    try {
      emit("TEST_END", Map.of());
    } catch (IOException | RuntimeException e) {
      probeError("test", e, Map.of());
    }
    testId = null;
  }

  // ---------------------------------------------------------------- appels

  /** Entrée d'un appel : observation et mutation ; {@code null} si la sonde échoue (appel d'origine). */
  public Call enter(String module, String export, Object[] args, Class<?>[] params) {
    try {
      return prepare(module, export, args, params);
    } catch (IOException | RuntimeException e) {
      probeError("prepare", e, fields("module", module, "export", export));
      return null;
    }
  }

  private synchronized Call prepare(String module, String export, Object[] args, Class<?>[] params)
      throws IOException {
    ArrayDeque<Call> st = stack.get();
    Call parent = st.peek();
    int depth = parent == null ? 0 : parent.depth + 1;
    String seqKey = module + "#" + export + "#" + depth;
    int sequence = sequences.getOrDefault(seqKey, 0);
    sequences.put(seqKey, sequence + 1);
    String callSiteId = testId == null ? null : callSiteIdOf(testId, module, export, depth, sequence);
    long callId = ++callCounter;
    List<String> secrets = new ArrayList<>();
    Serializer.Options opts = redaction.argsOptions(export, secrets);
    List<Object> serialized = Serializer.serializeArgs(args, opts);
    String fp = Serializer.fingerprint(serialized);
    Object[] replaced = null;
    Map<?, ?> m = mutation;
    if (m != null && callSiteId != null && callSiteId.equals(m.get("callSiteId"))) {
      if (!fp.equals(m.get("argsFingerprint"))) {
        emit("MUTATE_CALL", fields("callId", callId, "callSiteId", callSiteId, "mutationId", m.get("id"),
            "applied", false, "reason", "AMBIGUOUS_CALL_SITE",
            "expectedFingerprint", m.get("argsFingerprint"), "argsFingerprint", fp));
      } else {
        try {
          replaced = Values.apply(args, params, (List<?>) m.get("path"), String.valueOf(m.get("op")), m.get("value"));
          emit("MUTATE_CALL", fields("callId", callId, "callSiteId", callSiteId, "mutationId", m.get("id"),
              "applied", true));
        } catch (Values.NotApplicable e) {
          emit("MUTATE_CALL", fields("callId", callId, "callSiteId", callSiteId, "mutationId", m.get("id"),
              "applied", false, "reason", e.reason));
        }
      }
    }
    Map<String, Object> f = fields("callId", callId, "callSiteId", callSiteId, "module", module,
        "export", export, "depth", (long) depth, "sequence", (long) sequence, "argsFingerprint", fp,
        "mutated", replaced != null);
    if (sequence < MAX_LOGGED_CALLS) f.put("args", serialized);
    else f.put("argsOmitted", true);
    emit("OBSERVE_CALL", f);
    List<Long> chain = new ArrayList<>(parent == null ? List.of() : parent.chain);
    chain.add(callId);
    Call call = new Call(callId, callSiteId, depth, chain, secrets, opts, System.nanoTime());
    call.replaced = replaced;
    st.push(call);
    context.set(call);
    return call;
  }

  private void outcome(Call c, String type, Map<String, Object> extra) {
    try {
      Map<String, Object> f = fields("callId", c.callId, "callSiteId", c.callSiteId,
          "durationMs", (System.nanoTime() - c.started) / 1e6);
      f.putAll(extra);
      emit(type, f);
    } catch (IOException | RuntimeException e) {
      probeError("outcome", e, fields("callId", c.callId));
    }
  }

  private Object ser(Call c, Object v) {
    Serializer.Options o = c.opts.copy();
    o.secrets = new ArrayList<>();
    return Serializer.serialize(v, o, "return");
  }

  /**
   * Sortie d'un appel : issue écrite ; une {@link CompletableFuture} est remplacée par une future
   * dérivée (issue asynchrone écrite AVANT que le test ne la voie) quand le type rendu le permet.
   */
  public Object exit(Call c, Object result, Throwable thrown, Class<?> returnType) {
    ArrayDeque<Call> st = stack.get();
    st.remove(c);
    context.set(st.peek());
    if (thrown != null) {
      outcome(c, "TARGET_THROW", fields("error", Errors.serialize(thrown, c.secrets)));
      return result;
    }
    if (result instanceof CompletableFuture && returnType.isAssignableFrom(CompletableFuture.class)) {
      return ((CompletableFuture<?>) result).whenComplete((v, e) -> {
        if (e == null) outcome(c, "TARGET_RETURN", fields("async", true, "value", ser(c, v)));
        else outcome(c, "TARGET_REJECT", fields("error", Errors.serialize(unwrap(e), c.secrets)));
      });
    }
    outcome(c, "TARGET_RETURN", fields("async", false, "value", ser(c, result)));
    return result;
  }

  static Throwable unwrap(Throwable e) {
    return e instanceof java.util.concurrent.CompletionException && e.getCause() != null ? e.getCause() : e;
  }

  /** Exception non attrapée d'un fil (équivalent Java du rejet non géré), attribuée à l'appel créateur. */
  void uncaught(Thread t, Throwable e, Call creator) {
    try {
      Map<String, Object> f = new LinkedHashMap<>();
      if (creator != null) f.put("callId", creator.callId);
      f.put("callSiteId", creator == null ? null : creator.callSiteId);
      f.put("chain", creator == null ? new ArrayList<>() : new ArrayList<Object>(creator.chain));
      f.put("error", Errors.serialize(e, creator == null ? List.of() : creator.secrets));
      emit("UNHANDLED_REJECTION", f);
    } catch (IOException | RuntimeException x) {
      probeError("unhandled-rejection", x, Map.of());
    }
  }
}
