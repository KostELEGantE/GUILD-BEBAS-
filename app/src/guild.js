// Konfigurasi per guild. Satu kode untuk semua guild; build memilih lewat __GUILD__ (default: bebas).
import bebasLogo from './assets/logo.webp'
import syndicateLogo from './assets/syndicate-logo.svg'

const GUILDS = {
  bebas: {
    id: 'bebas',
    name: 'BEBAS',
    supabaseUrl: 'https://fzjnccdbqzvrboplaqnn.supabase.co',
    supabaseKey: 'sb_publishable_fm56O0K2V9EbreleyWCR_g_jNRko-Pv',
    logo: bebasLogo,
    cfProject: 'guild-bebas',
    repo: 'KostELEGantE/GUILD-BEBAS-',
  },
  syndicate: {
    id: 'syndicate',
    name: 'SYNDICATE',
    supabaseUrl: 'https://dznfvwnpggwxwixckews.supabase.co',
    supabaseKey: 'sb_publishable_dYkFX4QhboQujDS8AIY_GQ_6OzX4fiL',
    logo: syndicateLogo,
    cfProject: 'guild-syndicate',
    repo: 'KostELEGantE/GUILD-SYNDICATE',
  },
}

/* global __GUILD__ */
const pick = typeof __GUILD__ !== 'undefined' ? __GUILD__ : 'bebas'
const GUILD = GUILDS[pick] || GUILDS.bebas
export default GUILD
