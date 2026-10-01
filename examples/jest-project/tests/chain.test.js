const { outer } = require('../src/chain')

test('outer en parallèle', async () => {
  const [a, b] = await Promise.all([outer('ab'), outer('abcd')])
  expect([a, b]).toEqual([2, 4])
})
