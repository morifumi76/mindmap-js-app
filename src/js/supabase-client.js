// ========================================
// Supabase Client Initialization
// ========================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aobeqireuzbovcrgbzqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvYmVxaXJldXpib3ZjcmdienFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MzYyMzAsImV4cCI6MjA4OTMxMjIzMH0.xecJ7YzpVmxnf1W16WulhJKEF0c-QKLFrMk0KUxRMTA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
