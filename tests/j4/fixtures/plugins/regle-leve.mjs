export default {
  apiVersion: 1,
  name: 'regle',
  oracleRules: [
    {
      id: 'r',
      evaluate: () => {
        throw new Error('panne de règle')
      },
    },
  ],
}
