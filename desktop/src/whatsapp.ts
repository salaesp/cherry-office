// Lo que la carcasa le da al módulo de WhatsApp del backend (backend/src/whatsapp.ts):
// - la ruta de la captura empaquetada (dist/whatsapp-captura.mjs, fuera del asar para poder lanzarla como proceso);
// - una clave para cifrar la sesión en disco, guardada con el llavero del sistema (safeStorage: Llavero en Mac, DPAPI en
//   Windows). Si el sistema no ofrece cifrado, no hay clave y la sesión queda en claro (Ajustes lo avisa).
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { HostWhatsApp } from '../../backend/src/whatsapp.js'

export function hostWhatsApp(datosDir: string, dist: string): HostWhatsApp {
  // electron-builder desempaca la captura (asarUnpack): se lanza desde app.asar.unpacked
  const captura = path.join(dist, 'whatsapp-captura.mjs').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  let clave: string | undefined
  return {
    captura,
    clave: () => {
      if (clave) return clave
      try {
        if (!safeStorage.isEncryptionAvailable()) return undefined
        const f = path.join(datosDir, 'whatsapp-clave.bin')
        if (fs.existsSync(f)) {
          clave = safeStorage.decryptString(fs.readFileSync(f))
        } else {
          clave = randomBytes(32).toString('hex')
          fs.mkdirSync(datosDir, { recursive: true })
          fs.writeFileSync(f, safeStorage.encryptString(clave), { mode: 0o600 })
        }
        return /^[0-9a-f]{64}$/.test(clave) ? clave : (clave = undefined)
      } catch {
        return undefined
      }
    },
  }
}
