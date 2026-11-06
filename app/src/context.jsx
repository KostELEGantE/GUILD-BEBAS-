import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, q } from './lib/supabase.js'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ session, children }) {
  const [profile, setProfile] = useState(null)
  const [members, setMembers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  const toast = useCallback((msg, type = 'ok') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'err' ? 6000 : 3500)
  }, [])

  const loadProfile = useCallback(async () => {
    const data = await q(supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle())
    setProfile(data)
  }, [session.user.id])

  const loadMembers = useCallback(async () => {
    const data = await q(
      supabase.from('members').select('*, owner:profiles(display_name, avatar_url)').order('name'),
    )
    setMembers(data)
  }, [])

  const loadGroups = useCallback(async () => {
    const data = await q(supabase.from('groups').select('*, group_members(member_id, added_at)').order('name'))
    setGroups(data)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await Promise.all([loadProfile(), loadMembers(), loadGroups().catch(() => {})])
      } catch (e) {
        if (alive) toast(e.message, 'err')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadProfile, loadMembers, loadGroups, toast])

  // Realtime: perubahan party fix langsung terlihat
  useEffect(() => {
    const ch = supabase
      .channel('groups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => loadGroups().catch(() => {}))
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadGroups])

  const groupByMember = useMemo(() => {
    const map = new Map()
    for (const g of groups) for (const gm of g.group_members || []) map.set(gm.member_id, g)
    return map
  }, [groups])

  const myMembers = members.filter((m) => m.user_id === session.user.id && m.active)

  const value = {
    session,
    user: session.user,
    profile,
    isAdmin: !!profile?.is_admin,
    isSuper: !!profile?.is_super,
    members,
    myMembers,
    loading,
    toast,
    reloadMembers: loadMembers,
    groups,
    groupByMember,
    reloadGroups: loadGroups,
    reloadProfile: loadProfile,
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

/** Jalankan aksi async dengan pesan error/sukses otomatis */
export function useAction() {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn, okMsg) => {
      setBusy(true)
      try {
        const r = await fn()
        if (okMsg) toast(okMsg)
        return r
      } catch (e) {
        toast(e.message || String(e), 'err')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )
  return [run, busy]
}
