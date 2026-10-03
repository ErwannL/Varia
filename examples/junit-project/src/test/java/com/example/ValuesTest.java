package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ValuesTest {
  @Test
  void echoesValue() {
    assertEquals("x", Values.echoValue("x").get("received"));
  }

  @Test
  void echoesTimestamp() {
    assertTrue(Values.echoValue(Values.stamp("t")).get("received").toString().startsWith("t:"));
  }

  @Test
  void repeatsLabel() {
    assertEquals("x", Values.repeat("x", 3));
  }

  @Test
  void exitsOnlyOnBoom() {
    assertEquals("ok", Values.exitOn("ok"));
  }
}
