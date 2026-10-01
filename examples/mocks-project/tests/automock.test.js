jest.mock('../src/users')
const users = require('../src/users')
const { welcome } = require('../src/service')

test('welcome avec users automocké', () => {
  users.greet.mockReturnValue('auto')
  expect(welcome('f')).toBe('auto!')
})
