-- Careon Pulse — financiële rolregel in de database (audit 29-07-2026, blocker 3).
-- Vereist 0009 (app-helpers) en 0010 (org-scoping). Uitvoeren via de SQL-editor
-- of de Management API. Idempotent: alles is drop-if-exists / or replace.
--
-- Waarom: het klantbesluit van 28-07-2026 ("leden zien niets financieels") werd
-- alleen in route-code afgedwongen (src/lib/careon-production/aux-route.ts).
-- De anon-key en de project-URL staan in de clientbundle, dus een gewoon lid kan
-- met zijn eigen wachtwoord een JWT halen en PostgREST rechtstreeks bevragen —
-- langs elke applicatielaag heen. De policies uit 0010 waren rolblind
-- (is_org_member), dus dat lid las én overschreef de omzet-, toeslagen- en
-- declaratie-aggregaten. Deze migratie legt dezelfde regel in RLS.
--
-- Ontwerp:
--   * careon_declaraties_state / careon_toeslagen_state zijn volledig
--     financieel → select én insert alleen voor financieel-gerechtigden.
--   * careon_agenda_state is gemengd (planning, no-show, uren mág een lid zien;
--     omzet niet) → de basistabel gaat óók op slot, en leden lezen de
--     redigerende view careon_agenda_state_public. Die view nult exact dezelfde
--     sleutels als redigeerAgendaFactsFinancieel (src/lib/careon-production/
--     redactie.ts): omzetGerealiseerd, onderhanden en onderhandenSessies per cel
--     plus een lege facturatie-lijst. Nullen (niet verwijderen) is verplicht —
--     de typeguard isAgendaFacts eist eindige getallen.
--   * Append-only blijft append-only: nergens update/delete voor authenticated.
--   * De service-role omzeilt RLS en blijft dus ongewijzigd werken
--     (push:production, admin-reads, onderhoud). Die paden lezen de BASIStabel;
--     de view is bewust alleen voor `authenticated` en filtert op lidmaatschap,
--     dus een service-role-select op de view levert géén rijen — gebruik daar
--     careon_agenda_state.
--
-- Uitrolvolgorde: eerst deze migratie toepassen, dan direct de route uitrollen
-- die het agenda-aggregaat uit careon_agenda_state_public leest. Tussen die twee
-- momenten krijgt een LID geen centraal agenda-aggregaat meer (de basistabel is
-- dan al dicht); org_admins en de superadmin merken niets. Andersom (route eerst)
-- zou iedereen een 502 geven, want de view bestaat dan nog niet.
--
-- Restrisico (bewust): de view geeft leden precies wat de route hen vandaag ook
-- geeft. Krijgt AgendaFacts later een nieuw financieel veld, dan moet dat op
-- twee plekken worden genuld: redactie.ts én app.redigeer_agenda_financieel().
-- verify:runtime bewaakt dat deze twee sleutelverzamelingen gelijk blijven.

-- ── Helper: mag deze gebruiker financiële cijfers van deze organisatie zien ──
-- Spiegelt magFinancieelZien() (src/lib/careon-financieel-rol.ts): org_admin,
-- platformbeheerder of het vaste demoaccount. Strikter dan de app op één punt:
-- het demoaccount telt alleen binnen organisaties waar het daadwerkelijk lid
-- van is (het leeft in de demo-organisatie en ziet dus nooit klantcijfers).

create or replace function app.mag_financieel_zien(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.is_superadmin()
    or exists (
      select 1
      from public.organization_members m
      where m.org_id = check_org
        and m.user_id = (select auth.uid())
        and m.role = 'org_admin'
    )
    -- Vast demoaccount, zie CAREON_HOSTED_DEMO_EMAIL in
    -- src/lib/careon-demo-account.ts.
    or exists (
      select 1
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.org_id = check_org
        and m.user_id = (select auth.uid())
        and lower(btrim(u.email)) = 'user1@careon-demo.nl'
    );
$$;

revoke all on function app.mag_financieel_zien(uuid) from public, anon;
grant execute on function app.mag_financieel_zien(uuid) to authenticated, service_role;

-- ── Redactie van het gemengde agenda-aggregaat ──────────────────────────────

create or replace function app.redigeer_agenda_financieel(agenda jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  resultaat jsonb := agenda;
  cellen jsonb;
begin
  if agenda is null or jsonb_typeof(agenda) <> 'object' then
    return agenda;
  end if;
  if jsonb_typeof(agenda -> 'cellen') = 'array' then
    select coalesce(
             jsonb_agg(
               case
                 when jsonb_typeof(cel) = 'object'
                   then cel || jsonb_build_object('omzetGerealiseerd', 0, 'onderhanden', 0, 'onderhandenSessies', 0)
                 else cel
               end
               order by ord
             ),
             '[]'::jsonb
           )
      into cellen
      from jsonb_array_elements(agenda -> 'cellen') with ordinality as e(cel, ord);
    resultaat := jsonb_set(resultaat, '{cellen}', cellen);
  end if;
  -- facturatie is puur gefactureerde omzet per maand/koepel/Uzovi.
  resultaat := jsonb_set(resultaat, '{facturatie}', '[]'::jsonb);
  return resultaat;
end;
$$;

-- Execute is nodig voor `authenticated`: een view controleert rechten op
-- onderliggende TABELLEN als eigenaar, maar functies in de select-lijst nog
-- steeds als aanroeper. Onschadelijk — de functie leest niets, ze redigeert
-- alleen de jsonb die de aanroeper zelf meegeeft, en het app-schema staat niet
-- in de PostgREST-exposure.
revoke all on function app.redigeer_agenda_financieel(jsonb) from public, anon;
grant execute on function app.redigeer_agenda_financieel(jsonb) to authenticated, service_role;

-- ── Policies: financiële aggregaten alleen voor gerechtigden ────────────────
-- De rolblinde policies uit 0010 moeten wég (permissieve policies zijn een OR,
-- laten staan zou de nieuwe regel volledig neutraliseren). Wordt 0010 ooit
-- opnieuw uitgevoerd, dan moet 0015 daarna óók opnieuw draaien.

do $$
declare
  t text;
begin
  foreach t in array array[
    'careon_agenda_state',
    'careon_toeslagen_state',
    'careon_declaraties_state'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_financieel_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (app.mag_financieel_zien(org_id) and (app.is_org_member(org_id) or app.is_superadmin()))',
      t || '_financieel_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_financieel_insert', t);
    -- Wie het aggregaat niet mag zien, mag het ook niet vervangen: een push wint
    -- org-breed (nieuwste rij). Een lid zou anders zijn geredigeerde kopie
    -- kunnen terugposten en de omzet van de hele organisatie wissen.
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (app.is_org_member(org_id) and app.mag_financieel_zien(org_id))',
      t || '_financieel_insert', t);
    -- Append-only: nooit update/delete voor clients, ook niet impliciet.
    execute format('revoke update, delete, truncate on table public.%I from anon, authenticated', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── Leden-view op het gemengde agenda-aggregaat ─────────────────────────────
-- Bewust GEEN security_invoker: de view moet de RLS van de basistabel juist
-- overslaan (die is nu financieel afgesloten) en doet daarom zelf de
-- org-scheiding. security_barrier houdt die filter vóór elke door de client
-- meegegeven expressie. Financieel-gerechtigden krijgen via deze view dezelfde
-- volledige staat als via de basistabel, zodat de route onvoorwaardelijk hier
-- kan lezen.

drop view if exists public.careon_agenda_state_public;
create view public.careon_agenda_state_public
with (security_barrier = true) as
select
  s.id,
  s.org_id,
  s.saved_at,
  s.operation_id,
  case
    when app.mag_financieel_zien(s.org_id) then s.state
    else app.redigeer_agenda_financieel(s.state)
  end as state
from public.careon_agenda_state s
where app.is_org_member(s.org_id) or app.is_superadmin();

revoke all on table public.careon_agenda_state_public from anon, authenticated;
grant select on table public.careon_agenda_state_public to authenticated;

-- PostgREST kent de nieuwe view pas na een schema-reload.
notify pgrst, 'reload schema';
