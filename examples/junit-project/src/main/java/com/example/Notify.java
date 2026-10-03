package com.example;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Envoi « plus tard » dans un fil d'exécution que personne n'attend : un email non textuel provoque une
 * exception NON ATTRAPÉE dans ce fil, après un retour normal (équivalent Java du rejet non géré).
 */
public final class Notify {
  private static final List<String> SENT = new ArrayList<>();
  private static final List<Thread> PENDING = new ArrayList<>();

  private Notify() {}

  public static boolean scheduleWelcome(Map<String, Object> user) {
    Object email = user.get("email");
    Thread t = new Thread(() -> send(((String) email).toLowerCase()));
    PENDING.add(t);
    t.start();
    return true;
  }

  private static synchronized void send(String address) {
    SENT.add(address);
  }

  /** Attend les envois en cours (appelé par les tests). */
  static void drain() throws InterruptedException {
    for (Thread t : PENDING) t.join();
    PENDING.clear();
  }
}
