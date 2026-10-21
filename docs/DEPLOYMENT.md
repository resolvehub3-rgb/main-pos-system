# Samtech Helper POS - Deployment & Operations Guide

## 1. Supabase Project Setup
1. Create a project at [supabase.com](https://supabase.com).
2. Go to SQL Editor and run `supabase/migrations/20261020000001_initial_schema.sql`.
3. Optionally run `supabase/seed.sql` for initial subscription tiers.
4. Go to Project Settings -> API to copy `Project URL` and `anon public key`.

## 2. Render Deployment
1. Connect the GitHub repository to [render.com](https://render.com).
2. Use `render.yaml` Blueprint or create two services:
   - Web Service: Root directory `backend/`, command `npm start`, environment variables set.
   - Static Site: Root directory `frontend/`, publish directory `dist`, build command `npm run build`.

## 3. Environment Variables
- `VITE_SUPABASE_URL`: e.g. `https://xyzcompany.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: public anon token
- `PORT`: `3000`
