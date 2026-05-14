create table if not exists public.gridlens_uploads (
  dataset text primary key,
  records jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_gridlens_uploads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_gridlens_uploads_updated_at on public.gridlens_uploads;

create trigger set_gridlens_uploads_updated_at
before update on public.gridlens_uploads
for each row
execute function public.set_gridlens_uploads_updated_at();
