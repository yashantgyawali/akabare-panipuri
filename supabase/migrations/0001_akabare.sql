-- Akabare Panipuri Online: game records, player tokens, realtime version pings.
--
-- Only the `game` edge function (service role) touches these tables. RLS is on
-- with no policies and anon/authenticated hold no privileges, so the public
-- anon key cannot read secret game state or token hashes. Clients learn about
-- changes from a public broadcast ({version, status}) on topic 'akabare:<CODE>'
-- and refetch their own view through the function.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.akabare_games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$'),
  status text not null check (status in ('lobby', 'playing', 'finished')),
  record jsonb not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pruning deletes games untouched for 3 days.
create index if not exists akabare_games_updated_at_idx on public.akabare_games (updated_at);

create table if not exists public.akabare_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  game_id uuid not null references public.akabare_games (id) on delete cascade,
  player_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists akabare_tokens_game_player_idx on public.akabare_tokens (game_id, player_id);

-- ---------------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------------

alter table public.akabare_games enable row level security;
alter table public.akabare_tokens enable row level security;

revoke all on table public.akabare_games from anon, authenticated;
revoke all on table public.akabare_tokens from anon, authenticated;
grant select, insert, update, delete on table public.akabare_games to service_role;
grant select, insert, update, delete on table public.akabare_tokens to service_role;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.akabare_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists akabare_games_touch on public.akabare_games;
create trigger akabare_games_touch
  before update on public.akabare_games
  for each row execute function public.akabare_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime version ping (public broadcast; carries no secrets)
-- ---------------------------------------------------------------------------

create or replace function public.akabare_broadcast_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('version', new.version, 'status', new.status),
      'update',
      'akabare:' || new.code,
      false
    );
  exception when others then
    -- A lost ping must never roll back a game write; clients also poll.
    raise warning 'akabare broadcast failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists akabare_games_broadcast on public.akabare_games;
create trigger akabare_games_broadcast
  after insert or update on public.akabare_games
  for each row execute function public.akabare_broadcast_version();

-- Trigger functions are not meant to be called directly (and PostgREST would
-- otherwise expose EXECUTE to anon via default privileges).
revoke all on function public.akabare_touch_updated_at() from public, anon, authenticated;
revoke all on function public.akabare_broadcast_version() from public, anon, authenticated;
grant execute on function public.akabare_touch_updated_at() to service_role;
grant execute on function public.akabare_broadcast_version() to service_role;
