'use strict'

// Constructeur de style ES5 (comme une classe compilée par TypeScript en ES5) : `new` doit
// continuer à fonctionner à travers l'enveloppe de la sonde (régression trouvée sur le projet externe).
function Counter(start) {
  this.n = start
}
Counter.prototype.inc = function inc() {
  this.n += 1
  return this.n
}

module.exports = { Counter }
