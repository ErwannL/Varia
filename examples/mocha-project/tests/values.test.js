const assert = require('node:assert')
const { echoValue, repeat, exitOn, stamp } = require('../src/values')
const { sumLocal } = require('../src/math')

it('echoValue renvoie un horodatage', () => {
  assert.match(echoValue(stamp('t')).received, /^t:\d+$/)
})

it('echoValue renvoie sa valeur', () => {
  assert.deepStrictEqual(echoValue('hello'), { received: 'hello' })
})

it('repeat termine', () => {
  assert.strictEqual(repeat('a', 3), 'a')
})

it('exitOn ok', () => {
  assert.strictEqual(exitOn('ok'), 'ok')
})

it('sumLocal', () => {
  assert.strictEqual(sumLocal(2, 3), 7)
})
