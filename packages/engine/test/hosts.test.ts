import { describe, expect, it } from 'vitest'
import { hostHeaderAllowed, isLoopbackHost, parseAllowedHosts, VariaError } from '../src/index.js'

describe('isLoopbackHost', () => {
  it('boucle locale (toutes casses, IPv6 avec ou sans crochets) ; le reste est distant', () => {
    for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]'])
      expect(isLoopbackHost(h)).toBe(true)
    for (const h of ['0.0.0.0', '::', '192.168.1.5', 'varia.test', '127.0.0.1.evil'])
      expect(isLoopbackHost(h)).toBe(false)
  })
})

describe('parseAllowedHosts', () => {
  it('absent ou vide ⇒ aucune entrée', () => {
    expect(parseAllowedHosts(undefined)).toEqual([])
    expect(parseAllowedHosts('')).toEqual([])
    expect(parseAllowedHosts(' , ,')).toEqual([])
  })
  it('noms et ports, casse ramenée en minuscules, espaces ignorés', () => {
    expect(parseAllowedHosts(' Localhost:4322 , varia.test,[::1]:9 ,a-b.c')).toEqual([
      { name: 'localhost', port: 4322 },
      { name: 'varia.test', port: null },
      { name: '[::1]', port: 9 },
      { name: 'a-b.c', port: null },
    ])
  })
  it('entrée invalide ⇒ erreur de configuration (jamais ignorée), avec l’entrée fautive', () => {
    for (const bad of [
      'bad host',
      ':80',
      'host:abc',
      'host:0',
      'host:70000',
      '-x',
      'a/b',
      'a:1:2',
    ]) {
      let error: unknown
      try {
        parseAllowedHosts(`ok.test,${bad}`)
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(VariaError)
      expect((error as VariaError).kind).toBe('CONFIG_FAILURE')
      expect((error as VariaError).details).toEqual([
        `VARIA_ALLOWED_HOSTS : « ${bad} » n’est pas un hôte (nom ou nom:port)`,
      ])
    }
  })
})

describe('hostHeaderAllowed', () => {
  const allowed = parseAllowedHosts('varia.test,proxy.test:7777')
  it('boucle locale : le port lié est exigé, pas un autre ni aucun', () => {
    expect(hostHeaderAllowed('localhost', '4321', 4321, [])).toBe(true)
    expect(hostHeaderAllowed('LocalHost', '4321', 4321, [])).toBe(true)
    expect(hostHeaderAllowed('[::1]', '4321', 4321, [])).toBe(true)
    expect(hostHeaderAllowed('localhost', '4322', 4321, [])).toBe(false)
    expect(hostHeaderAllowed('localhost', undefined, 4321, [])).toBe(false)
  })
  it('sans port lié (serveur qui n’écoute pas) : seul le nom compte', () => {
    expect(hostHeaderAllowed('localhost', undefined, null, [])).toBe(true)
    expect(hostHeaderAllowed('evil.test', '80', null, [])).toBe(false)
    expect(hostHeaderAllowed('varia.test', undefined, null, allowed)).toBe(true)
  })
  it('entrée sans port : le port lié ; entrée avec port : ce port (conteneur à port publié)', () => {
    expect(hostHeaderAllowed('varia.test', '4321', 4321, allowed)).toBe(true)
    expect(hostHeaderAllowed('varia.test', '7777', 4321, allowed)).toBe(false)
    expect(hostHeaderAllowed('proxy.test', '7777', 4321, allowed)).toBe(true)
    expect(hostHeaderAllowed('proxy.test', '4321', 4321, allowed)).toBe(false)
    expect(hostHeaderAllowed('PROXY.test', '7777', 4321, allowed)).toBe(true)
  })
  it('un hôte absent de la liste reste refusé, même sur le bon port', () => {
    expect(hostHeaderAllowed('attacker.test', '4321', 4321, allowed)).toBe(false)
    expect(hostHeaderAllowed('varia.test.evil', '4321', 4321, allowed)).toBe(false)
  })
})
