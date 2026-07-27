-- 0014: hernoem de productie-organisatie ZSG naar TGC (naam van de instelling
-- zoals de klant die voert). Zelfde rij, zelfde id — alle org_id-verwijzingen
-- (careon_*-data, lidmaatschappen, audit) blijven ongewijzigd gekoppeld.
-- Idempotent: een tweede run raakt nul rijen.

update public.organizations
set name = 'TGC', slug = 'tgc'
where slug = 'zsg';
