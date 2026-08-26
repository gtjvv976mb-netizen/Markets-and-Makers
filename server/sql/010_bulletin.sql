-- The Mercedonia Dispatch: what the district did today, in words.
--
-- The snapshot is stored alongside the text on purpose. A bulletin is written by a
-- language model from numbers this server measured, and the only way to tell a fair
-- summary from a confident invention later is to be able to read exactly what it was
-- told at the time. Keeping the input is what makes the output auditable.

create table if not exists bulletin (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  published_at timestamptz not null default now(),
  headline text not null,
  body text not null,
  mood text not null,
  -- The measured state the writer was given. Never regenerated, never edited.
  snapshot jsonb not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0
);

create index if not exists bulletin_recent_idx on bulletin (realm_id, published_at desc);

insert into realm_clock (realm_id, mind) values ('sunwoven-1', 'dispatch')
on conflict do nothing;
