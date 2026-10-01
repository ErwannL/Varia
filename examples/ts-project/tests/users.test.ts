import { createUser, echoValue, fetchUser } from '../src/users'

test('crée un utilisateur valide', () => {
  expect(createUser({ name: 'Erwann', age: 25, password: 'ts-secret' }).name).toBe('Erwann')
})

test('echo', () => {
  expect(echoValue('hello')).toEqual({ received: 'hello' })
})

test('fetchUser', async () => {
  await expect(fetchUser(3)).resolves.toEqual({ id: 3, name: 'user-3' })
})
