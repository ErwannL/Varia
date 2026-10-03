const assert = require('node:assert')
const { createUser, fetchUser } = require('../src/users')

describe('createUser', () => {
  it('crée un utilisateur valide', () => {
    const user = createUser({ name: 'Erwann', age: 25, password: 'hunter2-secret' })
    assert.strictEqual(user.name, 'Erwann')
    assert.strictEqual(user.age, 25)
    assert.ok(!('password' in user))
  })

  it('crée trois utilisateurs', () => {
    const a = createUser({ name: 'Ada', age: 36, password: 'pw-ada-secret' })
    const b = createUser({ name: 'Grace', age: 45, password: 'pw-grace-secret' })
    const c = createUser({ name: 'Linus', age: 21, password: 'pw-linus-secret' })
    assert.deepStrictEqual([a.name, b.name, c.name], ['Ada', 'Grace', 'Linus'])
  })

  // Test paramétré (équivalent de test.each) : un test Mocha par ligne.
  for (const [name, age] of [
    ['Alice', 30],
    ['Bob', 40],
    ['Chloé', 50],
  ]) {
    it(`accepte ${name} (${age} ans)`, () => {
      assert.strictEqual(createUser({ name, age, password: 'pw-each-secret' }).name, name)
    })
  }
})

describe('fetchUser', () => {
  it('résout un identifiant valide', async () => {
    assert.deepStrictEqual(await fetchUser(7), { id: 7, name: 'user-7' })
  })
})
