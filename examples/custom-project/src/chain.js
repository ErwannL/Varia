'use strict'

const text = require('./text')

// Appel transitif via l'export d'un autre module (J0-16 : depth 0 puis 1).
async function outer(x) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return text.inner(x)
}

module.exports = { outer }
