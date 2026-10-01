const { Counter } = require('../src/legacy')

test('constructeur ES5', () => {
  const c = new Counter(1)
  expect(c).toBeInstanceOf(Counter)
  expect(c.inc()).toBe(2)
})
