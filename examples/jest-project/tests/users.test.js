const { createUser, fetchUser } = require('../src/users')

describe('createUser', () => {
  test('crée un utilisateur valide', () => {
    const user = createUser({ name: 'Erwann', age: 25, password: 'hunter2-secret' })
    expect(user.name).toBe('Erwann')
    expect(user.age).toBe(25)
    expect(user).not.toHaveProperty('password')
  })

  test('crée trois utilisateurs', () => {
    const a = createUser({ name: 'Ada', age: 36, password: 'pw-ada-secret' })
    const b = createUser({ name: 'Grace', age: 45, password: 'pw-grace-secret' })
    const c = createUser({ name: 'Linus', age: 21, password: 'pw-linus-secret' })
    expect([a.name, b.name, c.name]).toEqual(['Ada', 'Grace', 'Linus'])
  })

  test.each([
    ['Alice', 30],
    ['Bob', 40],
    ['Chloé', 50],
  ])('accepte %s (%i ans)', (name, age) => {
    expect(createUser({ name, age, password: 'pw-each-secret' }).name).toBe(name)
  })
})

describe('fetchUser', () => {
  test('résout un identifiant valide', async () => {
    await expect(fetchUser(7)).resolves.toEqual({ id: 7, name: 'user-7' })
  })
})
