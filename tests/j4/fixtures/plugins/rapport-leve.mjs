export default {
  apiVersion: 1,
  name: 'rapport',
  reporters: [
    {
      id: 'r',
      extension: 'txt',
      render: () => {
        throw new Error('panne de rendu')
      },
    },
  ],
}
