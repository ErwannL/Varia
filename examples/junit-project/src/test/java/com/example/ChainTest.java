package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ChainTest {
  @Test
  void outerCallsInner() {
    assertEquals(3, Chain.outer("abc"));
    assertEquals(2, Chain.outer("ab"));
  }

  @Test
  void sumsLocally() {
    assertEquals(5, MathOps.sumLocal(1, 3));
  }
}
