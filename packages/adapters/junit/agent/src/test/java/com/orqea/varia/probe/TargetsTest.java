package com.orqea.varia.probe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TargetsTest {
  @TempDir Path tmp;

  @Test
  void nomsDesTests() {
    String base = "[engine:junit-jupiter]/[class:a.B]";
    assertEquals("a.B#m()", Targets.testName(base + "/[method:m()]"));
    assertEquals("a.B$C#m(java.lang.String, int)", Targets.testName(base + "/[nested-class:C]/[method:m(java.lang.String, int)]"));
    assertEquals("a.B#p(int) [2]", Targets.testName(base + "/[test-template:p(int)]/[test-template-invocation:#2]"));
    assertEquals("a.B#f() [1] [3]", Targets.testName(base + "/[test-factory:f()]/[dynamic-container:#1]/[dynamic-test:#3]"));
    assertEquals("a.B#m(int[])", Targets.testName(base + "/[method:m(int%5B%5D)]"));
    assertEquals("[engine:x]/[suite:s]", Targets.testName("[engine:x]/[suite:s]"));
    assertEquals(base, Targets.testName(base));
    assertEquals("pas-un-id", Targets.testName("pas-un-id"));
    assertEquals("[engine:x]/y]", Targets.testName("[engine:x]/y]"));
    assertEquals("[engine:x]/[y]", Targets.testName("[engine:x]/[y]"));
    assertEquals("[engine:x]/[y:z", Targets.testName("[engine:x]/[y:z"));
    assertEquals("é%zz%4", Targets.decode("%C3%A9%zz%4"));
  }

  @Test
  void fichiersDesTests() throws Exception {
    Targets.TEST_ROOTS.clear();
    String uid = "[engine:junit-jupiter]/[class:a.B$C]/[method:m()]";
    assertEquals("src/test/java/a/B.java", Targets.testFile(uid, tmp));
    assertEquals("", Targets.testFile("[engine:x]", tmp));
    Targets.TEST_ROOTS.add("t1");
    Targets.TEST_ROOTS.add("t2");
    Files.createDirectories(tmp.resolve("t2/a"));
    Files.writeString(tmp.resolve("t2/a/B.java"), "");
    assertEquals("t2/a/B.java", Targets.testFile(uid, tmp));
    assertEquals("t1/a/X.java", Targets.testFile("[engine:junit-jupiter]/[class:a.X]/[method:m()]", tmp));
    Targets.TEST_ROOTS.clear();
    assertNull(Targets.moduleOf("pas.Cible"));
  }
}
