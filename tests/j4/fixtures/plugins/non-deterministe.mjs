let n = 0
export default {
  apiVersion: 1,
  name: 'nondet',
  strategies: [{ id: 's', supports: () => true, generate: () => [{ value: n++ }] }],
}
