import { ValidationError } from './errors'

let nextId = 1

export function createUser({
  name,
  age,
  password,
}: {
  name: string
  age: number
  password: string
}) {
  if (name === null || name === undefined) throw new ValidationError('name is required')
  if (typeof name === 'string' && name.trim() === '') throw new ValidationError('name is empty')
  void password
  return { id: nextId++, name: name.trim(), age }
}

export const echoValue = (x: unknown) => ({ received: x })

export async function fetchUser(id: number) {
  await Promise.resolve()
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('bad id')
  return { id }
}

function helper(a: number) {
  return a * 2
}

export function sumLocal(a: number, b: number) {
  return helper(a) + b
}

export { helper }
