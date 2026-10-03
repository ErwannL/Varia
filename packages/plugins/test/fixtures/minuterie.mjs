// Erreur non rattrapée dans le thread, après le chargement : le thread meurt.
setTimeout(() => {
  throw new Error('minuterie')
}, 0)
export default {
  apiVersion: 1,
  name: 'minuterie',
  strategies: [{ id: 's', supports: () => true, generate: () => [] }],
}
