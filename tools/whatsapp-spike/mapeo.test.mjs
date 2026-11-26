import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Elegidos, contenido, jidDeNumero, mapear, metaChat, normalizar, seIgnora } from './mapeo.mjs'

const MAMA = '5491155551234@s.whatsapp.net'
const MAMA_LID = '123456789012345@lid'
const GRUPO = '120363000000000000@g.us'
const elegidos = () => new Elegidos([{ id: '+54 9 11 5555-1234', nombre: 'Mamá', nota: 'turnos médicos' }, { id: GRUPO, nombre: 'Familia' }])

test('número -> JID', () => {
  assert.equal(jidDeNumero('+54 9 11 5555-1234'), MAMA)
  assert.equal(jidDeNumero('123'), undefined)
  assert.equal(normalizar('5491155551234:12@s.whatsapp.net'), MAMA)
})

test('estados, canales y difusión se ignoran', () => {
  for (const j of ['status@broadcast', '1234@broadcast', '1203@newsletter', 'raro', undefined]) assert.ok(seIgnora(j), String(j))
  for (const j of [MAMA, MAMA_LID, GRUPO]) assert.ok(!seIgnora(j), j)
})

test('chat elegido sin nombre o inválido falla', () => {
  assert.throws(() => new Elegidos([{ id: '+54 9 11 5555-1234' }]))
  assert.throws(() => new Elegidos([{ id: 'status@broadcast', nombre: 'x' }]))
})

test('un número elegido se reconoce por su @lid (remoteJidAlt) y se aprende el alias', () => {
  const e = elegidos()
  const wa = { key: { remoteJid: MAMA_LID, remoteJidAlt: MAMA, id: 'A1', fromMe: false }, messageTimestamp: 1764000000, message: { conversation: 'el jueves 4 a las 10 tengo turno' } }
  const m = mapear(wa, e)
  assert.equal(m.chat, MAMA)
  assert.equal(m.via, 'alternativo')
  assert.equal(m.texto, 'el jueves 4 a las 10 tengo turno')
  assert.equal(m.de, MAMA)
  assert.ok(e.sumarAlias(MAMA, MAMA_LID))
  assert.equal(e.resolver(MAMA_LID), MAMA)
  assert.ok(!e.sumarAlias(MAMA, MAMA_LID), 'no se repite')
})

test('sin el alias ni remoteJidAlt, un @lid desconocido no se guarda', () => {
  assert.equal(mapear({ key: { remoteJid: MAMA_LID, id: 'A2' }, message: { conversation: 'hola' } }, elegidos()), undefined)
})

test('chat no elegido no se guarda', () => {
  assert.equal(mapear({ key: { remoteJid: '5491100000000@s.whatsapp.net', id: 'B' }, message: { conversation: 'secreto' } }, elegidos()), undefined)
})

test('grupo: el remitente es el participante (prefiere el número) y lo propio es "yo"', () => {
  const e = elegidos()
  const m = mapear({ key: { remoteJid: GRUPO, participant: '999@lid', participantAlt: '5491177777777@s.whatsapp.net', id: 'G1' }, pushName: 'Tío', message: { extendedTextMessage: { text: 'asado el domingo' } } }, e)
  assert.equal(m.de, '5491177777777@s.whatsapp.net')
  assert.equal(m.texto, 'asado el domingo')
  const yo = mapear({ key: { remoteJid: GRUPO, fromMe: true, id: 'G2' }, message: { conversation: 'voy' } }, e)
  assert.equal(yo.de, 'yo')
  assert.equal(yo.propio, true)
})

test('contenido: cita, efímero, nota de voz, edición y borrado', () => {
  const c = contenido({ ephemeralMessage: { message: { extendedTextMessage: { text: 'sí', contextInfo: { stanzaId: 'X', quotedMessage: { conversation: '¿venís?' } } } } } })
  assert.deepEqual(c, { tipo: 'texto', texto: 'sí', cita: { id: 'X', texto: '¿venís?' } })
  assert.deepEqual(contenido({ audioMessage: { ptt: true, seconds: 12 } }), { tipo: 'nota_de_voz', segundos: 12, cita: undefined })
  assert.equal(contenido({ protocolMessage: { type: 14, key: { id: 'Y' }, editedMessage: { conversation: 'a las 11' } } }).texto, 'a las 11')
  const e = elegidos()
  const ed = mapear({ key: { remoteJid: MAMA, id: 'E' }, message: { protocolMessage: { type: 14, key: { id: 'Y' }, editedMessage: { conversation: 'a las 11' } } } }, e)
  assert.equal(ed.editado, 'Y')
  const bo = mapear({ key: { remoteJid: MAMA, id: 'R' }, message: { protocolMessage: { type: 0, key: { id: 'Y' } } } }, e)
  assert.equal(bo.borrado, 'Y')
  assert.equal(mapear({ key: { remoteJid: MAMA, id: 'P' }, message: { protocolMessage: { type: 3 } } }, e), undefined)
})

test('metaChat nunca lleva texto', () => {
  assert.deepEqual(metaChat('5491100000000:3@s.whatsapp.net', { nombre: 'Juan', ultimo: 1 }), { jid: '5491100000000@s.whatsapp.net', grupo: false, nombre: 'Juan', ultimo: 1 })
  assert.equal(metaChat('status@broadcast'), undefined)
})
