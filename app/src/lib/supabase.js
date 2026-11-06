import { createClient } from '@supabase/supabase-js'

// Nilai bawaan = project Supabase "ragnarok-guild". Bisa ditimpa lewat file .env
// (lihat .env.example). Publishable key memang aman berada di browser; data dilindungi RLS.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://fzjnccdbqzvrboplaqnn.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_fm56O0K2V9EbreleyWCR_g_jNRko-Pv'

if (!url || !key) {
  // Tampil di console bila file .env belum diisi
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY belum diisi di file .env')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

/** Panggil RPC dan lempar error berbahasa manusia */
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

/** Jalankan query supabase dan lempar error bila gagal */
export async function q(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}
