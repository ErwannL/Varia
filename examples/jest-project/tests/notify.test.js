const { scheduleWelcome } = require('../src/notify')

test('scheduleWelcome planifie un envoi', async () => {
  expect(scheduleWelcome({ email: 'Ada@Example.com' })).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 10))
})
