'use strict'

const { ValidationError } = require('./errors')

let nextId = 1

// name null/undefined/vide après trim => ValidationError (J0-3, J0-5 : "" => HANDLED).
// Aucune vérification de type : {} , [] , 123 => TypeError sur name.trim (J0-4).
function createUser({ name, age, password }) {
  if (name === null || name === undefined) throw new ValidationError('name is required')
  if (typeof name === 'string' && name.trim() === '') throw new ValidationError('name is empty')
  const trimmed = name.trim()
  void password
  return { id: nextId++, name: trimmed, age }
}

// Non déclarée `async` pour pouvoir lever synchroniquement (CDC C.0) ; renvoie toujours une promesse sinon.
function fetchUser(id) {
  if (typeof id === 'object' && id !== null) throw new TypeError('id must not be an object')
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.reject(new ValidationError('id must be a positive integer'))
  }
  return Promise.resolve({ id, name: `user-${id}` })
}

module.exports = { createUser, fetchUser }
