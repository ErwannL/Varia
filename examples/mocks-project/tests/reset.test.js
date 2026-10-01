test('avant resetModules', () => {
  const { greet } = require('../src/users')
  expect(greet('a')).toBe('hello a')
})

test('après resetModules', () => {
  jest.resetModules()
  const { greet } = require('../src/users')
  expect(greet('b')).toBe('hello b')
  jest.resetModules()
  const again = require('../src/users')
  expect(again.greet('c')).toBe('hello c')
})

test('isolateModules', () => {
  jest.isolateModules(() => {
    const { greet } = require('../src/users')
    expect(greet('d')).toBe('hello d')
  })
})
