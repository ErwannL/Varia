// Extension fautive : chaque extension viole le contrat d'une façon précise (sélectionnée par l'id).
// `Reflect.get(Math, 'random')` : appel de Math.random au moment de l'appel (lint : accès direct interdit).
let compteur = 0
let appels = 0
const strategy = (id, generate, supports = () => true) => ({ id, supports, generate })
export default {
  apiVersion: 1,
  name: 'fautif',
  strategies: [
    strategy('leve', () => {
      throw new Error('panne de stratégie')
    }),
    strategy('non-deterministe', () => [{ value: compteur++ }]),
    // Lève au SECOND appel de Varia (le premier appel réussit) : compté sur la première entrée.
    strategy('leve-second', (input) => {
      if (input.pathStr === 'arg0' && appels++ > 0) throw new Error('panne au second appel')
      return []
    }),
    strategy('hasard', () => [{ value: Reflect.get(Math, 'random')() }]),
    strategy('hasard-rattrape', () => {
      try {
        Reflect.get(Math, 'random')()
      } catch {
        // rattrapé : Varia le voit quand même
      }
      return [{ value: 1 }]
    }),
    strategy('forme-objet', () => ({ pas: 'un tableau' })),
    strategy('forme-fonction', () => [{ value: () => 1 }]),
    strategy('forme-date', () => [{ value: new Date(0) }]),
    strategy('nan', () => [{ value: Number.NaN }]),
    strategy('op-inconnue', () => [{ op: 'swap', value: 1 }]),
    strategy('sans-valeur', () => [{ op: 'set' }]),
    strategy('element-nul', () => [null]),
    strategy('trop-long', (input, ctx) => [{ value: 'x'.repeat(ctx.limits.stringLength + 1) }]),
    strategy('trop-de-valeurs', () => Array.from({ length: 101 }, (_, i) => ({ value: i }))),
    strategy('trop-profond', (input, ctx) => {
      let v = 1
      for (let d = 0; d <= ctx.limits.objectDepth; d++) v = { n: v }
      return [{ value: v }]
    }),
    strategy('tableau-long', (input, ctx) => [
      { value: new Array(ctx.limits.arrayLength + 1).fill(0) },
    ]),
    strategy(
      'supports-texte',
      () => [],
      () => 'oui',
    ),
    strategy('boucle', () => {
      for (;;) {
        // boucle synchrone infinie : seul l'arrêt du thread l'interrompt
      }
    }),
    { id: 'sans-generate', supports: () => true },
  ],
  formatDetectors: [
    { id: 'detecteur-objet', detect: () => true, invalidValues: () => 'pas un tableau' },
    { id: 'detecteur-nombres', detect: () => true, invalidValues: () => [1] },
    { id: 'detecteur-long', detect: () => true, invalidValues: () => ['x'.repeat(100)] },
  ],
  oracleRules: [
    {
      id: 'regle-leve',
      evaluate: () => {
        throw new Error('panne de règle')
      },
    },
    { id: 'regle-forme', evaluate: () => ({ status: 'INFRA_ERROR', reason: 'X' }) },
    { id: 'regle-raison', evaluate: () => ({ status: 'HANDLED', reason: 'minuscule' }) },
    { id: 'regle-scalaire', evaluate: () => 'HANDLED' },
  ],
  reporters: [
    { id: 'rendu-nombre', extension: 'txt', render: () => 42 },
    {
      id: 'rendu-leve',
      extension: 'txt',
      render: () => {
        throw new TypeError('panne de rendu')
      },
    },
  ],
}
