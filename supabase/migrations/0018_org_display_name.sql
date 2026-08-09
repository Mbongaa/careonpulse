-- 0018 — organisatienaam is voortaan weergavenaam.
--
-- Sinds de sessie de organisatienaam meedraagt (careon-org-naam.ts) rendert het
-- dashboard `organizations.name` op elk klantgericht scherm: de topbalk, de
-- klantregel in de zijbalk, de cockpitzin, de teamkaarten en de export. 0014
-- zette die naam op de interne korte vorm 'TGC', terwijl de geauditeerde
-- productcopy overal 'TGC Groep' toont. Zonder deze correctie zou de eerste
-- uitrol van die functie de merknaam bij de klant afkappen.
--
-- De slug blijft ongemoeid: `push:production` zoekt de organisatie op
-- `slug=eq.tgc` en zou op een gewijzigde slug hard stoppen.

update public.organizations
set name = 'TGC Groep'
where slug = 'tgc' and name = 'TGC';
