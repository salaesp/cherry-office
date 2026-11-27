// `claude` falso para la suite de paridad (port de fixtures/claude-fake.sh, que a su vez es el script de
// app/Tests/BackendTests/TestSupport.swift). En Node para que corra igual en macOS, Linux y Windows.
// El sandbox lo copia a `bin/claude` con un shebang al node actual (macOS/Linux: lo puede lanzar Swift) y a
// `bin/claude.cjs` (Windows: el runner TS lo lanza con node).
//
// Responde según una palabra clave del mensaje (último argumento, o la entrada estándar si no hay `--`): ver la
// documentación de `Sandbox` en test/support/sandbox.ts y en TestSupport.swift. Registra en `args.log` los argumentos
// de cada llamada (si el mensaje vino por stdin, se registra como `-- <mensaje>` al final, igual que por argumento),
// en `cwd.log` la carpeta de trabajo y en `events.log` el orden S/E por agente.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const D = path.dirname(fs.realpathSync(process.argv[1]))
const p = (f) => path.join(D, f)
const args = process.argv.slice(2)
const dormirSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const salida = (s) => process.stdout.write(s + '\n')

async function main() {
  if (args[0] === 'auth') {
    fs.appendFileSync(p('events.log'), 'AUTH\n')
    if (fs.existsSync(p('noauth'))) { salida('{"loggedIn":false}'); return 1 }
    salida('{"loggedIn":true}')
    return 0
  }
  let agent = ''
  for (let i = 1; i < args.length; i++) if (args[i - 1] === '--agent') agent = args[i]
  // el mensaje: último argumento después de `--`, o la entrada estándar (Windows: la línea de comandos tiene tope)
  let registrados = args
  let msg = args[args.length - 1] ?? ''
  if (!args.includes('--')) {
    // (si un script envoltorio ya leyó la entrada estándar, la deja en globalThis.__hqMensajeStdin)
    msg = globalThis.__hqMensajeStdin ?? fs.readFileSync(0, 'utf8')
    registrados = [...args, '--', msg]
  }
  const rec = registrados.map((a) => a + '\u001f').join('')
  // corridas paralelas no se mezclan
  for (let n = 0; n <= 500; n++) {
    try { fs.mkdirSync(p('args.lock')); break } catch { dormirSync(10) }
  }
  fs.appendFileSync(p('args.log'), rec + '\u001e')
  try { fs.rmdirSync(p('args.lock')) } catch {}
  fs.appendFileSync(p('events.log'), `S ${agent}\n`)
  const fin = () => fs.appendFileSync(p('events.log'), `E ${agent}\n`)
  fs.appendFileSync(p('cwd.log'), process.cwd() + '\n')
  const tiene = (flag) => args.includes(flag)
  const m = msg.normalize('NFC')
  // skills instaladas (el system/init del claude real las trae): el sondeo de /api/skills y los mensajes con SKILLS
  if (m.includes('SKILLS') || (m === 'Respondé solo: ok' && args[args.indexOf('--tools') + 1] === 'Skill')) salida(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', skills: ['docx', 'pdf', 'xlsx'], mcp_servers: [{ name: 'context7', status: 'connected' }, { name: 'plugin:pw:playwright', status: 'pending' }, { name: 'claude.ai Gmail', status: 'connected', source: 'claudeai' }, { name: 'hq', status: 'connected' }] }))

  let kind = ''
  if (agent === '') {
    // primero las de la memoria: su material puede traer cualquier texto (actas, notas…)
    if (m.includes('Ordenás la memoria de la oficina')) kind = 'memoria'
    else if (m.includes('Te consultan sobre la memoria de la oficina')) kind = 'preguntale'
    else if (m.includes('ador de equipos')) kind = 'borrador'
    else if (m.includes('secretario de actas')) kind = 'acta'
    else if (m.includes('Sos quien ordena el trabajo')) kind = 'tareaschat'
    else if (m.includes('Sos quien convierte una charla en una skill')) kind = 'chatskill'
    else if (m.includes('Sos el bibliotecario')) kind = 'ficha'
    else if (m.includes('imagen que est')) kind = 'imagen'
  } else {
    if (m.includes('en una reuni') || m.startsWith('Sigue la reuni')) kind = 'turno'
    else if (m.includes('documento a la biblioteca')) kind = 'lectura'
    else if (m.includes('consulta de un colega')) kind = 'consulta'
  }
  let modo = ''
  if (agent !== '' && fs.existsSync(p(`modo.${agent}`))) modo = fs.readFileSync(p(`modo.${agent}`), 'utf8')
  else if (kind !== '' && fs.existsSync(p(`modo.${kind}`))) modo = fs.readFileSync(p(`modo.${kind}`), 'utf8')

  const lento = async () => {
    const h = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300000)'], { stdio: 'ignore' })
    fs.writeFileSync(p('child.pid'), String(h.pid) + '\n')
    await new Promise((r) => h.once('exit', r))
    fin()
    return 0
  }
  switch (modo) {
    case 'lento': return lento()
    case 'error': salida('{"type":"result","result":"fallo raro","is_error":true}'); fin(); return 0
    case 'vacio': salida('{"type":"result","result":"","is_error":false}'); fin(); return 0
    case 'nojson': salida('esto no es json'); fin(); return 0
    case 'puerta': for (let n = 0; !fs.existsSync(p('go')) && n < 300; n++) await dormir(50); break
  }
  if (m.includes('LENTO')) return lento()
  if (m.includes('DORMIR')) await dormir(1000)
  if (m.includes('USADA') && tiene('--session-id')) {
    salida('{"type":"result","result":"Error: Session ID is already in use","is_error":true}'); fin(); return 1
  }
  if (m.includes('NOCONV') && tiene('--resume')) {
    salida('{"type":"result","result":"No conversation found with session ID","is_error":true}'); fin(); return 1
  }
  if (m.includes('NOTFOUND') && tiene('--resume')) {
    salida('{"type":"result","result":"Error: session not found","is_error":true}'); fin(); return 1
  }
  if (m.includes('LOGINERR')) { salida('{"type":"result","result":"Please run /login","is_error":true}'); fin(); return 1 }
  if (m.includes('NOJSON')) { salida('esto no es json'); fin(); return 0 }
  if (m.includes('SALE3')) { process.stderr.write('boom\n'); fin(); return 3 }
  if (m.includes('ISERR')) { salida('{"type":"result","result":"fallo raro","is_error":true}'); fin(); return 0 }
  if (m.includes('VACIO')) { salida('{"type":"result","result":"","is_error":false}'); fin(); return 0 }
  // la secretaría sin nada para contar (secretaria.test.ts)
  if (m.includes('FAKE_SIN_NOVEDADES')) { salida('{"type":"result","result":"Sin novedades.","is_error":false}'); fin(); return 0 }
  // una revisión con algo urgente (avisa en el momento) o con notas para el reporte (el reporte: su mensaje empieza así;
  // las instrucciones van como mensaje de sistema)
  const esReporte = m.startsWith('Reporte desde ')
  if (m.includes('FAKE_URGENTE') && !esReporte) {
    salida(JSON.stringify({ type: 'result', result: 'URGENTE: Mamá tiene turno mañana a las 8.\n## Para saber\n- **Mamá** · WhatsApp · 10:00 — Turno mañana a las 8.', is_error: false })); fin(); return 0
  }
  if (esReporte && m.includes('REPORTE_FALLA')) { salida('{"type":"result","result":"fallo raro","is_error":true}'); fin(); return 0 }
  if (esReporte) {
    salida(JSON.stringify({ type: 'result', result: 'Día tranquilo.\n## Para saber\n- **Mamá** · WhatsApp · 10:00 — Pidió turno.', is_error: false })); fin(); return 0
  }

  // PERMISO: también en los turnos de reunión (va en el tema): se atiende abajo, como en el chat
  if (kind !== '' && !(kind === 'turno' && m.includes('PERMISO:'))) {
    const propia = p(`resp.${kind}.${agent}.json`)
    if (agent !== '' && fs.existsSync(propia)) { process.stdout.write(fs.readFileSync(propia)); fin(); return 0 }
    if (fs.existsSync(p(`resp.${kind}.json`))) { process.stdout.write(fs.readFileSync(p(`resp.${kind}.json`))); fin(); return 0 }
    switch (kind) {
      case 'borrador': salida(String.raw`{"type":"result","result":"Acá va el borrador:\n` + '```' + String.raw`json\n{\"id\":\"valentina\",\"nombre\":\"Valentina\",\"rol\":\"Analista de datos\",\"description\":\"Analista de datos. Usala cuando haga falta medir resultados.\",\"prompt\":\"Sos Valentina, analista de datos.\",\"chips\":[\"¿Cómo vamos?\",\"Armame un informe\",\"¿Qué medimos?\"],\"modelo\":\"sonnet\"}\n` + '```' + '","is_error":false}'); break
      case 'acta': salida(String.raw`{"type":"result","result":"{\"resumen\":\"Se acordó avanzar con el plan.\",\"decisiones\":[\"Lanzar en diciembre\",\"Priorizar los reels\"],\"pendientes\":[{\"quien\":\"Marce\",\"que\":\"Armar el calendario\"}]}","is_error":false}`); break
      case 'memoria': salida(String.raw`{"type":"result","result":"{\"temas\":[],\"no_vigentes\":[],\"agentes\":[],\"choques\":[],\"oficina\":null,\"resumen\":\"Nada para ordenar.\"}","is_error":false,"total_cost_usd":0.05}`); break
      case 'preguntale': salida(String.raw`{"type":"result","result":"{\"respuesta\":\"Según lo escrito, no hay más datos. [1]\",\"citas\":[1]}","is_error":false,"total_cost_usd":0.04}`); break
      case 'tareaschat': salida(String.raw`{"type":"result","result":"{\"pendientes\":[{\"quien\":\"Marce\",\"nombre\":\"Calendario de diciembre\",\"consigna\":\"Armá el calendario de publicaciones de diciembre con los reels acordados.\",\"depende_de\":[]},{\"quien\":\"\",\"consigna\":\"Aprobar el presupuesto con el cliente\",\"necesita_usuario\":true,\"depende_de\":[1]}]}","is_error":false,"total_cost_usd":0.01}`); break
      case 'chatskill': salida(String.raw`{"type":"result","result":"{\"nombre\":\"Calendario Mensual\",\"descripcion\":\"Usala cuando te pidan armar el calendario de publicaciones de un mes.\",\"contenido\":\"# Calendario mensual\\n\\n1. Listá las fechas clave.\\n2. Repartí los reels.\"}","is_error":false,"total_cost_usd":0.01}`); break
      case 'ficha': salida(String.raw`{"type":"result","result":"{\"titulo\":\"Ficha de prueba\",\"resumen\":\"Resumen de prueba del documento.\",\"datos_clave\":[\"dato uno\"],\"temas\":[\"pruebas\"],\"util_para\":[\"direccion\"],\"fechas\":[],\"contradicciones\":[]}","is_error":false}`); break
      case 'imagen': salida('{"type":"result","result":"Una imagen de prueba con el texto HOLA MUNDO.","is_error":false}'); break
      case 'turno': salida(JSON.stringify({ type: 'result', result: `Opinión de ${agent} sobre el tema.`, is_error: false, total_cost_usd: 0.02 })); break
      case 'lectura':
        fs.mkdirSync('conocimiento/agentes', { recursive: true })
        fs.appendFileSync(path.join('conocimiento/agentes', `${agent}.md`), '- leyó el documento (prueba)\n')
        salida('{"type":"result","result":"listo","is_error":false}')
        break
      case 'consulta': salida(JSON.stringify({ type: 'result', result: `Mi mirada de ${agent} sobre la consulta.`, is_error: false, total_cost_usd: 0.03 })); break
    }
    fin()
    return 0
  }

  const mcp = () => {
    const cfg = args[args.indexOf('--mcp-config') + 1] ?? ''
    const url = (cfg.match(/http:\/\/127[^"]*/) ?? [''])[0]
    const token = process.env.HQ_MCP_TOKEN ?? ''
    fs.appendFileSync(p('token.log'), token + '\n')
    fs.appendFileSync(p('url.log'), url + '\n')
    return { url, token }
  }
  const post = (url, token, body, espera = 20000) => new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve('') }
    const datos = Buffer.from(body)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: espera,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': datos.length } }, (res) => {
      const partes = []
      res.on('data', (c) => partes.push(c))
      res.on('end', () => resolve(Buffer.concat(partes).toString('utf8')))
    })
    req.on('error', () => resolve(''))
    req.on('timeout', () => { req.destroy(); resolve('') })
    req.end(datos)
  })

  if (m.includes('MCP_LLAMAR') && fs.existsSync(p(`llamadas.${agent}`))) {
    // hace las llamadas de llamadas.<agente> (una línea JSON de `params` de tools/call por línea) con el token del
    // entorno, guarda las respuestas en mcp.<agente>.out y renombra el archivo a .usado (la v2 no las repite). Después
    // sigue con el resto del mensaje (por ejemplo, un ENTREGA:).
    const { url, token } = mcp()
    const lineas = fs.readFileSync(p(`llamadas.${agent}`), 'utf8').split('\n').filter((x) => x !== '')
    fs.renameSync(p(`llamadas.${agent}`), p(`llamadas.${agent}.usado`))
    let i = 0
    for (const linea of lineas) {
      i++
      const body = `{"jsonrpc":"2.0","id":${i},"method":"tools/call","params":${linea}}`
      fs.appendFileSync(p(`mcp.${agent}.out`), (await post(url, token, body)) + '\n')
    }
  }
  if (m.includes('CONSULTAR:')) {
    // llama a `consultar` del servidor MCP con el token del entorno, como haría claude (x4: cuatro veces)
    const colega = m.slice(m.indexOf('CONSULTAR:') + 'CONSULTAR:'.length).split(' ')[0]
    const veces = m.includes('x4') ? 4 : 1
    const { url, token } = mcp()
    for (let i = 1; i <= veces; i++) {
      const body = JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'consultar', arguments: { colega, pregunta: 'Como vamos con lo tuyo?' } } })
      fs.appendFileSync(p(`mcp.${agent}.out`), (await post(url, token, body)) + '\n')
    }
    salida('{"type":"result","result":"consulte","is_error":false,"total_cost_usd":0.01}')
    fin()
    return 0
  }
  if (m.includes('DENEGAR:') || m.includes('respondió los permisos que te faltaron')) {
    // como claude en dontAsk: la primera vuelta (sesión nueva) no tiene permiso para el comando y lo informa en
    // permission_denials; al retomar (--resume) lo hace y termina
    if (!tiene('--resume')) {
      const cmd = m.slice(m.indexOf('DENEGAR:') + 'DENEGAR:'.length).split('\n')[0]
      salida(JSON.stringify({ type: 'result', result: 'No pude correr el comando.', is_error: false, total_cost_usd: 0.01,
        permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: cmd, description: 'Prueba' } },
          { tool_name: 'Bash', tool_use_id: 'toolu_2', tool_input: { command: cmd } },
          { tool_name: 'mcp__claude_ai_Gmail__send', tool_use_id: 'toolu_3', tool_input: {} }] }))
    } else salida(JSON.stringify({ type: 'result', result: 'Listo: corrí el comando y terminé.', is_error: false, total_cost_usd: 0.02 }))
    fin()
    return 0
  }
  if (m.includes('PERMISO:')) {
    // como claude con --permission-prompt-tool: llama a `pedir_permiso` (Bash con el comando que sigue a PERMISO:) y espera
    const cmd = m.slice(m.indexOf('PERMISO:') + 'PERMISO:'.length)
    const { url, token } = mcp()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pedir_permiso', arguments: { tool_name: 'Bash', input: { command: cmd, description: 'Prueba' }, tool_use_id: 'toolu_1' } } })
    fs.appendFileSync(p(`mcp.${agent}.out`), (await post(url, token, body, 30000)) + '\n')
    salida('{"type":"result","result":"permiso pedido","is_error":false,"total_cost_usd":0.01}')
    fin()
    return 0
  }
  if (m.includes('CREADOR_LLAMAR')) {
    // hace las llamadas de creador.calls al servidor MCP con el token del entorno, como haría el Creador de verdad
    const { url, token } = mcp()
    let i = 0
    if (fs.existsSync(p('creador.calls'))) {
      for (const linea of fs.readFileSync(p('creador.calls'), 'utf8').split('\n')) {
        if (linea === '') continue
        i++
        const body = `{"jsonrpc":"2.0","id":${i},"method":"tools/call","params":${linea}}`
        fs.appendFileSync(p('creador.out'), (await post(url, token, body)) + '\n')
      }
    }
    salida('{"type":"result","result":"Listo, armé las tarjetas.","is_error":false,"total_cost_usd":0.02}')
    fin()
    return 0
  }
  if (m.includes('ENTREGA:')) {
    // escribe el archivo pedido (relativo a la carpeta de trabajo) y lo informa como un Write de claude
    const rel = m.slice(m.indexOf('ENTREGA:') + 'ENTREGA:'.length).split(' ')[0]
    const destino = path.join(process.cwd(), rel)
    try {
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, `entregado por ${agent}\n`)
    } catch {} // en Windows un nombre con salto de línea no se puede crear
    // la línea se arma pegando texto, como el script de bash: si la ruta trae un salto de línea o comillas, la línea
    // deja de ser JSON y el backend la ignora (los tests cuentan con eso). Solo se escapan las `\` de Windows.
    const ruta = (process.cwd() + '/' + rel).replace(/\\/g, '\\\\')
    salida(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"${ruta}","content":"x"}}]}}`)
    salida('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/fuera/de/la/oficina.md"}}]}}')
    salida(JSON.stringify({ type: 'result', result: `Listo, dejé ${rel}`, is_error: false, total_cost_usd: 0.03 }))
    fin()
    return 0
  }
  // `/context` de Claude Code: comando local, devuelve el informe en markdown (como el claude real)
  if (m === '/context') {
    const md = '## Context Usage\n\n**Model:** claude-opus-5-5  \n**Tokens:** 150.2k / 1m (15%)\n\n### Estimated usage by category\n\n'
      + '| Category | Tokens | Percentage |\n|----------|--------|------------|\n| System prompt | 10.5k | 1.1% |\n| System tools | 17.3k | 1.7% |\n'
      + '| MCP tools | 18.8k | 1.9% |\n| MCP server instructions | 5.1k | 0.5% |\n| MCP tools (deferred) | 79.3k | 7.9% |\n| Custom agents | 217 | 0.0% |\n'
      + '| Memory files | 428 | 0.0% |\n| Skills | 10k | 1.0% |\n| Messages | 87.9k | 8.8% |\n| Cosa nueva | 1.2k | 0.1% |\n| Free space | 816.8k | 81.7% |\n'
      + '| Autocompact buffer | 33k | 3.3% |\n\n### MCP Tools\n\n| Tool | Server | Tokens |\n|------|--------|--------|\n| mcp__x__y | x | 1.6k |\n'
    salida(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: md, local_command: 'context', total_cost_usd: 0, num_turns: 0 }))
    fin()
    return 0
  }
  // tamaño del contexto: `usage` en cada mensaje del agente (el último manda); los de subagentes no cuentan
  if (m.includes('CTX')) {
    const u = (n) => ({ input_tokens: 3, cache_read_input_tokens: n, cache_creation_input_tokens: 1000, output_tokens: 50 })
    salida(JSON.stringify({ type: 'system', subtype: 'init', session_id: `s-${agent}` }))
    salida(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5-5', usage: u(20000), content: [{ type: 'tool_use', name: 'Task', input: { description: 'x' } }] } }))
    salida(JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { model: 'claude-haiku-5-5', usage: u(90000), content: [{ type: 'text', text: 'sub' }] } }))
    salida(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5-5', usage: u(41000), content: [{ type: 'text', text: 'listo' }] } }))
    salida(JSON.stringify({ type: 'result', subtype: 'success', result: `ctx ${agent}`, is_error: false, total_cost_usd: 0.05,
      usage: u(151000), modelUsage: { 'claude-opus-5-5': { contextWindow: 1000000 }, 'claude-haiku-5-5': { contextWindow: 200000 } } }))
    fin()
    return 0
  }
  if (m.includes('STREAM')) {
    salida('{"type":"system","subtype":"hook_started","hook_name":"x"}')
    salida(JSON.stringify({ type: 'system', subtype: 'init', session_id: `s-${agent}` }))
    salida('{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}')
    salida('{"type":"assistant","message":{"content":[{"type":"text","text":"Voy a mirar el plan."}]}}')
    salida('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/conocimiento/oficina.md"}}]}}')
    if (m.includes('PAUSA')) for (let n = 0; !fs.existsSync(p('go')) && n < 300; n++) await dormir(50)
    salida('{"type":"user","message":{"content":[{"type":"tool_result","content":"secreto"}]}}')
    salida(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', resetsAt: Math.floor(Date.now() / 1000) + 86400, utilization: 0.83 } }))
    salida('{"type":"assistant","message":{"content":[{"type":"text","text":"listo"}]}}')
    salida(JSON.stringify({ type: 'result', subtype: 'success', result: `stream ${agent}`, is_error: false, total_cost_usd: 0.25 }))
    fin()
    return 0
  }
  salida(JSON.stringify({ type: 'result', result: `hola ${agent}`, is_error: false, total_cost_usd: 0.01 }))
  fin()
  return 0
}

main().then((rc) => { process.exitCode = rc }, (e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exitCode = 99 })
