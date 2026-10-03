// `process.exit` appelé par une extension : dans un thread, seul le thread s'arrête.
export default {
  apiVersion: 1,
  name: 'sortie',
  strategies: [{ id: 's', supports: () => true, generate: () => process.exit(0) }],
}
