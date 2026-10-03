package com.example;

/** Erreur de validation (gérée) : classée HANDLED par l'oracle (`*ValidationException`). */
public class ValidationException extends RuntimeException {
  public ValidationException(String message) {
    super(message);
  }
}
