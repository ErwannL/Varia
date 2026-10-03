// Extension conforme : une stratégie (aléa à graine), un détecteur, une règle, un rapporteur.
export default {
  apiVersion: 1,
  name: 'complet',
  strategies: [
    {
      id: 'tirage',
      supports: (input) => input.type === 'number',
      generate: (input, ctx) => [
        { value: Math.floor(ctx.random() * 1000) },
        { op: 'delete' },
        { op: 'set', value: ctx.limits.stringLength },
      ],
    },
  ],
  formatDetectors: [
    {
      id: 'code-postal',
      detect: (v) => /^\d{5}$/.test(v),
      invalidValues: (v) => [v.slice(1), `${v}0`],
    },
  ],
  oracleRules: [
    {
      id: 'code-validation',
      evaluate: (i) =>
        i.outcome.error?.code === 'E_VALIDATION'
          ? { status: 'HANDLED', reason: 'CODE_E_VALIDATION' }
          : null,
    },
  ],
  reporters: [
    {
      id: 'compte',
      extension: 'txt',
      render: (report) => `mutations=${String(report.mutations.length)}\n`,
    },
  ],
}
