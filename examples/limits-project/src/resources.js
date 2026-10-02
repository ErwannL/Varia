'use strict'

const fs = require('fs')

// Accumule des blocs jusqu'à en avoir `count` : termine pour un entier >= 0 ; pour NaN, un décimal,
// un négatif, null ou un objet, la boucle ne s'arrête jamais et épuise la mémoire (A-03).
function grow(count) {
  const blocks = []
  while (blocks.length !== count) blocks.push(new Array(100000).fill(blocks.length))
  return blocks.length
}

// Écrit `lines` lignes de 1 Mo sur la sortie standard, de façon SYNCHRONE (rien ne s'accumule en
// mémoire ; un tube plein est réessayé) : une valeur mutée élevée dépasse la limite de sortie (A-03).
function shout(lines) {
  const line = Buffer.from('x'.repeat(1024 * 1024) + '\n')
  for (let i = 0; i < lines; i++) {
    let offset = 0
    while (offset < line.length) {
      try {
        offset += fs.writeSync(1, line, offset)
      } catch (e) {
        if (e.code !== 'EAGAIN') throw e
      }
    }
  }
  return lines
}

// Travail proportionnel au nombre d'éléments (1 ms chacun) : un tableau muté en grand (stratégie
// `size`) rend l'appel beaucoup plus lent que la baseline sans dépasser le timeout (SLOW, A-10).
function tally(items) {
  let total = 0
  for (const item of items) {
    const until = Date.now() + 1
    while (Date.now() < until) total += 0
    total += typeof item === 'number' ? item : 0
  }
  return total
}

module.exports = { grow, shout, tally }
