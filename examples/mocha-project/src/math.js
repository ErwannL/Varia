'use strict'

function helper(a) {
  return a * 2
}

// Appel direct à helper dans le même fichier, sans passer par exports (J0-17 : non observé).
function sumLocal(a, b) {
  return helper(a) + b
}

module.exports = { helper, sumLocal }
