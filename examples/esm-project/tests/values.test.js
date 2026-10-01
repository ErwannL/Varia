import { echoValue } from '../src/values.js'

test('echo', () => {
  expect(echoValue('hello')).toEqual({ received: 'hello' })
})
