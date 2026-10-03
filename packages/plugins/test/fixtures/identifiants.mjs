// Identifiants invalides ou en double, rapporteur sans extension de fichier valide, liste non tableau.
export default {
  apiVersion: 1,
  name: 'identifiants',
  strategies: [
    { id: 'Majuscule', supports: () => false, generate: () => [] },
    { id: 'double', supports: () => false, generate: () => [] },
    { id: 'double', supports: () => false, generate: () => [] },
    7,
  ],
  oracleRules: 'pas une liste',
  reporters: [{ id: 'sans-ext', extension: 'T X T', render: () => '' }],
}
