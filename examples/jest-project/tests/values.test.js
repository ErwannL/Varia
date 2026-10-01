const { echoValue, repeat, exitOn, stamp } = require('../src/values')
const { sumLocal } = require('../src/math')

test('echoValue renvoie un horodatage', () => {
  expect(echoValue(stamp('t')).received).toMatch(/^t:\d+$/)
})

test('echoValue renvoie sa valeur', () => {
  expect(echoValue('hello')).toEqual({ received: 'hello' })
})

test('repeat termine', () => {
  expect(repeat('a', 3)).toBe('a')
})

test('exitOn ok', () => {
  expect(exitOn('ok')).toBe('ok')
})

test('sumLocal', () => {
  expect(sumLocal(2, 3)).toBe(7)
})
