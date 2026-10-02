// Zéro IA dans Varia (règle J4-6) : aucune dépendance, clé, appel réseau ni modèle lié à une IA ou à un
// LLM — dans les paquets, les sondes en d'autres langages, les exemples et les scripts. Varia est fait
// de scripts et de règles déterministes. La documentation (.md) n'est pas analysée.
import { existsSync, readFileSync } from 'node:fs'
import { trackedFiles } from './lib-files.mjs'

const SELF = 'scripts/check-no-ai.mjs'

/** Paquets npm interdits (nom exact ou portée). */
const NPM = [
  /^openai$/,
  /^@anthropic-ai\//,
  /^anthropic$/,
  /^langchain$/,
  /^@langchain\//,
  /^llamaindex$/,
  /^cohere-ai$/,
  /^@google\/(?:generative-ai|genai)$/,
  /^ollama$/,
  /^@huggingface\//,
  /^@xenova\/transformers$/,
  /^replicate$/,
  /^tiktoken$/,
  /^gpt-3-encoder$/,
  /^@mistralai\//,
  /^groq-sdk$/,
  /^@ai-sdk\//,
  /^ai$/,
]

/** Modules d'autres langages (Python, PHP, Java) et motifs de code interdits. */
const CODE = [
  /\bapi\.openai\.com\b/,
  /\bapi\.anthropic\.com\b/,
  /\bgenerativelanguage\.googleapis\.com\b/,
  /\bapi\.cohere\.(?:ai|com)\b/,
  /\bapi\.mistral\.ai\b/,
  /\bapi\.groq\.com\b/,
  /\b(?:OPENAI|ANTHROPIC|COHERE|MISTRAL|GROQ|GEMINI|HUGGINGFACE|HF)_API_KEY\b/,
  /\bfrom\s+['"](?:openai|@anthropic-ai\/[\w-]+|langchain|@langchain\/[\w-]+|ollama)['"]/,
  /\brequire\(\s*['"](?:openai|@anthropic-ai\/[\w-]+|langchain|ollama)['"]\s*\)/,
  /^\s*(?:import|from)\s+(?:openai|anthropic|langchain\w*|transformers|llama_cpp|google\.generativeai|ollama)\b/m,
  /\buse\s+OpenAI\\/,
  /\bimport\s+(?:com\.openai|com\.anthropic|dev\.langchain4j)\./,
  // Manifestes PHP (composer.json) et Java (pom.xml, build.gradle).
  /"(?:openai-php|anthropic-ai|theodo-group\/llphant)\/[\w-]*"/,
  /(?:<artifactId>|['"])(?:openai-java|anthropic-java|langchain4j[\w-]*)\b/,
]

const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|php|java|kt|go|rb|sh|ya?ml|toml|cfg|ini|gradle|xml)$/
const offenders = []

for (const file of trackedFiles()) {
  if (file === SELF || !existsSync(file)) continue
  const name = file.split('/').pop() ?? ''
  if (name === 'package.json') {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ])
      for (const dep of Object.keys(pkg[field] ?? {}))
        if (NPM.some((r) => r.test(dep))) offenders.push(`${file}: dépendance ${dep}`)
    continue
  }
  if (name === 'package-lock.json') {
    const lock = JSON.parse(readFileSync(file, 'utf8'))
    for (const key of Object.keys(lock.packages ?? {})) {
      const dep = key.split('node_modules/').pop() ?? ''
      if (dep !== '' && NPM.some((r) => r.test(dep))) offenders.push(`${file}: paquet ${dep}`)
    }
    continue
  }
  if (
    /^(?:requirements[\w.-]*\.txt|composer\.json|pom\.xml|build\.gradle)$/.test(name) ||
    CODE_FILE.test(name)
  ) {
    const text = readFileSync(file, 'utf8')
    for (const r of CODE) if (r.test(text)) offenders.push(`${file}: ${r.source}`)
    if (/^requirements[\w.-]*\.txt$/.test(name))
      for (const line of text.split('\n'))
        if (
          /^\s*(?:openai|anthropic|langchain\S*|transformers|llama[-_]cpp\S*|google-generativeai|ollama)\b/i.test(
            line,
          )
        )
          offenders.push(`${file}: dépendance ${line.trim()}`)
  }
}

if (offenders.length > 0) {
  console.error('IA/LLM interdits dans Varia :\n' + offenders.join('\n'))
  process.exit(1)
}
console.log('check:no-ai OK (aucune dépendance, clé ni appel IA)')
