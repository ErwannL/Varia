import { ValidationError } from './errors'

let nextId = 1

export interface UserInput {
  name: string
  age: number
  password: string
}

export function createUser({ name, age, password }: UserInput) {
  if (name === null || name === undefined) throw new ValidationError('name is required')
  if (typeof name === 'string' && name.trim() === '') throw new ValidationError('name is empty')
  const trimmed = name.trim()
  void password
  return { id: nextId++, name: trimmed, age }
}

export function fetchUser(id: number): Promise<{ id: number; name: string }> {
  if (typeof id === 'object' && id !== null) throw new TypeError('id must not be an object')
  if (!Number.isInteger(id) || id <= 0) return Promise.reject(new ValidationError('bad id'))
  return Promise.resolve({ id, name: `user-${id}` })
}

export const echoValue = (x: unknown) => ({ received: x })
