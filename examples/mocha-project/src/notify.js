'use strict'

const sent = []

function sendWelcome(address) {
  sent.push(address)
}

// Envoi « plus tard », sans attendre (A-02) : personne n'attend la promesse. Une adresse qui n'est pas
// une chaîne provoque un rejet NON GÉRÉ (TypeError sur toLowerCase), après le retour normal.
function scheduleWelcome(user) {
  Promise.resolve().then(() => sendWelcome(user.email.toLowerCase()))
  return true
}

module.exports = { scheduleWelcome }
