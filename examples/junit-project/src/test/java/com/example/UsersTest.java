package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class UsersTest {
  static Map<String, Object> input(String name, int age, String password) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("name", name);
    m.put("age", age);
    m.put("password", password);
    return m;
  }

  @Test
  void createsValidUser() {
    Map<String, Object> user = Users.createUser(input("Erwann", 25, "hunter2-secret"));
    assertEquals("Erwann", user.get("name"));
    assertEquals(25, user.get("age"));
    assertFalse(user.containsKey("password"));
  }

  @Test
  void createsThreeUsers() {
    Map<String, Object> a = Users.createUser(input("Ada", 36, "pw-ada-secret"));
    Map<String, Object> b = Users.createUser(input("Grace", 45, "pw-grace-secret"));
    Map<String, Object> c = Users.createUser(input("Linus", 21, "pw-linus-secret"));
    assertEquals(List.of("Ada", "Grace", "Linus"), List.of(a.get("name"), b.get("name"), c.get("name")));
  }

  @ParameterizedTest
  @CsvSource({"Alice, 30", "Bob, 40", "Chloé, 50"})
  void accepts(String name, int age) {
    assertEquals(name, Users.createUser(input(name, age, "pw-each-secret")).get("name"));
  }

  @Test
  void fetchesValidId() {
    assertEquals(Map.of("id", 7, "name", "user-7"), Users.fetchUser(7).join());
  }
}
