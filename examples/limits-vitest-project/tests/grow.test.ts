import { expect, test } from 'vitest'
import { grow } from '../src/grow'

test('grow', () => {
  expect(grow(2)).toBe(2)
})
