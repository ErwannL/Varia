package com.example;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Création et lecture d'utilisateurs (comportements de référence §5). */
public final class Users {
  private static int nextId = 1;

  private Users() {}

  /**
   * name absent/null/vide (après trim) ⇒ ValidationException ; d'un autre type (Map, List, nombre) ⇒
   * ClassCastException (aucune vérification de type). Ne renvoie jamais le mot de passe.
   */
  public static Map<String, Object> createUser(Map<String, Object> input) {
    Object name = input.get("name");
    if (name == null) throw new ValidationException("name is required");
    String text = (String) name;
    if (text.trim().isEmpty()) throw new ValidationException("name is empty");
    Map<String, Object> user = new LinkedHashMap<>();
    user.put("id", nextId++);
    user.put("name", text.trim());
    user.put("age", input.get("age"));
    return user;
  }

  /**
   * Objet (Map, List) ⇒ ClassCastException SYNCHRONE ; pas un entier positif ⇒ future en échec
   * (ValidationException) ; sinon future réussie.
   */
  public static CompletableFuture<Map<String, Object>> fetchUser(Object id) {
    if (id instanceof Map || id instanceof List) {
      throw new ClassCastException("id must not be an object");
    }
    if (!(id instanceof Integer) || (Integer) id <= 0) {
      return CompletableFuture.failedFuture(new ValidationException("id must be a positive integer"));
    }
    Map<String, Object> user = new LinkedHashMap<>();
    user.put("id", id);
    user.put("name", "user-" + id);
    return CompletableFuture.completedFuture(user);
  }
}
