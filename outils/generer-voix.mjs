// Génère les phrases pré-enregistrées de l'appli (voix neuronale Microsoft via edge-tts).
//
// Usage : node outils/generer-voix.mjs [--tts chemin/vers/edge-tts] [--voice fr-FR-DeniseNeural] [--rate -8%] [--force]
//
// 1. Charge app.js hors navigateur (PHRASES_ONLY) et liste toutes les phrases que l'appli peut dire,
//    plus les prénoms de outils/prenoms.txt (pour qu'ils soient dits avec la même voix).
// 2. Génère voix/<id>.mp3 pour chaque phrase qui n'a pas encore son fichier (ou toutes avec --force).
// 3. Écrit voix/manifest.js (liste des id, lu par l'appli et le service worker)
//    et voix/phrases.json (id → texte, pour relire).
// Nécessite edge-tts (pip install edge-tts) et ffmpeg.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'voix')

const args = process.argv.slice(2)
const opt = (name, def) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : def
}
const TTS = opt('tts', 'edge-tts')
const VOICE = opt('voice', 'fr-FR-DeniseNeural')
const RATE = opt('rate', '-8%')
const FORCE = args.includes('--force')
const CONCURRENCY = 4

/* ---------- 1. Lister les phrases ---------- */
// Prénoms des enfants, un par ligne (les lignes vides et celles commençant par # sont ignorées)
const PRENOMS_FILE = join(ROOT, 'outils', 'prenoms.txt')
// « Jessie = Djessi » : affiché « Jessie » dans l'appli, lu « Djessi » par la voix
const PRENOMS = (existsSync(PRENOMS_FILE) ? readFileSync(PRENOMS_FILE, 'utf8').split('\n') : [])
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
        const [shown, spoken] = l.split('=').map((s) => s.trim())
        return { shown, spoken: spoken || shown }
    })

const context = vm.createContext({
    PHRASES_ONLY: true,
    console,
    window: {},
    document: { querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    location: { protocol: 'file:' }
})
vm.runInContext(readFileSync(join(ROOT, 'app.js'), 'utf8'), context, { filename: 'app.js' })

const phrases = vm.runInContext(`(() => {
    const out = new Set()
    const add = (x) => [].concat(x).forEach((p) => { if (typeof p === 'string' && p.trim()) out.add(p.trim()) })
    Object.values(PHRASES).forEach(add)
    PRAISE.forEach((w) => { add(praise(w, false)); add(praise(w, true)) })
    UNIVERSES.forEach((u) => add(u.name + ' !'))
    for (let n = 0; n <= STICKERS.length; n++) add(stickerCount(n))
    ANIMALS.forEach((a) => add(a.cri))
    // Les questions sont tirées au hasard : on en tire assez pour couvrir toutes les combinaisons
    for (const u in GEN) for (const l in GEN[u]) for (let i = 0; i < 5000; i++) {
        const q = GEN[u][l]()
        add(q.say)
        add(q.praise)
        q.choices.forEach((c) => c.no && add(c.no))
    }
    for (const u in DISCOVER) for (const it of DISCOVER[u]) {
        if (u === 'chiffres') COUNT_OBJS.forEach((o) => { it.obj = o; add(it.say()) })
        else add(it.say())
    }
    return [...out].map((text) => ({ id: clipId(text), text }))
})()`, context)

// Le fichier d'un prénom porte l'identifiant du prénom affiché (c'est ce que cherche l'appli),
// mais son texte est la prononciation voulue
const clipId = vm.runInContext('clipId', context)
const nameLine = vm.runInContext('nameLine', context)
for (const { shown, spoken } of PRENOMS) phrases.push({ id: clipId(nameLine(shown)), text: nameLine(spoken) })

const ids = new Set(phrases.map((p) => p.id))
if (ids.size !== phrases.length) throw new Error('Deux phrases ont le même identifiant : changer clipId')
console.log(`${phrases.length} phrases`)

/* ---------- 2. Générer les fichiers manquants ou dont le texte a changé ---------- */
mkdirSync(OUT, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'voix-'))
const before = existsSync(join(OUT, 'phrases.json')) ? JSON.parse(readFileSync(join(OUT, 'phrases.json'), 'utf8')) : {}
const todo = phrases.filter((p) => FORCE || !existsSync(join(OUT, `${p.id}.mp3`)) || before[p.id] !== p.text)
console.log(`${todo.length} à générer avec ${VOICE} (${RATE})`)

let done = 0
async function generate({ id, text }) {
    const raw = join(tmp, `${id}.mp3`)
    await run(TTS, ['--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', raw])
    // Silences de début et de fin retirés (petite respiration gardée), mono, léger
    await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
        'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.12',
        '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', join(OUT, `${id}.mp3`)])
    done++
    if (done % 25 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`)
}

const queue = [...todo]
const failed = []
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
        const p = queue.shift()
        try {
            await generate(p)
        } catch (e) {
            // Le service limite parfois les appels : un second essai après une pause
            await new Promise((r) => setTimeout(r, 3000))
            try { await generate(p) } catch { failed.push(p) }
        }
    }
}))
rmSync(tmp, { recursive: true, force: true })

/* ---------- 3. Manifeste et ménage ---------- */
for (const f of readdirSync(OUT)) {
    if (f.endsWith('.mp3') && !ids.has(f.slice(0, -4))) unlinkSync(join(OUT, f))
}
const present = phrases.filter((p) => existsSync(join(OUT, `${p.id}.mp3`))).sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(join(OUT, 'manifest.js'),
    `// Généré par outils/generer-voix.mjs : phrases pré-enregistrées (voix ${VOICE})\nself.VOICE_CLIPS = ${JSON.stringify(present.map((p) => p.id))}\n`)
writeFileSync(join(OUT, 'phrases.json'), JSON.stringify(Object.fromEntries(present.map((p) => [p.id, p.text])), null, 2) + '\n')

console.log(`${present.length}/${phrases.length} phrases enregistrées`)
if (failed.length) {
    console.log(`Échecs (relancer la commande pour réessayer) :\n${failed.map((p) => `  ${p.text}`).join('\n')}`)
    process.exitCode = 1
}
