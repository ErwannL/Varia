import { describe, expect, test } from 'vitest'
import { createUser, echoValue, fetchUser, sumLocal } from '../src/users'

describe('createUser', () => {
  test('crée un utilisateur valide', () => {
    expect(createUser({ name: 'Erwann', age: 25, password: 'vitest-secret' }).name).toBe('Erwann')
  })
  test.each([['Alice'], ['Bob']])('accepte %s', (name) => {
    expect(createUser({ name, age: 1, password: 'p-secret' }).name).toBe(name)
  })
})

test('echo', () => {
  expect(echoValue('hello')).toEqual({ received: 'hello' })
})

test('fetchUser', async () => {
  await expect(fetchUser(3)).resolves.toEqual({ id: 3 })
})

test('sumLocal', () => {
  expect(sumLocal(2, 3)).toBe(7)
})
