// Rapporteur d'exemple (J4 X-02) : CSV des mutations, calculé depuis le rapport JSON (déjà masqué).
/** @typedef {import('@varia/plugins').VariaPlugin} VariaPlugin */

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const COLUMNS = ['id', 'target', 'path', 'strategy', 'status', 'reason', 'value']

/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  version: '1.0.0',
  name: 'csv',
  reporters: [
    {
      id: 'mutations',
      extension: 'csv',
      render: (report) =>
        [
          COLUMNS.join(','),
          ...report.mutations.map((m) =>
            COLUMNS.map((k) => cell(k === 'value' ? JSON.stringify(m.value) : m[k])).join(','),
          ),
        ].join('\n') + '\n',
    },
  ],
}
