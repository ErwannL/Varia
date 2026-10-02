const { grow, shout, tally } = require('../src/resources')

test('grow', () => {
  expect(grow(2)).toBe(2)
})

test('shout', () => {
  expect(shout(0)).toBe(0)
})

test('tally', () => {
  expect(tally([1, 2, 3])).toBe(6)
})
