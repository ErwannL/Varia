package com.example;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NotifyTest {
  @Test
  void schedulesWelcome() throws InterruptedException {
    Map<String, Object> user = new HashMap<>();
    user.put("email", "ADA@EXAMPLE.ORG");
    assertTrue(Notify.scheduleWelcome(user));
    Notify.drain();
  }
}
