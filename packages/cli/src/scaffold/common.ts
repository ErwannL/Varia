// Éléments communs aux gabarits de `varia scaffold` (T-02).

/** Nom validé du squelette et ses dérivés. */
export interface Names {
  /** Nom tel que donné (minuscules, chiffres, tirets). */
  name: string
  /** Forme PascalCase (`mon-runner` → `MonRunner`), pour les noms de classes. */
  pascal: string
}

/**
 * Minuscules, chiffres et tirets isolés, commençant par une lettre ; 30 caractères au plus (les
 * lignes générées restent sous 100 colonnes, conformes à Prettier).
 */
export const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const NAME_MAX = 30

export function isValidName(name: string): boolean {
  return name.length <= NAME_MAX && NAME_PATTERN.test(name)
}

export function namesOf(name: string): Names {
  const pascal = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return { name, pascal }
}

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
`

const PRETTIER =
  '{ "printWidth": 100, "singleQuote": true, "semi": false, "trailingComma": "all", "endOfLine": "lf" }\n'

/** Fichiers communs : TypeScript strict, Prettier de Varia, dépendances ignorées par git. */
export function common(): Record<string, string> {
  return {
    '.gitignore': 'node_modules\n',
    '.prettierrc.json': PRETTIER,
    'tsconfig.json': TSCONFIG,
  }
}
