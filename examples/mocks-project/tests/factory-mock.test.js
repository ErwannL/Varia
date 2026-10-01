jest.mock('../src/users', () => ({ greet: jest.fn((n) => 'mocked ' + n) }))
const { welcome } = require('../src/service')

test('welcome avec users mocké par fabrique', () => {
  expect(welcome('e')).toBe('mocked e!')
})
