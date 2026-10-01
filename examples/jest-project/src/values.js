'use strict'

// Renvoie l'argument tel quel, sans validation (J0-18 : ECHO).
function echoValue(x) {
  return { received: x }
}

// Termine pour un entier >= 0 ; boucle indéfiniment pour NaN, décimal, négatif, null, undefined, {} (J0-8).
function repeat(label, count) {
  let n = count
  while (n !== 0) {
    n--
  }
  return label
}

function exitOn(flag) {
  if (flag === 'boom') process.exit(1)
  return flag
}

// Non déterministe (J0-13).
function stamp(label) {
  return label + ':' + Date.now()
}

module.exports = { echoValue, repeat, exitOn, stamp }
