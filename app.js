'use strict'

/* =========================================================
   Réglages
   ========================================================= */
const STORE_KEY = 'ptit-malin.v1'
const STREAK_GOAL = 5          // bonnes réponses du premier coup pour finir un niveau
const HINT_AFTER = 2           // la bonne réponse clignote après 2 essais ratés
const NAME_RATE = 0.25         // part des bonnes réponses où l'on dit le prénom de l'enfant
const DEFAULT_TIMER_MIN = 0    // 0 = sans limite de temps (le parent peut en fixer une)
const SESSION_GAP_MS = 2 * 3600 * 1000 // après 2 h sans jouer, une nouvelle session commence
const AVATARS = ['🐻', '🐰', '🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🦁', '🐧']
const STICKERS = ['🦄', '🐉', '🚀', '🌈', '🦖', '🐙', '🦋', '🍦', '🎠', '🚂', '🧸', '🐬', '🌟', '🍭', '🦒',
    '🐼', '🎪', '🏰', '🚁', '🦜', '🐞', '🍉', '🎨', '⛵', '🐧', '🦔', '🌵', '🍩', '🎺', '🛸']
const PRAISE = ['Bravo', 'Super', 'Génial', 'Bien joué', 'Youpi', 'Formidable']

/* Phrases fixes. Toutes les phrases sont pré-enregistrées (voix Denise, dossier voix/) :
   outils/generer-voix.mjs les retrouve ici et dans les générateurs de questions.
   Le prénom, lui, est dit par la voix de l'appareil : on le place entre deux phrases avec NAME. */
const NAME = { name: true }
const PHRASES = {
    hello: 'Bonjour,',
    whatToPlay: 'À quoi veux-tu jouer ?',
    discover: 'Touche ce que tu veux pour découvrir !',
    locked: "Pas encore ! Termine d'abord le niveau d'avant.",
    levelDone: 'Tu as réussi le niveau !',
    newSticker: 'Tu as réussi le niveau ! Voici un nouvel autocollant pour ta collection !',
    noSticker: 'Gagne des niveaux pour avoir des autocollants !',
    timeUp: "C'est fini pour aujourd'hui,",
    wellPlayed: 'Tu as très bien joué ! À bientôt !',
    bye: 'À bientôt,',
    redTest: "C'est le rouge !",
    tapArrow: 'Touche la flèche pour continuer !'
}
const stickerCount = (n) => (n ? `Tu as ${n} autocollant${n > 1 ? 's' : ''} !` : PHRASES.noSticker)
// « Bravo ! » seul, ou « Bravo, » suivi du prénom
const praise = (word, withName) => (withName ? [`${word},`, NAME] : [`${word} !`])
const WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix']

/* =========================================================
   Utilitaires
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const rand = (a) => a[Math.floor(Math.random() * a.length)]
const shuffle = (a) => {
    const b = [...a]
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]]
    }
    return b
}
const sample = (a, k) => shuffle(a).slice(0, k)
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
// Relance une petite animation CSS (.pulse) sur un élément
const pulse = (el) => {
    if (!el) return
    el.classList.remove('pulse')
    void el.offsetWidth
    el.classList.add('pulse')
}

/* =========================================================
   Stockage local (aucun serveur, aucun compte)
   ========================================================= */
const Store = {
    data: null,
    load() {
        try { this.data = JSON.parse(localStorage.getItem(STORE_KEY)) } catch { this.data = null }
        if (!this.data || !Array.isArray(this.data.profiles)) {
            this.data = { profiles: [], currentId: null, settings: {}, session: {} }
        }
        this.data.settings = { timerMin: DEFAULT_TIMER_MIN, ...this.data.settings }
        // Une durée que le parent n'a pas choisie lui-même (ancien réglage par défaut) suit le défaut actuel
        if (!this.data.settings.timerSetByParent) this.data.settings.timerMin = DEFAULT_TIMER_MIN
        this.data.session = { usedMs: 0, last: 0, ...this.data.session }
        if (!this.profile && this.data.profiles.length) this.data.currentId = this.data.profiles[0].id
        // Profils créés avant le choix de l'âge : 3 ans
        for (const p of this.data.profiles) p.age ||= 3
    },
    save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)) } catch { /* stockage indisponible */ }
    },
    get profile() {
        return this.data?.profiles.find((p) => p.id === this.data.currentId) || null
    },
    addProfile(name, avatar, age = 3) {
        const p = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name,
            avatar,
            age,
            progress: {},
            stickers: []
        }
        this.data.profiles.push(p)
        this.data.currentId = p.id
        this.save()
        return p
    },
    removeProfile(id) {
        this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
        if (this.data.currentId === id) this.data.currentId = this.data.profiles[0]?.id || null
        this.save()
    }
}

/* =========================================================
   Voix (Web Speech API, français)
   ========================================================= */
// Voix « gadget » d'Apple, très robotiques : jamais choisies automatiquement
const ROBOTIC_VOICES = /\b(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Jacques|Albert|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Zarvox|Trinoids|Organ|Whisper|Superstar|Ralph|Fred|Junior|Kathy)\b/i

const Voice = {
    voice: null,
    list: [],
    onlineFailed: false,
    supported: 'speechSynthesis' in window,
    // Plus le score est haut, plus la voix est naturelle
    score(v) {
        let s = 0
        if (/premium|enhanced|améliorée|natural|neural/i.test(v.name)) s += 100
        if (/microsoft.*online/i.test(v.name)) s += 70
        if (/google/i.test(v.name)) s += 60
        if (/Audrey|Amélie|Thomas|Marie|Aurélie|Denise|Henri|Virginie|Hortense|Julie|Paul|Eloise|Vivienne/i.test(v.name)) s += 30
        if (ROBOTIC_VOICES.test(v.name)) s -= 200
        if (/fr[-_]FR/i.test(v.lang)) s += 20
        if (!v.localService && this.onlineFailed) s -= 300 // voix en ligne inutilisable (hors connexion)
        return s
    },
    pick() {
        this.list = speechSynthesis.getVoices()
            .filter((v) => /^fr/i.test(v.lang))
            .sort((a, b) => this.score(b) - this.score(a))
        const chosen = Store.data.settings.voiceURI
        this.voice = this.list.find((v) => v.voiceURI === chosen && (v.localService || !this.onlineFailed))
            || this.list[0] || null
    },
    init() {
        if (!this.supported) return
        this.pick()
        speechSynthesis.addEventListener?.('voiceschanged', () => this.pick())
    },
    // Dit une phrase : l'enregistrement de Denise s'il existe, sinon la voix de l'appareil.
    // Toute nouvelle phrase coupe ce qui joue : séquence Talk en cours, phrase et cri d'animal.
    say(text, fromTalk = false) {
        this.stopAll(fromTalk)
        const id = clipId(text)
        if (!VOICE_CLIPS.has(id)) return this.speak(text)
        return Clip.play(Clip.voice, `voix/${id}.mp3`).then((ok) => ok || this.speak(text))
    },
    // Le prénom : enregistré avec la même voix s'il figure dans outils/prenoms.txt, sinon voix de l'appareil
    sayName(name, fromTalk = false) {
        return hasNameClip(name) ? this.say(nameLine(name), fromTalk) : this.tts(name, fromTalk)
    },
    // Voix de l'appareil seulement
    tts(text, fromTalk = false) {
        this.stopAll(fromTalk)
        return this.speak(text)
    },
    stopAll(fromTalk) {
        if (!fromTalk) Talk.token++
        Clip.stop(Clip.voice)
        Clip.stop(Clip.animal)
        if (this.supported) speechSynthesis.cancel()
    },
    // Synthèse de l'appareil ; résout à la fin de la phrase (avec un filet de sécurité si l'événement ne vient pas)
    speak(text) {
        return new Promise((resolve) => {
            if (!this.supported) return setTimeout(resolve, 600)
            speechSynthesis.cancel()
            const u = new SpeechSynthesisUtterance(text)
            u.lang = 'fr-FR'
            if (this.voice) u.voice = this.voice
            // Hauteur naturelle : la monter rend la voix plus robotique
            u.rate = 0.95
            u.pitch = 1
            let done = false
            const finish = () => { if (!done) { done = true; clearTimeout(t); resolve() } }
            const t = setTimeout(finish, 1500 + text.length * 90)
            u.onend = finish
            u.onerror = (e) => {
                // Voix en ligne (Google, Microsoft…) sans connexion : on rebascule sur la meilleure voix de l'appareil
                if (this.voice && !this.voice.localService && !['interrupted', 'canceled'].includes(e.error)) {
                    this.onlineFailed = true
                    this.pick()
                    if (this.voice?.localService) {
                        clearTimeout(t)
                        done = true
                        return this.speak(text).then(resolve)
                    }
                }
                finish()
            }
            speechSynthesis.speak(u)
        })
    }
}

/* =========================================================
   Fichiers audio : phrases enregistrées (voix/) et vrais cris d'animaux (sons/)
   ========================================================= */
// Identifiant d'une phrase enregistrée (FNV-1a 32 bits) : même calcul dans outils/generer-voix.mjs
function clipId(text) {
    const s = text.trim()
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
}
// Liste écrite par outils/generer-voix.mjs dans voix/manifest.js
const VOICE_CLIPS = new Set(globalThis.VOICE_CLIPS || [])
// Texte enregistré pour un prénom (même forme dans outils/generer-voix.mjs)
const nameLine = (name) => `${name.trim()} !`
const hasNameClip = (name) => VOICE_CLIPS.has(clipId(nameLine(name)))

// Fichier à jouer pour un morceau de séquence (phrase enregistrée ou cri), null s'il n'y en a pas
const clipSrc = (p) => typeof p === 'string'
    ? (VOICE_CLIPS.has(clipId(p)) ? `voix/${clipId(p)}.mp3` : null)
    : p?.snd ? `sons/${p.snd}.mp3` : null

/* Sons joués par Web Audio : décodés en mémoire, ils démarrent sans délai et ne passent pas par l'élément <audio>,
   qui se bloquait sur iPad avec les fichiers du cache hors ligne. Chaque attente a une durée maximale. */
const Clip = {
    voice: 'voice',
    animal: 'animal',
    MAX_BUFFERS: 80,       // sons décodés gardés en mémoire (les plus anciens sont oubliés)
    LOAD_TIMEOUT: 3000,    // au-delà, on n'attend plus un son qui tarde à arriver
    buffers: new Map(),    // src → Promise<AudioBuffer | null>
    playing: {},           // canal → { finish, source }
    load(src) {
        if (this.buffers.has(src)) return this.buffers.get(src)
        const ctx = Sfx.get()
        const p = !ctx ? Promise.resolve(null) : fetch(src)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .then((data) => data && new Promise((res, rej) => ctx.decodeAudioData(data, res, rej)))
            .catch(() => null)
        // Un échec (réseau coupé…) n'est pas retenu : on réessaiera la prochaine fois
        p.then((b) => { if (!b) this.buffers.delete(src) })
        this.buffers.set(src, p)
        if (this.buffers.size > this.MAX_BUFFERS) this.buffers.delete(this.buffers.keys().next().value)
        return p
    },
    // Prépare à l'avance les sons d'une liste de morceaux de séquence
    preload(parts) {
        for (const p of [parts].flat(Infinity)) {
            const src = clipSrc(p)
            if (src) this.load(src)
        }
    },
    // Résout true une fois le son joué (ou coupé), false s'il manque ou n'a pas pu être chargé à temps
    play(channel, src) {
        this.stop(channel)
        return new Promise((resolve) => {
            let done = false
            let timer = null
            const finish = (ok) => {
                if (done) return
                done = true
                clearTimeout(timer)
                if (this.playing[channel]?.finish === finish) delete this.playing[channel]
                resolve(ok)
            }
            timer = setTimeout(() => finish(false), this.LOAD_TIMEOUT)
            this.playing[channel] = { finish }
            this.load(src).then(async (buffer) => {
                if (done) return
                const ctx = Sfx.get()
                if (!buffer || !ctx) return finish(false)
                if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), wait(300)])
                // Son pas encore autorisé (aucun toucher depuis l'ouverture) : on passe sans rester bloqué
                if (done || ctx.state !== 'running') return finish(true)
                const source = ctx.createBufferSource()
                source.buffer = buffer
                source.connect(ctx.destination)
                source.onended = () => finish(true)
                this.playing[channel] = { finish, source }
                clearTimeout(timer)
                timer = setTimeout(() => finish(true), buffer.duration * 1000 + 500)
                source.start()
            })
        })
    },
    stop(channel) {
        const p = this.playing[channel]
        if (!p) return
        delete this.playing[channel]
        try { p.source?.stop() } catch { /* déjà arrêté */ }
        p.finish(true)
    },
    // Au premier toucher : débloque le son (exigence de Safari), et sur iPhone le joue même en mode silencieux
    unlock() {
        Sfx.get()
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch { /* non pris en charge */ }
    }
}

/* Enchaîne des phrases, le prénom et des cris : ['La vache. Elle fait :', animal, 'Son bébé…'].
   Une nouvelle séquence (ou une phrase dite ailleurs) interrompt la précédente. */
const Talk = {
    token: 0,
    async run(parts) {
        const my = ++this.token
        for (const p of [].concat(parts)) {
            if (my !== this.token) return
            if (typeof p === 'string') await Voice.say(p, true)
            // Comparer au marqueur lui-même : les animaux ont aussi une propriété name (« le chien »)
            else if (p === NAME) await Voice.sayName(Store.profile?.name || '', true)
            else if (p.sfx) { Sfx[p.sfx](); await wait(700) }
            else if (p.drum) {
                // Modèle : le tambour bat une fois par morceau du mot
                for (let i = 0; i < p.drum && my === this.token; i++) {
                    Sfx.drum()
                    pulse($('.drum'))
                    await wait(550)
                }
            }
            else if (!(await Clip.play(Clip.animal, `sons/${p.snd}.mp3`)) && my === this.token) await Voice.say(p.cri, true)
        }
    }
}

/* =========================================================
   Petits sons (Web Audio, aucun fichier)
   ========================================================= */
const Sfx = {
    ctx: null,
    get() {
        if (!this.ctx) {
            const C = window.AudioContext || window.webkitAudioContext
            if (!C) return null
            this.ctx = new C()
        }
        // « interrupted » : état de Safari après un appel ou un passage en arrière-plan
        if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume()
        return this.ctx
    },
    tone(freq, start, dur, type = 'sine', vol = 0.18) {
        const c = this.get()
        if (!c) return
        const o = c.createOscillator()
        const g = c.createGain()
        const t = c.currentTime + start
        o.type = type
        o.frequency.value = freq
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(g).connect(c.destination)
        o.start(t)
        o.stop(t + dur + 0.05)
    },
    tap() { this.tone(660, 0, 0.07, 'sine', 0.08) },
    good() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.08, 0.25, 'triangle')) },
    soft() { this.tone(330, 0, 0.18, 'sine', 0.12); this.tone(262, 0.13, 0.25, 'sine', 0.12) },
    fanfare() { [523, 659, 784, 659, 784, 1047, 1047].forEach((f, i) => this.tone(f, i * 0.13, 0.32, 'triangle', 0.2)) },
    // Instruments du train des motifs et du tambour des syllabes
    drum() { this.tone(120, 0, 0.18, 'sine', 0.45); this.tone(70, 0, 0.3, 'triangle', 0.35) },
    bell() { this.tone(1320, 0, 1, 'sine', 0.16); this.tone(1980, 0, 0.7, 'sine', 0.06) },
    trumpet() { this.tone(466, 0, 0.4, 'sawtooth', 0.07); this.tone(932, 0, 0.35, 'square', 0.025) }
}

/* =========================================================
   Confettis (canvas plein écran)
   ========================================================= */
const Confetti = {
    cv: null,
    ctx: null,
    parts: [],
    running: false,
    colors: ['#6C4AB6', '#9D7BFF', '#C4B3FF', '#FFC93C', '#FFE08A'],
    init() {
        this.cv = $('#confetti')
        this.ctx = this.cv.getContext('2d')
        const resize = () => {
            const d = window.devicePixelRatio || 1
            this.cv.width = innerWidth * d
            this.cv.height = innerHeight * d
            this.ctx.setTransform(d, 0, 0, d, 0, 0)
        }
        resize()
        addEventListener('resize', resize)
    },
    add(p) {
        this.parts.push({ r: 5 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 0, star: Math.random() < 0.3, c: rand(this.colors), ...p })
        if (!this.running) { this.running = true; requestAnimationFrame(() => this.step()) }
    },
    burst(x, y, n = 50) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2
            const s = 3 + Math.random() * 8
            this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 5 })
        }
    },
    rain(n = 160) {
        for (let i = 0; i < n; i++) {
            this.add({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3, life: -120 })
        }
    },
    step() {
        const c = this.ctx
        c.clearRect(0, 0, innerWidth, innerHeight)
        this.parts = this.parts.filter((p) => p.life < 200 && p.y < innerHeight + 40)
        for (const p of this.parts) {
            p.vy += 0.22
            p.vx *= 0.99
            p.x += p.vx
            p.y += p.vy
            p.rot += p.vr
            p.life++
            c.save()
            c.translate(p.x, p.y)
            c.rotate(p.rot)
            c.globalAlpha = Math.max(0, Math.min(1, (200 - p.life) / 40))
            c.fillStyle = p.c
            if (p.star) {
                c.beginPath()
                for (let i = 0; i < 10; i++) {
                    const rad = i % 2 ? p.r * 0.45 : p.r
                    const a = -Math.PI / 2 + (i * Math.PI) / 5
                    c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
                }
                c.fill()
            } else {
                c.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2)
            }
            c.restore()
        }
        if (this.parts.length) requestAnimationFrame(() => this.step())
        else { this.running = false; c.clearRect(0, 0, innerWidth, innerHeight) }
    }
}

/* =========================================================
   Contenus pédagogiques
   ========================================================= */
const COLORS = [
    { id: 'rouge', hex: '#E53935', objs: [['🍓', 'la fraise'], ['🍎', 'la pomme'], ['🍅', 'la tomate'], ['🚒', 'le camion de pompiers']] },
    { id: 'bleu', hex: '#1E88E5', objs: [['🐳', 'la baleine'], ['💧', "la goutte d'eau"], ['🫐', 'les myrtilles'], ['🧢', 'la casquette']] },
    { id: 'jaune', hex: '#FDD835', objs: [['🍌', 'la banane'], ['🌻', 'le tournesol'], ['🐥', 'le poussin'], ['🧀', 'le fromage']] },
    { id: 'vert', hex: '#43A047', objs: [['🐸', 'la grenouille'], ['🥦', 'le brocoli'], ['🍀', 'le trèfle'], ['🥒', 'le concombre']] },
    { id: 'orange', hex: '#FB8C00', objs: [['🥕', 'la carotte'], ['🎃', 'la citrouille'], ['🦊', 'le renard'], ['🏀', 'le ballon']] },
    { id: 'violet', hex: '#8E24AA', objs: [['🍇', 'le raisin'], ['🍆', "l'aubergine"], ['🔮', 'la boule magique']] }
].map((c) => ({ ...c, objs: c.objs.map(([e, name]) => ({ e, name })) }))
const BASE_COLORS = COLORS.slice(0, 4)
// « le rouge », mais « l'orange »
const theColor = (c) => (/^[aeiouy]/i.test(c.id) ? `l'${c.id}` : `le ${c.id}`)

function starPoints(cx, cy, R, r) {
    const pts = []
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rad = i % 2 ? r : R
        pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`)
    }
    return pts.join(' ')
}
const SHAPES = {
    cercle: { name: 'le cercle', el: '<circle cx="50" cy="50" r="42"/>' },
    carre: { name: 'le carré', el: '<rect x="9" y="9" width="82" height="82" rx="6"/>' },
    triangle: { name: 'le triangle', el: '<polygon points="50,7 95,90 5,90"/>' },
    etoile: { name: "l'étoile", el: `<polygon points="${starPoints(50, 53, 47, 20)}"/>` },
    coeur: { name: 'le cœur', el: '<path d="M50 90C22 68 5 50 5 31 5 16 16 7 29 7c9 0 16 5 21 13 5-8 12-13 21-13 13 0 24 9 24 24 0 19-17 37-45 59z"/>' },
    rectangle: { name: 'le rectangle', el: '<rect x="3" y="24" width="94" height="52" rx="6"/>' }
}
const BASE_SHAPES = ['cercle', 'carre', 'triangle']
const NEW_SHAPES = ['etoile', 'coeur', 'rectangle']
const ALL_SHAPES = [...BASE_SHAPES, ...NEW_SHAPES]
// Toutes les formes de la même couleur : l'enfant regarde la forme, pas la couleur
const SHAPE_FILL = '#6C4AB6'
const shapeSvg = (id, { fill, stroke = 'none', sw = 0, dash = false }) =>
    `<svg class="shape" viewBox="-6 -6 112 112" aria-hidden="true"><g fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash ? ' stroke-dasharray="9 7"' : ''}>${SHAPES[id].el}</g></svg>`

const ANIMALS = [
    // snd = fichier sons/<snd>.mp3 ; cri = ce que dit la voix si le fichier manque
    { e: '🐶', snd: 'chien', name: 'le chien', cri: 'Ouaf ouaf !', baby: 'le chiot' },
    { e: '🐱', snd: 'chat', name: 'le chat', cri: 'Miaou !', baby: 'le chaton' },
    { e: '🐮', snd: 'vache', name: 'la vache', cri: 'Meuh !', baby: 'le veau' },
    { e: '🐷', snd: 'cochon', name: 'le cochon', cri: 'Groin groin !', baby: 'le porcelet' },
    { e: '🐑', snd: 'mouton', name: 'le mouton', cri: 'Bêêê !', baby: "l'agneau" },
    { e: '🦆', snd: 'canard', name: 'le canard', cri: 'Coin coin !', baby: 'le caneton' },
    { e: '🐴', snd: 'cheval', name: 'le cheval', cri: 'Hiii hiii !', baby: 'le poulain' },
    { e: '🐔', snd: 'poule', name: 'la poule', cri: 'Cot cot codet !', baby: 'le poussin', babyE: '🐣' },
    { e: '🦁', snd: 'lion', name: 'le lion', cri: 'Grraaou !', baby: 'le lionceau' },
    { e: '🐸', snd: 'grenouille', name: 'la grenouille', cri: 'Croa croa !' }
]
const pronoun = (a) => (a.name.startsWith('la ') ? 'Elle' : 'Il')

// Enregistrements de Wikimedia Commons, raccourcis et mis au même volume (attribution exigée par CC BY / CC BY-SA)
const SOUND_CREDITS = [
    ['Chien', 'Barking of a dog.ogg', 'Amada44', 'CC BY-SA 3.0'],
    ['Chat', 'Meow.ogg', 'Dan Crosby (Dcrosby)', 'CC BY-SA 3.0'],
    ['Vache', 'Single Cow Moo.ogg', 'MichaeltheFox8621', 'CC BY-SA 4.0'],
    ['Cochon', 'Pig grunt - Erdie.ogg', 'erdie', 'CC BY 3.0'],
    ['Mouton', 'Sheep bleating.ogg', 'earthcalling', 'Domaine public'],
    ['Canard', 'Anas platyrhynchos - Mallard XC62258.mp3', 'Jonathon Jongsma', 'CC BY-SA 3.0'],
    ['Cheval', 'Wiehern.ogg', 'Hü.', 'Domaine public'],
    ['Poule', 'Hen announcing shes lain an egg.ogg', 'alys', 'Domaine public'],
    ['Lion', 'Lion raring-sound1TamilNadu178.ogg', 'த*உழவன்', 'Domaine public'],
    ['Grenouille', 'Single Frog Croak.oga', 'MichaeltheFox8621', 'CC BY-SA 4.0']
]

const COUNT_OBJS = [
    { e: '🍎', s: 'pomme', p: 'pommes', f: true },
    { e: '🎈', s: 'ballon', p: 'ballons' },
    { e: '⭐', s: 'étoile', p: 'étoiles', f: true },
    { e: '🐟', s: 'poisson', p: 'poissons' },
    { e: '🌸', s: 'fleur', p: 'fleurs', f: true },
    { e: '🚗', s: 'voiture', p: 'voitures', f: true },
    { e: '🐞', s: 'coccinelle', p: 'coccinelles', f: true }
]
const qty = (n, o) => (n === 1 ? `${o.f ? 'une' : 'un'} ${o.s}` : `${WORDS[n]} ${o.p}`)
const de = (w) => (/^[aeéiouy]/i.test(w) ? `d'${w}` : `de ${w}`)
const counting = (n) => cap(WORDS.slice(1, n + 1).join(', '))

/* Morceaux de choix réutilisés */
const emo = (e) => `<span class="emoji">${e}</span>`
const digit = (n) => `<span class="digit">${n}</span>`
const group = (n, e) => `<span class="group g${n}">${Array.from({ length: n }, () => `<i>${e}</i>`).join('')}</span>`
// `no` = ce que dit la voix si l'enfant touche ce choix alors qu'il est faux : on nomme ce qu'il a touché
const card = (html, label, correct, no) => ({ kind: 'card', html, label, correct, no })
const thatIs = (name) => `Non, ça, c'est ${name}.`

const question = (say, visual, choices, praise, key) => ({ say, visual, choices: shuffle(choices), praise, key })

/* Générateurs de questions : GEN[univers][niveau]() */
const GEN = {
    couleurs: {
        1() {
            const set = sample(BASE_COLORS, 3)
            const t = rand(set)
            return question(`Touche ${theColor(t)}.`, null,
                set.map((c) => ({ kind: 'swatch', html: `<span class="swatch" style="background:${c.hex}"></span>`, label: c.id, correct: c === t, no: thatIs(theColor(c)) })),
                `C'est ${theColor(t)} !`, t.id)
        },
        2() {
            const t = rand(COLORS)
            const [a, b] = sample(t.objs, 2)
            const others = sample(COLORS.filter((c) => c !== t), 2).map((c) => ({ ...rand(c.objs), color: c.id }))
            return question(`Trouve une chose de la même couleur que ${a.name}.`, emo(a.e),
                [card(emo(b.e), b.name, true), ...others.map((o) => card(emo(o.e), o.name, false, `Non, ${o.name}, c'est ${o.color}.`))],
                `${cap(b.name)}, c'est ${t.id} aussi !`, a.e)
        },
        3() {
            const set = sample(COLORS, 3)
            const t = rand(set)
            const o = rand(t.objs)
            return question(`Range ${o.name} dans le panier de la bonne couleur.`, emo(o.e),
                set.map((c) => ({ kind: 'bin', html: `<span class="bin" style="--bin:${c.hex}"></span>`, label: `panier ${c.id}`, correct: c === t, no: thatIs(`le panier ${c.id}`) })),
                `${cap(o.name)}, c'est ${t.id} !`, o.e)
        }
    },
    formes: {
        1() {
            const t = rand(BASE_SHAPES)
            return question(`Touche ${SHAPES[t].name}.`, null,
                BASE_SHAPES.map((id, i) => card(shapeSvg(id, { fill: SHAPE_FILL }), SHAPES[id].name, id === t, thatIs(SHAPES[id].name))),
                `C'est ${SHAPES[t].name} !`, t)
        },
        2() {
            const t = rand(BASE_SHAPES)
            return question('Regarde cette ombre. Quelle forme va dedans ?', `<span class="silhouette">${shapeSvg(t, { fill: '#2E2540' })}</span>`,
                BASE_SHAPES.map((id, i) => card(shapeSvg(id, { fill: SHAPE_FILL }), SHAPES[id].name, id === t, `${thatIs(SHAPES[id].name)} Il ne va pas dans l'ombre.`)),
                `C'est ${SHAPES[t].name} !`, t)
        },
        3() {
            // Moitié reconnaissance des nouvelles formes, moitié tri dans les boîtes
            if (Math.random() < 0.5) {
                const t = Math.random() < 0.7 ? rand(NEW_SHAPES) : rand(BASE_SHAPES)
                const ids = [t, ...sample(ALL_SHAPES.filter((s) => s !== t), 3)]
                return question(`Touche ${SHAPES[t].name}.`, null,
                    ids.map((id, i) => card(shapeSvg(id, { fill: SHAPE_FILL }), SHAPES[id].name, id === t, thatIs(SHAPES[id].name))),
                    `C'est ${SHAPES[t].name} !`, `r${t}`)
            }
            const ids = sample(ALL_SHAPES, 3)
            const t = rand(ids)
            return question(`Range ${SHAPES[t].name} dans la bonne boîte.`, shapeSvg(t, { fill: SHAPE_FILL }),
                ids.map((id) => ({ kind: 'box', html: shapeSvg(id, { fill: 'rgba(108,74,182,.06)', stroke: '#9C8CC4', sw: 5, dash: true }), label: `boîte pour ${SHAPES[id].name}`, correct: id === t, no: thatIs(`la boîte pour ${SHAPES[id].name}`) })),
                `C'est ${SHAPES[t].name} !`, `s${t}`)
        }
    },
    animaux: {
        1() {
            const set = sample(ANIMALS, 3)
            const t = rand(set)
            return question(`Où est ${t.name} ?`, null,
                set.map((a) => card(emo(a.e), a.name, a === t, thatIs(a.name))), `C'est ${t.name} !`, t.e)
        },
        2() {
            const set = sample(ANIMALS, 3)
            const t = rand(set)
            // Phrases et vrais cris enchaînés (voir Talk)
            return question(['Écoute ! Qui fait ce bruit ?', t], null,
                set.map((a) => card(emo(a.e), a.name, a === t, [`Non, ça, c'est ${a.name}. ${pronoun(a)} fait :`, a])),
                `C'est ${t.name} !`, t.e)
        },
        3() {
            const set = sample(ANIMALS.filter((a) => a.baby), 3)
            const t = rand(set)
            return question(`${cap(t.baby)} cherche sa maman. Où est-elle ?`,
                `<span class="baby"><span class="emoji">${t.babyE || t.e}</span><span class="bottle">🍼</span></span>`,
                set.map((a) => card(emo(a.e), a.name, a === t, `${thatIs(a.name)} C'est la maman ${a.baby.startsWith("l'") ? "de l'" + a.baby.slice(2) : 'du ' + a.baby.slice(3)}.`)),
                `${cap(t.baby)} a retrouvé sa maman !`, t.e)
        }
    },
    chiffres: {
        1() {
            const t = rand([1, 2, 3])
            return question(`Touche le chiffre ${WORDS[t]}.`, null,
                [1, 2, 3].map((n) => card(digit(n), String(n), n === t, thatIs(`le ${WORDS[n]}`))), `C'est le ${WORDS[t]} !`, t)
        },
        2() {
            const o = rand(COUNT_OBJS)
            const ns = sample([1, 2, 3, 4, 5], 3)
            const t = rand(ns)
            return question(`Où y a-t-il ${qty(t, o)} ?`, null,
                ns.map((n) => card(group(n, o.e), qty(n, o), n === t, `Non, là, il y a ${qty(n, o)}.`)), `${counting(t)} : ${qty(t, o)} !`, `${t}${o.e}`)
        },
        3() {
            const o = rand(COUNT_OBJS)
            const ns = sample([1, 2, 3, 4, 5], 3)
            const t = rand(ns)
            if (Math.random() < 0.5) {
                return question(`Combien y a-t-il ${de(o.p)} ? Touche le bon chiffre.`, group(t, o.e),
                    ns.map((n) => card(digit(n), String(n), n === t, thatIs(`le ${WORDS[n]}`))), `${counting(t)} : ${qty(t, o)} !`, `a${t}`)
            }
            return question(`Trouve le groupe qui va avec le chiffre ${WORDS[t]}.`, digit(t),
                ns.map((n) => card(group(n, o.e), qty(n, o), n === t, `Non, là, il y a ${qty(n, o)}.`)), `${counting(t)} : ${qty(t, o)} !`, `b${t}`)
        }
    }
}

/* Mode Découvrir : l'enfant touche librement, la voix explique (aucune bonne ou mauvaise réponse) */
const SHAPE_TALK = {
    cercle: 'Le cercle. Il est tout rond, comme une balle.',
    carre: 'Le carré. Il a quatre côtés pareils, et quatre coins.',
    triangle: 'Le triangle. Il a trois côtés et trois pointes.',
    etoile: "L'étoile. Elle a cinq pointes, comme les étoiles dans le ciel.",
    coeur: "Le cœur. C'est le signe de l'amour !",
    rectangle: 'Le rectangle. Il a deux grands côtés et deux petits côtés, comme une porte.'
}
// Les objets apparaissent un par un pendant que la voix parle
const appearing = (list, start, step) => list.map((h, i) => `<i style="animation-delay:${(start + i * step).toFixed(2)}s">${h}</i>`).join('')
// Forme dont le contour se dessine, puis se remplit
const drawSvg = (id) => `<svg class="shape draw" viewBox="-6 -6 112 112" aria-hidden="true"><g fill="${SHAPE_FILL}" stroke="#4F3591" stroke-width="4" stroke-linejoin="round">${SHAPES[id].el.replace(/\/>$/, ' pathLength="1"/>')}</g></svg>`

const DISCOVER = {
    couleurs: COLORS.map((c) => ({
        kind: 'swatch',
        label: c.id,
        html: `<span class="swatch" style="background:${c.hex}"></span>`,
        // Calé sur la voix enregistrée : chaque objet apparaît quand il est nommé (~1,3 s chacun après « Regarde : »)
        spot: () => `<span class="spot-swatch" style="background:${c.hex}"></span><span class="spot-row">${appearing(c.objs.map((o) => o.e), 2.2, 1.3)}</span>`,
        say: () => `${cap(theColor(c))}. Regarde : ${c.objs.map((o) => o.name).join(', ')}. Tout ça, c'est ${c.id} !`
    })),
    formes: ALL_SHAPES.map((id) => ({
        kind: 'card',
        label: SHAPES[id].name,
        html: shapeSvg(id, { fill: SHAPE_FILL }),
        spot: () => drawSvg(id),
        say: () => SHAPE_TALK[id]
    })),
    animaux: ANIMALS.map((a) => ({
        kind: 'card',
        label: a.name,
        html: emo(a.e),
        spot: () => `<span class="spot-emoji">${a.e}</span>${a.baby ? `<span class="spot-baby spot-late" style="animation-delay:2.4s"><span>${a.babyE || a.e}</span><span class="bottle">🍼</span></span>` : ''}`,
        say: () => [`${cap(a.name)}. ${pronoun(a)} fait :`, a, ...(a.baby ? [`Son bébé, c'est ${a.baby}.`] : [])]
    })),
    chiffres: [1, 2, 3, 4, 5].map((n) => ({
        kind: 'card',
        label: String(n),
        html: digit(n),
        spot() {
            this.obj = rand(COUNT_OBJS)
            return `${digit(n)}<span class="group g${n} spot-group">${appearing(Array(n).fill(this.obj.e), 1.1, 0.6)}</span>`
        },
        say() { return `Le ${WORDS[n]}. ${counting(n)} : ${qty(n, this.obj)} !` }
    }))
}

const UNIVERSES = [
    {
        id: 'couleurs', name: 'Les couleurs', color: 'var(--tint)',
        art: `<span class="art-colors">${BASE_COLORS.map((c) => `<i style="background:${c.hex}"></i>`).join('')}</span>`
    },
    {
        id: 'formes', name: 'Les formes', color: 'var(--tint)',
        art: `<span class="art-shapes">${['cercle', 'triangle', 'carre'].map((id) => shapeSvg(id, { fill: SHAPE_FILL })).join('')}</span>`
    },
    { id: 'animaux', name: 'Les animaux', color: 'var(--tint)', art: '<span class="art-animals"><i>🐶</i><i>🐮</i><i>🐱</i></span>' },
    {
        id: 'chiffres', name: 'Les chiffres', color: 'var(--tint)',
        art: `<span class="art-digits">${[1, 2, 3].map((n) => `<b>${n}</b>`).join('')}</span>`
    }
]
/* =========================================================
   Jeux 4 ans (attendus de moyenne section)
   Document de référence : « Jeux d'apprentissage pour un enfant de 4 ans ».
   Première série, dans l'ordre conseillé : jeux 1, 6, 9 et 11.
   ========================================================= */
const PHRASES4 = {
    trainLook: "Regarde le train. Qu'est-ce qui va dans le dernier wagon ?",
    trainListen: 'Écoute le train qui joue de la musique.',
    trainNext: 'Quel son vient après ?',
    trainDone: 'Le train est complet !',
    listen: 'Écoute bien :',
    drumYourTurn: 'À toi ! Tape sur le tambour.',
    drumAsk: 'Tape sur le tambour pour chaque morceau du mot.',
    yourTurn: 'À toi !',
    houses: 'Dans quelle maison va ce mot ? Compte les morceaux.',
    nameOrder: "Remets les lettres de ton prénom dans l'ordre.",
    nameFirst: 'Touche la première lettre de ton prénom.',
    nameDone: 'Tu as écrit ton prénom :'
}

/* ---------- Jeu 1 : La ferme qui compte (dénombrer jusqu'à 6) ---------- */
const FARM = [
    { e: '🐑', s: 'mouton', p: 'moutons' },
    { e: '🐄', s: 'vache', p: 'vaches', f: true },
    { e: '🐔', s: 'poule', p: 'poules', f: true },
    { e: '🐖', s: 'cochon', p: 'cochons' },
    { e: '🦆', s: 'canard', p: 'canards' },
    { e: '🐎', s: 'cheval', p: 'chevaux' }
]
const countWord = (n) => `${cap(WORDS[n])} !`

// Main dessinée avec n doigts levés (index, majeur, annulaire, auriculaire, puis pouce)
function handSvg(n) {
    const fingers = [[26, 14], [40, 8], [54, 14], [68, 24]].map(([x, top], i) => {
        const up = i < Math.min(n, 4)
        return `<rect x="${x}" y="${up ? top : 42}" width="13" height="${up ? 60 - top : 20}" rx="6.5"/>`
    }).join('')
    const thumbUp = '<rect x="6" y="46" width="13" height="36" rx="6.5" transform="rotate(-35 12 82)"/>'
    const thumbFolded = '<ellipse cx="34" cy="74" rx="13" ry="7"/>'
    return `<svg class="hand" viewBox="0 0 100 112" aria-hidden="true"><g fill="#C4B3FF" stroke="#4F3591" stroke-width="3">
        ${fingers}${n >= 5 ? thumbUp : ''}<rect x="22" y="50" width="62" height="56" rx="20"/>${n < 5 ? thumbFolded : ''}</g></svg>`
}

const FARM_ANSWERS = {
    hand: { html: handSvg, no: (n) => `Non, là, il y a ${n === 1 ? 'un doigt' : `${WORDS[n]} doigts`}.` },
    dice: { html: (n) => `<span class="group g${n} pips">${'<i>●</i>'.repeat(n)}</span>`, no: (n) => `Non, là, il y a ${n === 1 ? 'un point' : `${WORDS[n]} points`}.` },
    digit: { html: digit, no: (n) => thatIs(`le ${WORDS[n]}`) }
}

// Le pré : animaux alignés (niveau 1), en désordre (2), de tailles différentes (3). Chacun se touche pour compter.
function meadow(a, n, layout) {
    const cells = shuffle(range(0, 5))
    const animals = range(0, n - 1).map((i) => {
        let style = ''
        if (layout !== 'line') {
            const col = cells[i] % 3
            const row = Math.floor(cells[i] / 3)
            const size = layout === 'sizes' ? rand([0.65, 0.85, 1, 1.2]) : 1
            style = ` style="left:${(col * 33 + 3 + Math.random() * 8).toFixed(1)}%;top:${(row * 50 + 3 + Math.random() * 12).toFixed(1)}%;font-size:${size}em"`
        }
        return `<button class="farm-animal" data-act="count"${style} aria-label="${a.s}">${a.e}</button>`
    }).join('')
    return `<div class="meadow meadow-${layout}">${animals}</div>`
}

function farmQuestion(max, layout, kind) {
    const a = rand(FARM)
    const t = 1 + Math.floor(Math.random() * max)
    const options = [t, ...sample(range(1, max).filter((n) => n !== t), 2)]
    const ans = FARM_ANSWERS[kind]
    return question([`Touche chaque ${a.s} pour les compter.`, `Combien y a-t-il ${de(a.p)} ?`], meadow(a, t, layout),
        options.map((n) => ({ kind: kind === 'hand' ? 'hand' : 'card', html: ans.html(n), label: String(n), correct: n === t, no: ans.no(n) })),
        `${counting(t)} : ${qty(t, a)} !`, `${a.e}${t}`)
}

/* ---------- Jeu 6 : Le train des motifs (prolonger un motif) ---------- */
const SOUND_ITEMS = [
    { html: '🥁', name: 'le tambour', sfx: 'drum' },
    { html: '🔔', name: 'la cloche', sfx: 'bell' },
    { html: '🎺', name: 'la trompette', sfx: 'trumpet' }
]
const TRAIN_SETS = {
    colors: () => COLORS.slice(0, 5).map((c) => ({ html: `<span class="dot-color" style="background:${c.hex}"></span>`, name: theColor(c), key: c.id })),
    shapes: () => ALL_SHAPES.map((id) => ({ html: shapeSvg(id, { fill: SHAPE_FILL }), name: SHAPES[id].name, key: id })),
    animals: () => ANIMALS.map((a) => ({ html: emo(a.e), name: a.name, key: a.snd })),
    sounds: () => SOUND_ITEMS.map((x) => ({ ...x, key: x.sfx }))
}
const PATTERNS = { AB: [0, 1], ABB: [0, 1, 1], ABC: [0, 1, 2], AAB: [0, 0, 1] }

function trainQuestion(setNames, patternNames) {
    const setName = rand(setNames)
    const patternName = rand(patternNames)
    const pattern = PATTERNS[patternName]
    // 3 éléments : ceux du motif, plus un intrus pour les motifs à 2 éléments
    const used = sample(TRAIN_SETS[setName](), 3)
    const seq = range(0, 5).map((i) => used[pattern[i % pattern.length]])
    const answer = seq[5]
    const shown = seq.slice(0, 5)
    const sounds = setName === 'sounds'
    const visual = `<div class="train"><span class="loco">🚂</span>${shown.map((w) => `<span class="wagon">${w.html}</span>`).join('')}<span class="wagon empty">?</span></div>`
    const say = sounds
        ? [PHRASES4.trainListen, ...shown.map((w) => ({ sfx: w.sfx })), PHRASES4.trainNext]
        : PHRASES4.trainLook
    return question(say, visual,
        used.map((w) => ({ kind: 'card', html: w.html, label: w.name, correct: w === answer, no: thatIs(w.name) })),
        sounds ? [`C'est ${answer.name} !`, { sfx: answer.sfx }] : [`C'est ${answer.name} !`, PHRASES4.trainDone],
        `${patternName}${answer.key}`)
}

/* ---------- Jeu 9 : Le tambour des syllabes ---------- */
// s : les morceaux du mot tels que la voix les dit (écrits pour être bien lus, pas pour l'orthographe)
const SYLLABLE_WORDS = [
    { e: '🐱', w: 'chat', s: ['chat'] },
    { e: '🐶', w: 'chien', s: ['chien'] },
    { e: '🍞', w: 'pain', s: ['pain'] },
    { e: '🚌', w: 'bus', s: ['busse'] },
    { e: '🐻', w: 'ours', s: ['ourse'] },
    { e: '🚆', w: 'train', s: ['train'] },
    { e: '🐰', w: 'lapin', s: ['la', 'pin'] },
    { e: '🐟', w: 'poisson', s: ['poi', 'sson'] },
    { e: '🐑', w: 'mouton', s: ['mou', 'ton'] },
    { e: '🎈', w: 'ballon', s: ['ba', 'lon'] },
    { e: '⛵', w: 'bateau', s: ['ba', 'teau'] },
    { e: '🚲', w: 'vélo', s: ['vé', 'lo'] },
    { e: '🤖', w: 'robot', s: ['ro', 'bo'] },
    { e: '🍬', w: 'bonbon', s: ['bon', 'bon'] },
    { e: '🦋', w: 'papillon', s: ['pa', 'pi', 'yon'] },
    { e: '🐘', w: 'éléphant', s: ['é', 'lé', 'fan'] },
    { e: '🦘', w: 'kangourou', s: ['kan', 'gou', 'rou'] },
    { e: '🍫', w: 'chocolat', s: ['cho', 'co', 'la'] },
    { e: '🍍', w: 'ananas', s: ['a', 'na', 'nasse'] },
    { e: '🐌', w: 'escargot', s: ['es', 'car', 'go'] }
]
const scanned = (x) => `${cap(x.s.join('… '))}.`
const wordLine = (x) => `${cap(x.w)}.`
const strokes = (n) => (n === 1 ? 'Un seul coup !' : `${cap(WORDS[n])} coups !`)
const tapped = (k) => (k > 6 ? 'Tu as tapé trop de fois.' : `Tu as tapé ${k === 1 ? 'une' : WORDS[k]} fois.`)

// Niveaux 1 et 2 : l'enfant tape le tambour une fois par morceau ; la réponse est vérifiée quand il s'arrête
function drumQuestion(maxSyllables, withModel) {
    const x = rand(SYLLABLE_WORDS.filter((y) => y.s.length <= maxSyllables))
    const n = x.s.length
    return {
        mode: 'drum',
        target: n,
        say: withModel ? [wordLine(x), PHRASES4.listen, scanned(x), { drum: n }, PHRASES4.drumYourTurn] : [wordLine(x), PHRASES4.drumAsk],
        visual: emo(x.e),
        choices: [],
        praise: [scanned(x), strokes(n)],
        // Après une erreur : ce qu'il a tapé, puis le modèle
        noFor: (k) => [tapped(k), PHRASES4.listen, scanned(x), { drum: n }, PHRASES4.yourTurn],
        key: x.w
    }
}

// Niveau 3 : ranger le mot dans la maison qui a le bon nombre de morceaux (maisons dans l'ordre 1, 2, 3)
const houseSvg = (n) => `<span class="house"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M8 50 50 12l42 38v42H8z"/></svg><span class="house-dots">${'●'.repeat(n)}</span></span>`
const houseName = (n) => `la maison ${n === 1 ? 'à un coup' : `à ${WORDS[n]} coups`}`
function housesQuestion() {
    const x = rand(SYLLABLE_WORDS)
    const n = x.s.length
    return {
        say: [wordLine(x), PHRASES4.houses],
        visual: emo(x.e),
        choices: [1, 2, 3].map((k) => ({ kind: 'card', html: houseSvg(k), label: houseName(k), correct: k === n, no: thatIs(houseName(k)) })),
        praise: [scanned(x), strokes(n)],
        key: `h${x.w}`
    }
}

/* ---------- Jeu 11 : Les lettres de mon prénom ---------- */
// Nom des lettres, écrit pour être bien prononcé par la voix
const LETTER_SAY = {
    A: 'a', B: 'bé', C: 'cé', D: 'dé', E: 'eu', F: 'èfe', G: 'gé', H: 'ache', I: 'i', J: 'ji', K: 'ka', L: 'èle', M: 'ème',
    N: 'ène', O: 'o', P: 'pé', Q: 'ku', R: 'ère', S: 'èsse', T: 'té', U: 'u', V: 'vé', W: 'double vé', X: 'iks', Y: 'i grec', Z: 'zède',
    É: 'é', È: 'è', Ê: 'è', Ë: 'e tréma', À: 'a', Â: 'a', Ç: 'cé cédille', Î: 'i', Ï: 'i tréma', Ô: 'o', Ù: 'u', Û: 'u', Ü: 'u tréma'
}
const letterLine = (L) => `${cap(LETTER_SAY[L])} !`
const lookFor = (L) => `Cherche le ${LETTER_SAY[L]}.`
const kidLetters = () => {
    const letters = [...(Store.profile?.name || 'Léo').toUpperCase()].filter((ch) => LETTER_SAY[ch])
    return letters.length ? letters : ['L', 'É', 'O']
}

// Niveaux 1 (avec le modèle affiché) et 3 (sans modèle) : toucher les lettres dans l'ordre
function nameQuestion(withModel) {
    const letters = kidLetters()
    const model = withModel ? `<div class="name-model">${letters.map((l) => `<span>${l}</span>`).join('')}</div>` : ''
    return {
        mode: 'letters',
        letters,
        tolerance: 1, // une erreur sur tout un prénom compte encore comme réussi
        say: PHRASES4.nameOrder,
        visual: `<div class="name-board">${model}<div class="name-slots">${letters.map(() => '<span class="slot-letter"></span>').join('')}</div></div>`,
        choices: shuffle(letters).map((L) => ({ letter: L })),
        praise: [PHRASES4.nameDone, NAME],
        key: `n${Math.random()}`
    }
}

// Niveau 2 : retrouver la première lettre de son prénom parmi 3
function firstLetterQuestion() {
    const first = kidLetters()[0]
    const others = sample(Object.keys(LETTER_SAY).filter((l) => /^[A-Z]$/.test(l) && l !== first), 2)
    return question(PHRASES4.nameFirst, null,
        [first, ...others].map((L) => ({ kind: 'card', html: `<span class="big-letter">${L}</span>`, label: L, correct: L === first, no: thatIs(`le ${LETTER_SAY[L]}`) })),
        [`C'est le ${LETTER_SAY[first]}, comme`, NAME], `f${Math.random()}`)
}

Object.assign(GEN, {
    ferme: { 1: () => farmQuestion(3, 'line', 'hand'), 2: () => farmQuestion(5, 'scatter', 'dice'), 3: () => farmQuestion(6, 'sizes', 'digit') },
    train: { 1: () => trainQuestion(['colors'], ['AB']), 2: () => trainQuestion(['shapes', 'animals'], ['ABB', 'ABC']), 3: () => trainQuestion(['sounds'], ['AB', 'ABB', 'AAB']) },
    tambour: { 1: () => drumQuestion(2, true), 2: () => drumQuestion(3, false), 3: housesQuestion },
    prenom: { 1: () => nameQuestion(true), 2: firstLetterQuestion, 3: () => nameQuestion(false) }
})

// goal : bonnes réponses pour finir un niveau (un prénom entier compte pour une réponse)
const UNIVERSES_4 = [
    { id: 'ferme', name: 'La ferme qui compte', color: 'var(--tint)', art: '<span class="art-animals"><i>🐑</i><i>🐄</i><i>🐔</i></span>' },
    { id: 'train', name: 'Le train des motifs', color: 'var(--tint)', art: `<span class="art-train"><i>🚂</i>${['#E53935', '#1E88E5', '#E53935'].map((c) => `<b style="background:${c}"></b>`).join('')}</span>` },
    { id: 'tambour', name: 'Le tambour des syllabes', color: 'var(--tint)', art: '<span class="art-animals"><i>🐰</i><i>🥁</i><i>🦋</i></span>' },
    { id: 'prenom', name: 'Les lettres de mon prénom', color: 'var(--tint)', goal: 3, art: '<span class="art-letters"><b>A</b><b>B</b><b>C</b></span>' }
]
/* =========================================================
   Jeux 5 ans (attendus de grande section)
   Nombres jusqu'à 10, suite des nombres, sons des mots, lettres.
   ========================================================= */

/* ---------- La boîte à dix (quantités jusqu'à 10, compléments, composer) ---------- */
// Boîte de 10 cases (2 rangées de 5), n jetons
const tenFrame = (n) => `<div class="tenframe">${range(1, 10).map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</div>`
// 3 réponses : la bonne et deux voisines, entre 1 et 10
const nearOptions = (t, min = 1, max = 10) => [t, ...sample(range(min, max).filter((n) => n !== t && Math.abs(n - t) <= 3), 2)]
const digitChoices = (opts, t) => opts.map((n) => card(digit(n), String(n), n === t, thatIs(`le ${WORDS[n]}`)))

function tenCountQuestion() {
    const t = 4 + Math.floor(Math.random() * 7)
    return question('Combien y a-t-il de jetons dans la boîte ?', tenFrame(t), digitChoices(nearOptions(t), t),
        `Il y a ${WORDS[t]} jetons !`, `c${t}`)
}

function tenMissingQuestion() {
    const n = 3 + Math.floor(Math.random() * 7)
    const t = 10 - n
    return question('Combien de jetons manque-t-il pour remplir la boîte ?', tenFrame(n), digitChoices(nearOptions(t, 1, 9), t),
        `${cap(WORDS[n])} et ${WORDS[t]}, ça fait dix !`, `m${n}`)
}

function tenSumQuestion() {
    const o = rand(COUNT_OBJS)
    const a = 1 + Math.floor(Math.random() * 5)
    const b = 1 + Math.floor(Math.random() * Math.min(5, 10 - a))
    const t = a + b
    return question([`${cap(qty(a, o))}, et encore ${qty(b, o)}.`, 'Combien en tout ?'],
        `<div class="sum-pair">${group(a, o.e)}<span class="sum-and">et</span>${group(b, o.e)}</div>`,
        digitChoices(nearOptions(t, 2, 10), t), `${cap(WORDS[a])} et ${WORDS[b]}, ça fait ${WORDS[t]} !`, `s${a}${b}${o.e}`)
}

/* ---------- Avant, après (suite des nombres jusqu'à 10) ---------- */
// Réponses proposées : la bonne et les deux nombres les plus proches qui ne sont pas déjà dans la file
const trackChoices = (t, visible) => {
    const near = shuffle(range(1, 10).filter((x) => x !== t && !visible.includes(x)))
        .sort((a, b) => Math.abs(a - t) - Math.abs(b - t))
    return digitChoices([t, ...near.slice(0, 2)], t)
}
const numberTrack = (cells) => `<div class="track">${cells.map((x) => (x == null ? '<span class="cell q">?</span>' : `<span class="cell">${x}</span>`)).join('')}</div>`

function afterQuestion() {
    const n = 1 + Math.floor(Math.random() * 9)
    const t = n + 1
    const cells = [...(n > 1 ? [n - 1] : []), n, null]
    return question(`Quel nombre vient juste après le ${WORDS[n]} ?`, numberTrack(cells), trackChoices(t, cells),
        `Après ${WORDS[n]}, il y a ${WORDS[t]} !`, `a${n}`)
}

function beforeQuestion() {
    const n = 2 + Math.floor(Math.random() * 9)
    const t = n - 1
    const cells = [null, n, ...(n < 10 ? [n + 1] : [])]
    return question(`Quel nombre vient juste avant le ${WORDS[n]} ?`, numberTrack(cells), trackChoices(t, cells),
        `Avant ${WORDS[n]}, il y a ${WORDS[t]} !`, `b${n}`)
}

function missingInTrackQuestion() {
    const start = 1 + Math.floor(Math.random() * 6)
    const seq = range(start, start + 4)
    const hole = 1 + Math.floor(Math.random() * 3)
    const t = seq[hole]
    const cells = seq.map((x, i) => (i === hole ? null : x))
    return question('Quel nombre manque dans la file ?', numberTrack(cells), trackChoices(t, cells), `${cap(seq.map((x) => WORDS[x]).join(', '))} !`, `t${start}${hole}`)
}

/* ---------- Les sons des mots (rimes, début des mots, intrus) ---------- */
// end : le son de la fin (pour les rimes) ; start : le début du mot, tel que la voix le dit
const SOUND_WORDS = [
    { e: '🐱', w: 'le chat', end: 'a', start: 'cha' },
    { e: '🐀', w: 'le rat', end: 'a' },
    { e: '🍫', w: 'le chocolat', end: 'a' },
    { e: '🐰', w: 'le lapin', end: 'in' },
    { e: '🌲', w: 'le sapin', end: 'in' },
    { e: '🍞', w: 'le pain', end: 'in' },
    { e: '⛵', w: 'le bateau', end: 'o', start: 'ba' },
    { e: '🎂', w: 'le gâteau', end: 'o' },
    { e: '🚲', w: 'le vélo', end: 'o' },
    { e: '🐑', w: 'le mouton', end: 'on' },
    { e: '🎈', w: 'le ballon', end: 'on', start: 'ba' },
    { e: '🐟', w: 'le poisson', end: 'on' },
    { e: '🐭', w: 'la souris', end: 'i' },
    { e: '🍚', w: 'le riz', end: 'i' },
    { e: '🛏️', w: 'le lit', end: 'i' },
    { e: '🍌', w: 'la banane', start: 'ba' },
    { e: '🦆', w: 'le canard', start: 'ca' },
    { e: '🚚', w: 'le camion', start: 'ca' },
    { e: '🎁', w: 'le cadeau', start: 'ca' },
    { e: '🎩', w: 'le chapeau', start: 'cha' },
    { e: '🏰', w: 'le château', start: 'cha' },
    { e: '🦋', w: 'le papillon', start: 'pa' },
    { e: '🐼', w: 'le panda', start: 'pa' },
    { e: '☂️', w: 'le parapluie', start: 'pa' },
    { e: '🏠', w: 'la maison', start: 'ma' },
    { e: '🧥', w: 'le manteau', start: 'ma' },
    { e: '🔨', w: 'le marteau', start: 'ma' }
]
// La voix nomme les images de gauche à droite : « le rat, la lune, ou le vélo ? »
const nameList = (items) => items.map((x, i) => (i === items.length - 1 ? `ou ${x.w} ?` : `${x.w},`))
const picChoice = (x, correct, no) => ({ kind: 'card', html: emo(x.e), label: x.w, correct, no })

function rhymeQuestion() {
    const rhyming = SOUND_WORDS.filter((x) => x.end)
    const t = rand(rhyming)
    const match = rand(rhyming.filter((x) => x.end === t.end && x !== t))
    const others = sample(rhyming.filter((x) => x.end !== t.end), 2)
    const shown = shuffle([match, ...others])
    return {
        say: [`Quel mot rime avec ${t.w} ?`, ...nameList(shown)],
        visual: emo(t.e),
        choices: shown.map((x) => picChoice(x, x === match, `Non, ${x.w}, ça ne rime pas avec ${t.w}.`)),
        praise: `${cap(t.w)}, ${match.w} : ça rime !`,
        key: t.w
    }
}

function startQuestion() {
    const starting = SOUND_WORDS.filter((x) => x.start)
    const t = rand(starting)
    const match = rand(starting.filter((x) => x.start === t.start && x !== t))
    const others = sample(starting.filter((x) => x.start !== t.start), 2)
    const shown = shuffle([match, ...others])
    return {
        say: [`Quel mot commence comme ${t.w} ?`, ...nameList(shown)],
        visual: emo(t.e),
        choices: shown.map((x) => picChoice(x, x === match, `Non, ${x.w}, ça commence par ${x.start}.`)),
        praise: `${cap(t.w)}, ${match.w} : ça commence par ${t.start} !`,
        key: t.w
    }
}

function oddOneQuestion() {
    const ends = [...new Set(SOUND_WORDS.filter((x) => x.end).map((x) => x.end))]
        .filter((e) => SOUND_WORDS.filter((x) => x.end === e).length >= 3)
    const end = rand(ends)
    const group3 = sample(SOUND_WORDS.filter((x) => x.end === end), 3)
    const odd = rand(SOUND_WORDS.filter((x) => x.end && x.end !== end))
    const shown = shuffle([...group3, odd])
    return {
        say: ['Trois mots riment ensemble. Trouve celui qui ne rime pas !', ...nameList(shown)],
        visual: null,
        choices: shown.map((x) => picChoice(x, x === odd, `Non, ${x.w} rime avec ${group3.find((y) => y !== x).w}.`)),
        praise: `${cap(odd.w)} ne rime pas avec les autres !`,
        key: `o${odd.w}`
    }
}

/* ---------- Les lettres (nommer, grande et petite lettre, première lettre d'un mot) ---------- */
const CAPITALS = Object.keys(LETTER_SAY).filter((l) => /^[A-Z]$/.test(l))
const letterChoice = (L, correct, small = false) => ({
    kind: 'card',
    html: `<span class="big-letter${small ? ' small-letter' : ''}">${small ? L.toLowerCase() : L}</span>`,
    label: L,
    correct,
    no: thatIs(`le ${small ? 'petit ' : ''}${LETTER_SAY[L]}`)
})

function touchLetterQuestion() {
    const [t, ...others] = sample(CAPITALS, 3)
    return question(`Touche le ${LETTER_SAY[t]}.`, null, [t, ...others].map((L) => letterChoice(L, L === t)),
        `C'est le ${LETTER_SAY[t]} !`, t)
}

function smallLetterQuestion() {
    const t = rand(CAPITALS)
    // b, d, p et q se ressemblent : on les met ensemble pour apprendre à les distinguer
    const pool = 'BDPQ'.includes(t) ? [...'BDPQ'] : CAPITALS
    const others = sample(pool.filter((l) => l !== t), 2)
    return question(`Voici le ${LETTER_SAY[t]} en grande lettre. Trouve le même en petite lettre.`,
        `<span class="big-letter">${t}</span>`, [t, ...others].map((L) => letterChoice(L, L === t, true)),
        `C'est le petit ${LETTER_SAY[t]} !`, `p${t}`)
}

// Mots qui commencent par la lettre qu'on entend
const FIRST_LETTER_WORDS = [
    { e: '🐰', w: 'lapin' }, { e: '🐑', w: 'mouton' }, { e: '🎈', w: 'ballon' }, { e: '🤖', w: 'robot' },
    { e: '🌲', w: 'sapin' }, { e: '🐢', w: 'tortue' }, { e: '🚲', w: 'vélo' }, { e: '🚀', w: 'fusée' },
    { e: '🍎', w: 'pomme' }, { e: '🦕', w: 'dinosaure' }, { e: '☁️', w: 'nuage' }, { e: '🐨', w: 'koala' },
    { e: '🍍', w: 'ananas' }, { e: '🦒', w: 'girafe' }
]
function firstLetterOfWordQuestion() {
    const x = rand(FIRST_LETTER_WORDS)
    const word = x.w.toUpperCase()
    const t = word.normalize('NFD')[0]
    const others = sample(CAPITALS.filter((l) => l !== t), 2)
    return question(`Par quelle lettre commence le mot ${x.w} ?`,
        `<div class="word-pic">${emo(x.e)}<span class="word-hint"><b>?</b>${word.slice(1)}</span></div>`,
        [t, ...others].map((L) => letterChoice(L, L === t)), `${cap(x.w)} commence par le ${LETTER_SAY[t]} !`, x.w)
}

Object.assign(GEN, {
    dix: { 1: tenCountQuestion, 2: tenMissingQuestion, 3: tenSumQuestion },
    suite: { 1: afterQuestion, 2: beforeQuestion, 3: missingInTrackQuestion },
    sons: { 1: rhymeQuestion, 2: startQuestion, 3: oddOneQuestion },
    lettres: { 1: touchLetterQuestion, 2: smallLetterQuestion, 3: firstLetterOfWordQuestion }
})

const UNIVERSES_5 = [
    { id: 'dix', name: 'La boîte à dix', color: 'var(--tint)', art: '<span class="art-ten">' + tenFrame(7) + '</span>' },
    { id: 'suite', name: 'Avant, après', color: 'var(--tint)', art: '<span class="art-digits"><b>4</b><b>5</b><b>?</b></span>' },
    { id: 'sons', name: 'Les sons des mots', color: 'var(--tint)', art: '<span class="art-animals"><i>🐱</i><i>🎵</i><i>🐀</i></span>' },
    { id: 'lettres', name: 'Les lettres', color: 'var(--tint)', art: '<span class="art-letters"><b>A</b><b>a</b><b>B</b></span>' }
]

const universesFor = (p) => (p?.age === 5 ? UNIVERSES_5 : p?.age === 4 ? UNIVERSES_4 : UNIVERSES)
const UNI = Object.fromEntries([...UNIVERSES, ...UNIVERSES_4, ...UNIVERSES_5].map((u) => [u.id, u]))
const goalOf = (uid) => UNI[uid].goal || STREAK_GOAL

// Phrases dites hors des questions tirées au hasard : outils/generer-voix.mjs les enregistre aussi
function extraPhrases() {
    return [
        ...Object.values(PHRASES4),
        ...[...UNIVERSES, ...UNIVERSES_4, ...UNIVERSES_5].map((u) => `${u.name} !`),
        ...range(1, 6).map(countWord),
        ...range(1, 9).map(tapped),
        ...SYLLABLE_WORDS.flatMap((x) => [wordLine(x), scanned(x), strokes(x.s.length)]),
        ...Object.keys(LETTER_SAY).flatMap((L) => [letterLine(L), lookFor(L), thatIs(`le ${LETTER_SAY[L]}`), `C'est le ${LETTER_SAY[L]}, comme`])
    ]
}

/* =========================================================
   Icônes de l'interface (dessinées, couleur du texte : violet par défaut)
   Les emoji restent réservés aux contenus (animaux, objets, autocollants).
   ========================================================= */
const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h5v-6h3v6h5V10"/>',
    back: '<path d="M19 12H5.5"/><path d="M11.5 5 4.5 12l7 7"/>',
    sound: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4z" fill="currentColor"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="m12 6.5 1.1 2.3 2.5.4-1.8 1.7.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.7 2.5-.4z" fill="currentColor" stroke-width="1"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    eye: '<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    next: '<path d="M4.5 12h14"/><path d="M12.5 5.5 19 12l-6.5 6.5"/>'
}
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`

/* =========================================================
   Le personnage qui parle à l'enfant
   ========================================================= */
// Petite créature violette à antenne : ni animal, ni forme, ni couleur à apprendre, pour ne pas se confondre
// avec les contenus. Elle cligne des yeux ; dans un .talk, sa bouche bouge et son antenne s'agite.
const mascotSvg = () => `
    <svg class="mascot-svg" viewBox="0 0 200 220" aria-hidden="true">
        <defs>
            <linearGradient id="m-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#9D7BFF"/>
                <stop offset="1" stop-color="#6C4AB6"/>
            </linearGradient>
        </defs>
        <ellipse cx="100" cy="210" rx="56" ry="8" fill="rgba(58,46,57,.14)"/>
        <g class="m-antenna">
            <path d="M100 42 Q96 26 104 14" stroke="#5A3E9E" stroke-width="6" fill="none" stroke-linecap="round"/>
            <circle cx="104" cy="12" r="11" fill="#FFD23F"/>
            <circle cx="100" cy="8" r="3.5" fill="#FFF3B8"/>
        </g>
        <ellipse cx="74" cy="199" rx="20" ry="11" fill="#5A3E9E"/>
        <ellipse cx="126" cy="199" rx="20" ry="11" fill="#5A3E9E"/>
        <g class="m-arm m-arm-left"><ellipse cx="18" cy="134" rx="11" ry="22" fill="#7B5BD6" transform="rotate(28 18 134)"/></g>
        <g class="m-arm m-arm-right"><ellipse cx="182" cy="134" rx="11" ry="22" fill="#7B5BD6" transform="rotate(-28 182 134)"/></g>
        <path d="M100 38C152 38 180 80 180 130C180 178 148 202 100 202C52 202 20 178 20 130C20 80 48 38 100 38Z" fill="url(#m-body)"/>
        <ellipse cx="100" cy="166" rx="48" ry="28" fill="#C4B3FF" opacity=".55"/>
        <g class="m-eyes">
            <ellipse cx="74" cy="108" rx="22" ry="26" fill="#fff"/>
            <ellipse cx="126" cy="108" rx="22" ry="26" fill="#fff"/>
            <circle cx="78" cy="113" r="12" fill="#2A1E3B"/>
            <circle cx="122" cy="113" r="12" fill="#2A1E3B"/>
            <circle cx="82" cy="107" r="4.5" fill="#fff"/>
            <circle cx="126" cy="107" r="4.5" fill="#fff"/>
        </g>
        <ellipse cx="52" cy="142" rx="12" ry="7" fill="#FF8FB1" opacity=".75"/>
        <ellipse cx="148" cy="142" rx="12" ry="7" fill="#FF8FB1" opacity=".75"/>
        <path class="m-mouth-closed" d="M84 144Q100 158 116 144" stroke="#2A1E3B" stroke-width="5" fill="none" stroke-linecap="round"/>
        <g class="m-mouth-open">
            <path d="M82 142Q100 176 118 142Z" fill="#2A1E3B"/>
            <ellipse cx="100" cy="158" rx="9" ry="5" fill="#FF6F91"/>
        </g>
    </svg>`

/* =========================================================
   Écrans
   ========================================================= */
const app = $('#app')
const layer = $('#layer')
let game = null
let gameToken = 0
let timeUp = false
let parentOpen = false

function show(html, cls, onAct) {
    app.innerHTML = `<div class="screen ${cls}">${html}</div>`
    const el = app.firstElementChild
    if (onAct) {
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]')
            if (b && !b.disabled) onAct(b.dataset.act, b)
        })
    }
    return el
}

function openLayer(html, cls, onAct) {
    layer.innerHTML = `<div class="overlay ${cls}">${html}</div>`
    const el = layer.firstElementChild
    if (onAct) {
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]')
            if (b) onAct(b.dataset.act, b)
        })
    }
    return el
}

function closeLayer() {
    layer.innerHTML = ''
}

function stopGame() {
    game = null
    gameToken++
    // Changer d'écran coupe la phrase ou le cri en cours
    Voice.stopAll()
}

/* ---------- Premier lancement / ajout d'un enfant ---------- */
function profileForm(submitLabel) {
    return `
        <form class="profile-form">
            <label class="field">Prénom de l'enfant
                <input name="name" maxlength="20" autocomplete="off" required placeholder="Ex. : Léo">
            </label>
            <fieldset class="ages">
                <legend>Son âge</legend>
                ${[3, 4, 5].map((a, i) => `<label><input type="radio" name="age" value="${a}"${i === 0 ? ' checked' : ''}><span>${a} ans</span></label>`).join('')}
                <p class="muted">Les jeux proposés s'adaptent à l'âge. Vous pourrez le changer plus tard.</p>
            </fieldset>
            <fieldset class="avatars">
                <legend>Son personnage</legend>
                ${AVATARS.map((a, i) => `<label><input type="radio" name="avatar" value="${a}"${i === 0 ? ' checked' : ''}><span>${a}</span></label>`).join('')}
            </fieldset>
            <button class="btn primary" type="submit">${submitLabel}</button>
        </form>`
}

function bindProfileForm(root, onDone) {
    const form = $('.profile-form', root)
    form.addEventListener('submit', (e) => {
        e.preventDefault()
        const name = form.name.value.trim()
        if (!name) return form.name.focus()
        Store.addProfile(name, form.avatar.value, +form.age.value)
        onDone()
    })
}

function renderSetup() {
    stopGame()
    const el = show(`
        <div class="panel setup-panel">
            <div class="setup-hero">${mascotSvg()}</div>
            <h1>Bienvenue dans P'tit Malin</h1>
            <p>Cette application aide votre enfant à apprendre en jouant, avec des jeux adaptés à son âge (3, 4 ou 5 ans) : couleurs, formes, animaux, nombres, motifs, sons et lettres.
            Tout se fait à la voix et en images : il n'a pas besoin de savoir lire.</p>
            <p class="muted">Les données restent sur cet appareil. Pas de compte, pas de publicité, pas d'achat.</p>
            ${profileForm("C'est parti !")}
        </div>`, 'setup')
    bindProfileForm(el, () => {
        Timer.reset()
        renderHome(true)
    })
}

/* ---------- Accueil ---------- */
function renderHome(greet = false) {
    stopGame()
    const p = Store.profile
    const tiles = universesFor(p).map((u) => {
        const done = p.progress[u.id] || 0
        const stars = [1, 2, 3].map((i) => `<span class="star${i <= done ? ' on' : ''}">★</span>`).join('')
        return `<button class="tile" data-act="u" data-u="${u.id}" style="--tile:${u.color}" aria-label="${u.name}, ${done} niveau${done > 1 ? 'x' : ''} sur 3">
                    <span class="tile-art">${u.art}</span><span class="stars">${stars}</span>
                </button>`
    }).join('')
    show(`
        <header class="bar">
            <button class="kid" data-act="kids" aria-label="Mes enfants (parents)"><span class="kid-avatar">${p.avatar}</span><span class="kid-name">${esc(p.name)}</span></button>
            <button class="btn-round" data-act="stickers" aria-label="Mes autocollants">${icon('book')}<span class="badge">${p.stickers.length}</span></button>
            <button class="btn-round btn-parent" data-act="parent" aria-label="Espace parents">${icon('gear')}</button>
        </header>
        <main class="tiles">${tiles}</main>`, 'home', (act, b) => {
        Sfx.tap()
        if (act === 'u') renderLevels(b.dataset.u)
        else if (act === 'stickers') renderStickers()
        else if (act === 'parent') openParentGate()
        else if (act === 'kids') openParentGate(renderChildren)
    })
    if (greet) Talk.run([PHRASES.hello, NAME, PHRASES.whatToPlay])
}

/* ---------- Choix du niveau ---------- */
function renderLevels(uid) {
    stopGame()
    const u = UNI[uid]
    const done = Store.profile.progress[uid] || 0
    const levels = [1, 2, 3].map((n) => {
        const locked = n > done + 1
        const ok = n <= done
        return `<button class="level${locked ? ' locked' : ''}${ok ? ' done' : ''}" data-act="lvl" data-n="${n}" style="--tile:${u.color}" aria-label="Niveau ${n}${locked ? ', verrouillé' : ok ? ', réussi' : ''}">
                    <span class="level-dots">${'●'.repeat(n)}</span>
                    <span class="level-state">${icon(locked ? 'lock' : ok ? 'star' : 'play', ok ? 'gold' : '')}</span>
                </button>`
    }).join('')
    const discover = DISCOVER[uid] ? `<button class="level discover" data-act="discover" style="--tile:${u.color}" aria-label="Découvrir">
                          <span class="level-state">${icon('eye')}</span>
                      </button>` : ''
    show(`
        <header class="bar">
            <button class="btn-round" data-act="home" aria-label="Accueil">${icon('home')}</button>
            <div class="bar-title" style="--tile:${u.color}">${u.art}</div>
            <span class="bar-spacer"></span>
        </header>
        <main class="levels">${discover}${levels}</main>`, 'levels', (act, b) => {
        Sfx.tap()
        if (act === 'home') renderHome()
        else if (act === 'discover') renderDiscover(uid)
        else if (act === 'lvl') {
            if (b.classList.contains('locked')) {
                b.classList.remove('wiggle')
                void b.offsetWidth
                b.classList.add('wiggle')
                Voice.say(PHRASES.locked)
            } else {
                startGame(uid, +b.dataset.n)
            }
        }
    })
    Voice.say(`${u.name} !`)
}

/* ---------- Découvrir ---------- */
function renderDiscover(uid) {
    stopGame()
    const u = UNI[uid]
    const items = DISCOVER[uid]
    const el = show(`
        <header class="bar">
            <button class="btn-round" data-act="back" aria-label="Retour aux niveaux">${icon('back')}</button>
            <div class="bar-title">${icon('eye')}</div>
            <span class="bar-spacer"></span>
        </header>
        <main class="discover-spot">
            <button class="mascot pop-in" data-act="hello" aria-label="Écouter la consigne">${mascotSvg()}</button>
        </main>
        <div class="discover-items">
            ${items.map((it, i) => `<button class="choice choice-${it.kind} pop-in" style="animation-delay:${i * 50}ms" data-act="item" data-i="${i}" aria-label="${esc(it.label)}">${it.html}</button>`).join('')}
        </div>`, `discover-screen game-${uid}`, (act, b) => {
        if (act === 'back') { Sfx.tap(); renderLevels(uid) }
        else if (act === 'hello') mascotSays(PHRASES.discover)
        else if (act === 'item') {
            const it = items[+b.dataset.i]
            Sfx.tap()
            $$('.discover-items .choice', el).forEach((x) => x.classList.toggle('picked', x === b))
            // Recréer le contenu relance les animations à chaque toucher
            $('.discover-spot', el).innerHTML = `<div class="spot-card pop-in">${it.spot()}</div>`
            Talk.run(it.say())
        }
    })
    el.style.setProperty('--tile', u.color)
    mascotSays(PHRASES.discover)
    // Les explications sont longues : on les prépare dès l'arrivée (sauf les chiffres, dont l'objet est tiré au toucher)
    if (uid !== 'chiffres') Clip.preload(items.map((it) => it.say()))
}

/* ---------- Jeu ---------- */
function startGame(uid, level) {
    stopGame()
    game = { uid, level, streak: 0, attempts: 0, q: null, busy: false, lastKey: null, token: gameToken }
    const u = UNI[uid]
    show(`
        <header class="bar">
            <button class="btn-round" data-act="back" aria-label="Retour aux niveaux">${icon('back')}</button>
            <div class="dots" aria-label="Progression">${'<span class="dot"></span>'.repeat(goalOf(uid))}</div>
            <button class="btn-round" data-act="repeat" aria-label="Réécouter la question">${icon('sound')}</button>
        </header>
        <main class="stage"></main>
        <div class="choices"></div>`, `game game-${uid}`, (act, b) => {
        if (act === 'back') { Sfx.tap(); renderLevels(uid) }
        else if (act === 'repeat') sayPrompt()
        else if (act === 'choice') onChoice(b)
        else if (act === 'count') onCount(b)
        else if (act === 'drum') onDrum(b)
        else if (act === 'letter') onLetter(b)
    }).style.setProperty('--tile', u.color)
    nextQuestion()
}

function nextQuestion() {
    const g = game
    if (!g) return
    let q
    let tries = 0
    do { q = GEN[g.uid][g.level]() } while (q.key === g.lastKey && ++tries < 6)
    clearTimeout(g.tapTimer)
    Object.assign(g, { q, lastKey: q.key, attempts: 0, busy: false, counted: 0, taps: 0, pos: 0 })

    $('.stage').innerHTML = q.visual
        ? `<div class="visual pop-in">${q.visual}</div>`
        : `<button class="mascot pop-in" data-act="repeat" aria-label="Réécouter la question">${mascotSvg()}</button>`
    const box = $('.choices')
    if (q.mode === 'drum') {
        box.className = 'choices drum-zone'
        box.innerHTML = `<button class="drum pop-in" data-act="drum" aria-label="Tambour">${drumSvg()}</button>
            <div class="taps" aria-hidden="true"></div>`
    } else if (q.mode === 'letters') {
        box.className = 'choices letters'
        box.innerHTML = q.choices.map((c, i) =>
            `<button class="choice letter-tile pop-in" style="animation-delay:${80 + i * 50}ms" data-act="letter" data-l="${c.letter}" aria-label="${c.letter}">${c.letter}</button>`
        ).join('')
    } else {
        box.className = `choices n${q.choices.length}`
        box.innerHTML = q.choices.map((c, i) =>
            `<button class="choice choice-${c.kind} pop-in" style="animation-delay:${80 + i * 70}ms" data-act="choice" data-i="${i}" aria-label="${esc(c.label)}">${c.html}</button>`
        ).join('')
    }
    sayPrompt()
    // Pendant que l'enfant réfléchit, on prépare les réponses possibles de la voix
    Clip.preload([q.praise, q.choices.map((c) => c.no || []), PRAISE.map((w) => praise(w, false))])
}

// Le personnage à l'écran (s'il y est) bouge la bouche le temps de la phrase
function mascotSays(parts) {
    const m = $('.mascot')
    m?.classList.add('talk')
    return Talk.run(parts).then(() => m?.classList.remove('talk'))
}

function sayPrompt(prefix = []) {
    if (!game?.q) return
    mascotSays([].concat(prefix, game.q.say))
}

function updateDots() {
    $$('.dot').forEach((d, i) => d.classList.toggle('on', i < game.streak))
}

// Bonne réponse : fête, félicitation, puis question suivante (ou fin du niveau)
async function answerRight(el) {
    const g = game
    g.busy = true
    const token = g.token
    el.classList.add('good')
    $$('.choice').forEach((b) => { if (b !== el) b.classList.add('fade') })
    // Seules les réponses trouvées du premier coup font avancer (un prénom entier tolère une erreur) ; une erreur n'enlève rien.
    if (g.attempts <= (g.q.tolerance || 0)) g.streak++
    updateDots()
    Sfx.good()
    const r = el.getBoundingClientRect()
    Confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 45)
    // Le prénom de temps en temps seulement, pour qu'il garde sa valeur
    const withName = Math.random() < NAME_RATE
    await Promise.all([Talk.run(praise(rand(PRAISE), withName).concat(g.q.praise)), wait(900)])
    if (token !== gameToken) return
    if (g.streak >= goalOf(g.uid)) levelComplete()
    else nextQuestion()
}

function onChoice(btn) {
    const g = game
    if (!g || g.busy) return
    const choice = g.q.choices[+btn.dataset.i]
    if (choice.correct) return answerRight(btn)
    // On nomme ce qu'il a touché, puis ce choix s'en va et la question est reposée
    g.attempts++
    btn.disabled = true
    btn.classList.add('wrong')
    setTimeout(() => btn.classList.replace('wrong', 'gone'), 450)
    Sfx.soft()
    if (g.attempts >= HINT_AFTER) {
        $$('.choice')[g.q.choices.findIndex((c) => c.correct)].classList.add('hint')
    }
    sayPrompt(choice.no)
}

// La ferme : chaque animal touché saute, change de couleur et la voix dit son numéro (on ne compte chacun qu'une fois)
function onCount(btn) {
    const g = game
    if (!g || g.busy) return
    if (btn.classList.contains('counted')) {
        pulse(btn)
        return
    }
    g.counted++
    btn.classList.add('counted')
    btn.dataset.n = g.counted
    pulse(btn)
    Voice.say(countWord(g.counted))
}

// Le tambour : un coup par toucher ; la réponse est vérifiée quand l'enfant s'arrête de taper
function onDrum(btn) {
    const g = game
    if (!g || g.busy) return
    Sfx.drum()
    pulse(btn)
    g.taps++
    renderTaps(g)
    clearTimeout(g.tapTimer)
    const token = g.token
    g.tapTimer = setTimeout(() => {
        if (token !== gameToken || game !== g || g.busy) return
        const k = g.taps
        g.taps = 0
        if (k === g.q.target) return answerRight(btn)
        g.attempts++
        Sfx.soft()
        renderTaps(g)
        mascotSays(g.q.noFor(k))
    }, 1600)
}

// Un rond par coup tapé ; après 2 essais, les ronds à atteindre s'affichent en pointillés
function renderTaps(g) {
    const hint = g.attempts >= HINT_AFTER ? g.q.target : 0
    const total = Math.min(Math.max(g.taps, hint), 9)
    $('.taps').innerHTML = range(1, total).map((i) => `<i${i > g.taps ? ' class="ghost"' : ''}></i>`).join('')
}

// Le prénom : toucher les lettres dans l'ordre ; chaque lettre placée est nommée
async function onLetter(btn) {
    const g = game
    if (!g || g.busy || btn.disabled) return
    const next = g.q.letters[g.pos]
    const L = btn.dataset.l
    if (L !== next) {
        g.attempts++
        btn.classList.add('wrong')
        setTimeout(() => btn.classList.remove('wrong'), 450)
        Sfx.soft()
        if (g.attempts >= HINT_AFTER) {
            $$('.letter-tile').find((b) => !b.disabled && b.dataset.l === next)?.classList.add('hint')
        }
        mascotSays([thatIs(`le ${LETTER_SAY[L]}`), lookFor(next)])
        return
    }
    $$('.letter-tile.hint').forEach((b) => b.classList.remove('hint'))
    btn.disabled = true
    btn.classList.add('placed')
    const slot = $$('.slot-letter')[g.pos]
    slot.textContent = L
    slot.classList.add('filled')
    g.pos++
    Sfx.tap()
    if (g.pos < g.q.letters.length) return Voice.say(letterLine(L))
    g.busy = true
    await Voice.say(letterLine(L))
    if (game === g) answerRight($('.name-slots'))
}

// Tambour dessiné (couleurs de l'appli)
const drumSvg = () => `<svg viewBox="0 0 120 110" aria-hidden="true">
    <path d="M14 36v42c0 12 20.6 22 46 22s46-10 46-22V36" fill="#6C4AB6"/>
    <path d="M14 46c0 12 20.6 22 46 22s46-10 46-22M14 62c0 12 20.6 22 46 22s46-10 46-22" fill="none" stroke="#FFC93C" stroke-width="4"/>
    <ellipse cx="60" cy="36" rx="46" ry="20" fill="#EEE8FB" stroke="#4F3591" stroke-width="5"/>
</svg>`

function levelComplete() {
    const { uid, level } = game
    const p = Store.profile
    stopGame()
    if ((p.progress[uid] || 0) < level) p.progress[uid] = level
    const pool = STICKERS.filter((s) => !p.stickers.includes(s))
    const sticker = pool.length ? rand(pool) : null
    if (sticker) p.stickers.push(sticker)
    Store.save()

    openLayer(`
        <div class="rays" aria-hidden="true"></div>
        <div class="celebrate-body">
            <div class="big-sticker">${sticker || icon('star', 'gold')}</div>
            <div class="celebrate-stars" aria-hidden="true"><span>${icon('star', 'gold')}</span><span>${icon('star', 'gold')}</span><span>${icon('star', 'gold')}</span></div>
            <button class="btn-big next-arrow" data-act="ok" aria-label="Continuer">${icon('next')}</button>
        </div>`, 'celebrate', (act) => {
        if (act !== 'ok') return
        Sfx.tap()
        closeLayer()
        // La flèche mène au niveau suivant ; après le dernier, à la liste des niveaux
        if (level < 3) startGame(uid, level + 1)
        else renderLevels(uid)
    })
    Sfx.fanfare()
    Confetti.rain()
    setTimeout(() => Confetti.burst(innerWidth / 2, innerHeight / 2, 90), 350)
    Talk.run([...praise('Bravo', true), sticker ? PHRASES.newSticker : PHRASES.levelDone, PHRASES.tapArrow])
}

/* ---------- Collection d'autocollants ---------- */
function renderStickers() {
    stopGame()
    const p = Store.profile
    const slots = STICKERS.map((_, i) => {
        const s = p.stickers[i]
        return s ? `<button class="slot" data-act="sticker">${s}</button>` : '<span class="slot empty"></span>'
    }).join('')
    show(`
        <header class="bar">
            <button class="btn-round" data-act="home" aria-label="Accueil">${icon('home')}</button>
            <div class="bar-title">${icon('book')}</div>
            <span class="bar-spacer"></span>
        </header>
        <main class="sticker-grid">${slots}</main>`, 'stickers', (act, b) => {
        if (act === 'home') { Sfx.tap(); renderHome() }
        else if (act === 'sticker') {
            Sfx.good()
            b.classList.remove('wiggle')
            void b.offsetWidth
            b.classList.add('wiggle')
        }
    })
    Voice.say(stickerCount(p.stickers.length))
}

/* ---------- Fin du temps d'écran ---------- */
function showTimeUp(speak = true) {
    timeUp = true
    stopGame()
    closeLayer()
    Store.save()
    const p = Store.profile
    const twinkles = Array.from({ length: 14 }, (_, i) =>
        `<i style="left:${(i * 37) % 100}%;top:${(i * 53) % 70}%;animation-delay:${(i % 5) * 0.4}s"></i>`).join('')
    show(`
        <div class="sky" aria-hidden="true">${twinkles}</div>
        <button class="btn-round btn-parent corner" data-act="parent" aria-label="Espace parents">${icon('gear')}</button>
        <button class="moon-wrap" data-act="moon" aria-label="C'est fini pour aujourd'hui">
            <span class="moon">🌙</span><span class="zzz">💤</span>
        </button>
        <div class="sleepy-kid">${p.avatar}</div>`, 'timeup', (act) => {
        if (act === 'parent') openParentGate()
        else if (act === 'moon') Talk.run([PHRASES.bye, NAME])
    })
    if (speak) Talk.run([PHRASES.timeUp, NAME, PHRASES.wellPlayed])
}

/* ---------- Mes enfants (ajout et choix de l'enfant qui joue) ---------- */
// La confirmation est affichée dans la page : confirm() est bloqué dans certains navigateurs et en appli installée
function renderChildren(confirmId = null) {
    parentOpen = true
    closeLayer()
    const cur = Store.data.currentId
    const kids = Store.data.profiles.map((x) => x.id === confirmId ? `
        <li class="kid-card confirming">
            <p>Supprimer <strong>${esc(x.name)}</strong> et toute sa progression ?</p>
            <div class="row">
                <button class="btn small" data-act="del-no">Annuler</button>
                <button class="btn small danger-strong" data-act="del-yes" data-id="${x.id}">Oui, supprimer</button>
            </div>
        </li>` : `
        <li class="kid-card${x.id === cur ? ' active' : ''}">
            <button class="kid-pick" data-act="pick" data-id="${x.id}" aria-label="Faire jouer ${esc(x.name)}">
                <span class="kid-card-avatar">${x.avatar}</span>
                <span class="kid-card-name">${esc(x.name)}</span>
                ${x.id === cur ? '<span class="tag">Joue en ce moment</span>' : ''}
            </button>
            <button class="btn small" data-act="age" data-id="${x.id}" aria-label="Changer l'âge de ${esc(x.name)}">${x.age} ans</button>
            <button class="btn small danger" data-act="del" data-id="${x.id}" aria-label="Supprimer ${esc(x.name)}">Supprimer</button>
        </li>`).join('')
    const el = show(`
        <div class="panel children-panel">
            <header class="parent-head">
                <h1>Mes enfants</h1>
                <button class="btn primary" data-act="close">Retour au jeu</button>
            </header>
            <p class="muted">Touchez un enfant pour lui passer la main. Chacun garde ses niveaux et ses autocollants.</p>
            <ul class="kid-cards">${kids}</ul>
            <section class="add-child">
                <h2>Ajouter un enfant</h2>
                ${profileForm('Ajouter cet enfant')}
            </section>
        </div>`, 'setup children', (act, b) => {
        if (act === 'close') leaveParent()
        else if (act === 'pick') {
            Store.data.currentId = b.dataset.id
            Store.save()
            leaveParent()
        } else if (act === 'age') {
            // 3 → 4 → 5 → 3 ans : la progression de chaque série de jeux est gardée
            const x = Store.data.profiles.find((y) => y.id === b.dataset.id)
            x.age = x.age >= 5 ? 3 : x.age + 1
            Store.save()
            renderChildren()
        } else if (act === 'del') renderChildren(b.dataset.id)
        else if (act === 'del-no') renderChildren()
        else if (act === 'del-yes') {
            Store.removeProfile(b.dataset.id)
            if (!Store.profile) { parentOpen = false; renderSetup() } else renderChildren()
        }
    })
    bindProfileForm(el, () => renderChildren())
}

/* ---------- Espace parents ---------- */
function openParentGate(next = renderParent) {
    parentOpen = true
    let a, b
    const el = openLayer(`
        <div class="panel gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
            <h2 id="gate-title">Espace parents</h2>
            <p>Pour continuer, combien font <strong class="sum"></strong> ?</p>
            <form class="gate-form">
                <input name="answer" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" aria-label="Réponse">
                <p class="err" hidden>Ce n'est pas ça, voici un autre calcul.</p>
                <div class="row">
                    <button type="button" class="btn ghost" data-act="cancel">Annuler</button>
                    <button type="submit" class="btn primary">Valider</button>
                </div>
            </form>
        </div>`, 'parent-ov', (act) => {
        if (act === 'cancel') leaveParent()
    })
    const newSum = () => {
        a = 4 + Math.floor(Math.random() * 6)
        b = 5 + Math.floor(Math.random() * 5)
        $('.sum', el).textContent = `${a} + ${b}`
    }
    newSum()
    const form = $('.gate-form', el)
    form.addEventListener('submit', (e) => {
        e.preventDefault()
        if (parseInt(form.answer.value, 10) === a + b) return next()
        $('.err', el).hidden = false
        form.answer.value = ''
        newSum()
        form.answer.focus()
    })
    form.answer.focus()
}

function leaveParent() {
    parentOpen = false
    closeLayer()
    if (!Store.profile) renderSetup()
    else if (timeUp) showTimeUp(false)
    else renderHome(true)
}

function renderParent() {
    parentOpen = true
    const p = Store.profile
    const { settings, session } = Store.data
    const usedMin = Math.floor(session.usedMs / 60000)
    const progress = universesFor(p).map((u) => `<tr><td>${u.name}</td><td>${p.progress[u.id] || 0} / 3</td></tr>`).join('')
    const durations = [5, 10, 15, 20, 30, 0].map((m) =>
        `<option value="${m}"${m === settings.timerMin ? ' selected' : ''}>${m ? `${m} minutes` : 'Sans limite'}</option>`).join('')

    const el = openLayer(`
        <div class="panel parent" role="dialog" aria-modal="true" aria-labelledby="parent-title">
            <header class="parent-head">
                <h2 id="parent-title">Espace parents</h2>
                <button class="btn primary" data-act="close">Retour au jeu</button>
            </header>

            <section>
                <h3>Enfants</h3>
                <p>${esc(p.name)} joue en ce moment${Store.data.profiles.length > 1 ? ` (${Store.data.profiles.length} enfants enregistrés)` : ''}.</p>
                <button class="btn" data-act="kids">Ajouter ou changer d'enfant</button>
            </section>

            <section>
                <h3>Temps d'écran</h3>
                <label class="field inline">Durée d'une session
                    <select name="timer">${durations}</select>
                </label>
                <p>Temps joué dans cette session : <strong>${usedMin} min</strong>${settings.timerMin ? ` sur ${settings.timerMin}` : ''}.</p>
                <button class="btn" data-act="session">Relancer une session</button>
            </section>

            <section>
                <h3>Progression de ${esc(p.name)} (jeux ${p.age} ans)</h3>
                <table class="progress"><thead><tr><th>Univers</th><th>Niveaux réussis</th></tr></thead><tbody>${progress}</tbody></table>
                <p>Autocollants : ${p.stickers.length} / ${STICKERS.length}</p>
                <button class="btn danger" data-act="reset">Remettre la progression à zéro</button>
            </section>

            <section>
                <h3>Voix</h3>
                <p>Toutes les phrases et les prénoms sont enregistrés avec la même voix naturelle (Denise).</p>
                ${hasNameClip(p.name) ? `<p class="ok">Le prénom « ${esc(p.name)} » est enregistré.</p>`
                    : `<p class="warn">Le prénom « ${esc(p.name)} » n'est pas encore enregistré : en attendant, c'est la voix de l'appareil qui le dit.
                       Pour l'enregistrer, ajoutez-le dans <code>outils/prenoms.txt</code> puis lancez <code>node outils/generer-voix.mjs</code>.</p>`}
                ${!Voice.supported ? "<p>La synthèse vocale n'est pas disponible sur ce navigateur.</p>"
                    : !Voice.list.length ? ''
                    : `<label class="field inline">Voix de secours (prénom non enregistré)
                           <select name="voice">
                               <option value="">Automatique (la plus naturelle)</option>
                               ${Voice.list.map((v) => `<option value="${esc(v.voiceURI)}"${v.voiceURI === settings.voiceURI ? ' selected' : ''}>${esc(v.name)}${v.localService ? '' : ' (en ligne)'}${ROBOTIC_VOICES.test(v.name) ? ' (robotique)' : ''}</option>`).join('')}
                           </select>
                       </label>
                       <p class="muted">Voix utilisée : ${esc(Voice.voice.name)}</p>`}
                <button class="btn" data-act="voice">Tester la voix</button>
                <p class="muted">Voix enregistrée : Denise (Microsoft), générée avec l'outil edge-tts.</p>
            </section>

            <section>
                <h3>Crédits des sons</h3>
                <p class="muted">Cris d'animaux issus de Wikimedia Commons (commons.wikimedia.org), raccourcis et mis au même volume.
                Les versions modifiées sont partagées sous la même licence que l'original.</p>
                <ul class="credits">${SOUND_CREDITS.map(([animal, file, author, licence]) =>
                    `<li><strong>${animal}</strong> : « ${esc(file)} », par ${esc(author)}, ${licence}</li>`).join('')}</ul>
            </section>
        </div>`, 'parent-ov', (act, b) => {
        if (act === 'close') leaveParent()
        else if (act === 'kids') renderChildren()
        else if (act === 'session') {
            Timer.reset()
            renderParent()
        } else if (act === 'reset') {
            // Confirmation sur place (confirm() est bloqué dans certains navigateurs)
            b.outerHTML = `<div class="confirm-box">
                    <p>Remettre à zéro les niveaux et les autocollants de <strong>${esc(p.name)}</strong> ?</p>
                    <div class="row">
                        <button class="btn small" data-act="reset-no">Annuler</button>
                        <button class="btn small danger-strong" data-act="reset-yes">Oui, remettre à zéro</button>
                    </div>
                </div>`
        } else if (act === 'reset-no') {
            b.closest('.confirm-box').outerHTML = '<button class="btn danger" data-act="reset">Remettre la progression à zéro</button>'
        } else if (act === 'reset-yes') {
            p.progress = {}
            p.stickers = []
            Store.save()
            renderParent()
        } else if (act === 'voice') {
            Talk.run([...praise('Bravo', true), PHRASES.redTest])
        }
    })
    $('select[name="voice"]', el)?.addEventListener('change', (e) => {
        Store.data.settings.voiceURI = e.target.value
        Store.save()
        Voice.pick()
        renderParent()
        // Cette voix ne dit que le prénom : on le fait entendre seul
        Voice.tts(p.name)
    })
    $('select[name="timer"]', el).addEventListener('change', (e) => {
        Store.data.settings.timerMin = +e.target.value
        Store.data.settings.timerSetByParent = true
        Store.save()
        if (timeUp && Timer.left() > 0) timeUp = false
        renderParent()
    })
}

/* =========================================================
   Minuteur de temps d'écran
   ========================================================= */
const Timer = {
    start() {
        const s = Store.data.session
        if (Date.now() - s.last > SESSION_GAP_MS) s.usedMs = 0
        setInterval(() => this.tick(), 1000)
    },
    limitMs() {
        const m = Store.data.settings.timerMin
        return m > 0 ? m * 60000 : Infinity
    },
    left() {
        return this.limitMs() - Store.data.session.usedMs
    },
    tick() {
        // Le temps ne compte que quand l'enfant joue, écran visible
        if (document.hidden || !Store.profile || timeUp || parentOpen) return
        const s = Store.data.session
        s.usedMs += 1000
        s.last = Date.now()
        if (s.usedMs % 5000 === 0) Store.save()
        if (this.left() <= 0) showTimeUp()
    },
    reset() {
        Store.data.session = { usedMs: 0, last: Date.now() }
        Store.save()
        timeUp = false
    }
}

/* =========================================================
   Démarrage (sauté quand outils/generer-voix.mjs charge ce fichier pour lister les phrases)
   ========================================================= */
if (!globalThis.PHRASES_ONLY) {
    Store.load()
    Voice.init()
    Confetti.init()
    Timer.start()
    // À chaque toucher : Safari peut remettre le son en pause (appli en arrière-plan, appel…)
    document.addEventListener('pointerdown', () => Clip.unlock())
    document.addEventListener('click', () => Clip.unlock())
    document.addEventListener('visibilitychange', () => { if (document.hidden) Store.save() })

    if (!Store.profile) renderSetup()
    else if (Timer.left() <= 0) showTimeUp(false)
    else renderHome(true)

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {})
        // Sons mis en cache en arrière-plan, une fois l'appli affichée
        navigator.serviceWorker.ready.then((r) => r.active?.postMessage('precache-audio'))
    }
}
