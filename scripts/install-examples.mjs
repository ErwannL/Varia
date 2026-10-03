// Installe les dépendances (lockfile, `npm ci`) des projets d'exemple utilisés par les tests.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

for (const dir of readdirSync('examples', { withFileTypes: true })) {
  const root = join('examples', dir.name)
  if (!dir.isDirectory() || dir.name === 'external' || !existsSync(join(root, 'package-lock.json')))
    continue
  console.log(`npm ci dans ${root}`)
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

// Projets d'exemple Python (R-02) : environnement virtuel local `.venv` (ignoré par git), dépendances
// épinglées de `requirements.txt`. Python absent : le dire, sans faire échouer les autres exemples.
for (const dir of readdirSync('examples', { withFileTypes: true })) {
  const root = join('examples', dir.name)
  if (!dir.isDirectory() || !existsSync(join(root, 'requirements.txt'))) continue
  const win = process.platform === 'win32'
  const python = process.env['VARIA_PYTHON'] ?? (win ? 'python' : 'python3')
  try {
    console.log(`${python} -m venv .venv && pip install -r requirements.txt dans ${root}`)
    execFileSync(python, ['-m', 'venv', '.venv'], { cwd: root, stdio: 'inherit' })
    const venvPython = win ? join('.venv', 'Scripts', 'python.exe') : join('.venv', 'bin', 'python')
    execFileSync(venvPython, ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'], {
      cwd: root,
      stdio: 'inherit',
    })
  } catch (e) {
    console.error(`Python indisponible pour ${root} : ${String(e)}`)
  }
}

// Sonde Java et exemples Maven (R-04) : dépendances résolues EN LIGNE ici (jamais pendant un run
// Varia, qui appelle Maven hors ligne `-o`), jar de l'agent construit dans
// packages/adapters/junit/agent/target (ignoré par git) — tests de la sonde et porte JaCoCo comprises.
try {
  const agentPom = join('packages', 'adapters', 'junit', 'agent', 'pom.xml')
  console.log(`mvn verify (sonde Java) : ${agentPom}`)
  execFileSync('mvn', ['-q', '-B', '-f', agentPom, 'verify'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  for (const dir of readdirSync('examples', { withFileTypes: true })) {
    const root = join('examples', dir.name)
    if (!dir.isDirectory() || !existsSync(join(root, 'pom.xml'))) continue
    console.log(`mvn dependency:resolve dans ${root}`)
    execFileSync(
      'mvn',
      [
        '-q',
        '-B',
        'dependency:resolve',
        'dependency:build-classpath',
        `-Dmdep.outputFile=${join('target', 'classpath.txt')}`,
      ],
      { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
    )
  }
} catch (e) {
  console.error(`Java/Maven indisponibles (sonde JUnit) : ${String(e)}`)
}

// Projets d'exemple PHP (R-03) : `composer install` d'après `composer.lock` (vendor/ ignoré par git).
// PHP ou Composer absents : le dire, sans faire échouer les autres exemples.
for (const dir of readdirSync('examples', { withFileTypes: true })) {
  const root = join('examples', dir.name)
  if (!dir.isDirectory() || !existsSync(join(root, 'composer.lock'))) continue
  try {
    console.log(`composer install dans ${root}`)
    execFileSync('composer', ['install', '--no-interaction', '--no-progress', '--no-plugins'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
  } catch (e) {
    console.error(`PHP/Composer indisponibles pour ${root} : ${String(e)}`)
  }
}
