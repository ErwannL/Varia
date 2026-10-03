const assert = require('node:assert')
const { scheduleWelcome } = require('../src/notify')

it('scheduleWelcome planifie un envoi', async () => {
  assert.strictEqual(scheduleWelcome({ email: 'Ada@Example.com' }), true)
  await new Promise((resolve) => setTimeout(resolve, 10))
})
