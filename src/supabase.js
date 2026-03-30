import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "placeholder-key";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Keys that sync to the cloud (excludes dev-only spend logs)
const SYNC_KEYS = [
  "oracle_user",
  "oracle_pulls",
  "oracle_context",
  "oracle_prefs",
  "oracle_resonance",
];

/** Pull all cloud data for this user into localStorage. Returns true if data was found. */
export async function loadFromCloud(userId) {
  try {
    const { data, error } = await supabase
      .from("user_data")
      .select("data")
      .eq("user_id", userId)
      .single();
    if (error || !data?.data) return false;
    Object.entries(data.data).forEach(([key, val]) => {
      localStorage.setItem(key, val);
    });
    return true;
  } catch {
    return false;
  }
}

/** Write all relevant localStorage keys to Supabase for this user. */
export async function saveToCloud(userId) {
  if (!userId) return;
  try {
    const data = {};
    // Stable keys
    SYNC_KEYS.forEach((key) => {
      const val = localStorage.getItem(key);
      if (val !== null) data[key] = val;
    });
    // Dynamic conversation keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("oracle_convo_")) {
        data[key] = localStorage.getItem(key);
      }
    }
    await supabase.from("user_data").upsert({
      user_id: userId,
      data,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Silently fail — localStorage is still source of truth
  }
}

/** Send a magic link to the given email. */
export function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

/** Redirect to Google OAuth. */
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

/** Sign the current user out. */
export function supabaseSignOut() {
  return supabase.auth.signOut();
}
