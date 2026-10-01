// Projets externes de test (CDC A.7, acceptation J1-3 et J2), à commit ÉPINGLÉ (hash complet).
export const EXTERNAL_PROJECTS = [
  {
    name: 'immutability-helper',
    repo: 'https://github.com/kolodny/immutability-helper',
    commit: '3dc903960b8411da84704052d511c20648c45ead',
    license: 'MIT',
    runner: 'jest',
    // package-lock.json présent : installation reproductible.
    install: ['ci', '--no-audit', '--no-fund', '--ignore-scripts'],
  },
  {
    name: 'destr',
    repo: 'https://github.com/unjs/destr',
    commit: '541b6f9aeada9fc30de9c5a7e086dbfc1c6fcdc7',
    license: 'MIT',
    runner: 'vitest',
    // Le projet utilise pnpm (pas de package-lock.json) : `npm install` résout des versions compatibles,
    // l'installation n'est donc pas strictement reproductible (consigné dans DECISIONS D-021).
    install: ['install', '--no-audit', '--no-fund', '--ignore-scripts'],
  },
]
