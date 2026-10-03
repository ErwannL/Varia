package com.orqea.varia.probe;

import java.nio.file.Path;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;

/** Écouteur JUnit Platform (chargé par ServiceLoader depuis le jar de l'agent) : début et fin des tests. */
public final class Listener implements TestExecutionListener {
  @Override
  public void executionStarted(TestIdentifier id) {
    Probe p = Probe.current;
    if (p == null || !id.isTest()) return;
    String uid = id.getUniqueId();
    p.testStart(Targets.testFile(uid, Path.of(p.projectRoot)), Targets.testName(uid));
  }

  @Override
  public void executionFinished(TestIdentifier id, TestExecutionResult result) {
    Probe p = Probe.current;
    if (p != null && id.isTest()) p.testEnd();
  }
}
