const assert = require('node:assert')
const { outer } = require('../src/chain')

it('outer en parallèle', async () => {
  const [a, b] = await Promise.all([outer('ab'), outer('abcd')])
  assert.deepStrictEqual([a, b], [2, 4])
})
