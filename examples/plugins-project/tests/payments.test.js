'use strict'

const { transfer } = require('../src/payments')

test('transfer envoie un virement vers un IBAN valide', () => {
  // `token` est un secret : masqué par la sonde, jamais vu par une extension ni stocké.
  const r = transfer({
    iban: 'FR7630006000011234567890189',
    amount: 10,
    token: 'sk_live_TRES_SECRET',
  })
  expect(r.status).toBe('sent')
})
