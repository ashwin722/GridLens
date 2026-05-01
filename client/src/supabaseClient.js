import { createClient } from '@supabase/supabase-js';

// Get these from Supabase -> Project Settings -> API
// Pull the secrets from the .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey);