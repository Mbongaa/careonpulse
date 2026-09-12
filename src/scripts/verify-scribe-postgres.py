"""Careon Scribe RLS/trigger/RPC regressions against an explicitly supplied local PG.

python3 src/scripts/verify-scribe-postgres.py --port 55439 --user hassan

Creates and drops one fresh synthetic database on localhost. No application
.env, credentials, network providers, production data, or real consult content
are used. Applies the actual migration chain, excluding only 0019's
token-issuance hook (its Supabase-owned postgres role is absent locally), so
every policy, trigger and RPC under test is the one that ships.

Covers handoff 20 §9 "DB-regressie": owner-bound content, the authorization
grant per gemachtigde behandelaar, the frozen consent window, the freeze
triggers, the status/approval RPCs with their synchronous purge, the release
path for a colleague, the retention prune and the quota scope 'scribe'.
"""

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from local_postgres import LocalPostgres

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
TOKEN_HOOK = "0019_careon_access_token_hook.sql"
SCRIBE_TABELLEN = [
    "careon_scribe_sessies", "careon_scribe_segmenten", "careon_scribe_staat",
    "careon_scribe_notities", "careon_scribe_taken", "careon_scribe_instellingen",
    "careon_scribe_gemachtigden", "careon_scribe_vrijgaven",
]

ORG = "11111111-1111-4111-8111-111111111111"
BEHEERDER = "22222222-2222-4222-8222-222222222222"
BEHANDELAAR = "33333333-3333-4333-8333-333333333333"
LID = "44444444-4444-4444-8444-444444444444"
COLLEGA = "55555555-5555-4555-8555-555555555555"
SUPER = "66666666-6666-4666-8666-666666666666"
SESSIE = "77777777-7777-4777-8777-777777777777"
TWEEDE = "88888888-8888-4888-8888-888888888888"
NOTITIE = "99999999-9999-4999-8999-999999999999"
FRAGMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


def literal(value):
    return quoted(json.dumps(value)) + "::jsonb"


def as_user(subject, query):
    # Stale, stronger app metadata is deliberately retained in the claims: only
    # the current membership rows may decide access.
    claims = json.dumps({
        "sub": subject, "role": "authenticated",
        "app_metadata": {"org_id": ORG, "role": "org_admin", "is_superadmin": True},
    })
    return f"set role authenticated; set request.jwt.claims = {quoted(claims)}; {query}"


def as_service(query):
    claims = json.dumps({"role": "service_role"})
    return f"set role service_role; set request.jwt.claims = {quoted(claims)}; {query}"


def instellingen(ingeschakeld=True, transcript=30, notitie=30, wissen=True,
                 dpia="2026-08-15", verwerkersovereenkomst=True):
    """A settings snapshot as the PUT route would store it.

    N21: `ingeschakeld` alone no longer opens app.scribe_ingeschakeld — the DPIA
    date and the confirmed processor agreement are part of the predicate, so the
    activation evidence has to exist in the database, not only in a document.
    """
    return {
        "ingeschakeld": ingeschakeld, "standaardFormaat": "soap",
        "consenttekst": "Synthetische toestemmingstekst voor de regressietest.",
        "transcriptRetentieDagen": transcript, "notitieRetentieDagen": notitie,
        "transcriptWissenBijOvername": wissen,
        "klinischeAanwijzingenAan": True, "medicatiecheckAan": True,
        "aiAnalyseAan": False, "transcriptieAan": False,
        "dpiaVastgesteldOp": dpia, "dpiaEigenaar": "Functionaris gegevensbescherming",
        "verwerkersovereenkomstBevestigd": verwerkersovereenkomst,
        "consenttekstGoedgekeurdOp": "2026-08-15",
    }


def lege_staat(extra=None):
    staat = {
        "samenvatting": "", "hoofdklacht": None, "duur": None, "beloop": None, "ernst": None,
        "symptomen": [], "begeleidendeSymptomen": [], "uitlokkendeFactoren": [],
        "verlichtendeFactoren": [], "medicatie": [], "allergieen": [], "voorgeschiedenis": [],
        "familieanamnese": [], "leefstijl": [], "psychisch": [], "metingen": [], "onderzoek": [],
        "overwegingen": [], "plan": [], "acties": [], "ontbrekend": [], "waarschuwingen": [],
    }
    if extra:
        staat.update(extra)
    return staat


def secties(beoordeling_tekst=""):
    return [
        {"id": "subjectief", "titel": "Subjectief", "conceptTekst": "Synthetisch concept.",
         "tekst": "Synthetisch concept.", "status": "goedgekeurd", "bron": [1],
         "vereistBehandelaar": False},
        {"id": "objectief", "titel": "Objectief", "conceptTekst": None,
         "tekst": "Niet besproken tijdens dit consult.", "status": "goedgekeurd", "bron": [],
         "vereistBehandelaar": False},
        {"id": "analyse", "titel": "Analyse", "conceptTekst": None, "tekst": beoordeling_tekst,
         "status": "goedgekeurd", "bron": [2], "vereistBehandelaar": True},
        {"id": "plan", "titel": "Plan", "conceptTekst": "Vervolgafspraak.",
         "tekst": "Vervolgafspraak.", "status": "goedgekeurd", "bron": [2],
         "vereistBehandelaar": False},
    ]


def segmenten(*teksten):
    return [{"spreker": "arts", "tekst": tekst, "bron": "demo"} for tekst in teksten]


def run(port, user):
    checks = 0

    with LocalPostgres(port, user, prefix="careon_scribe_regression") as db:

        def equal(actual, expected, label):
            nonlocal checks
            # psql also emits SET tags; the query result is always the last line.
            if isinstance(actual, str):
                actual = actual.splitlines()[-1] if actual else ""
                if actual != str(expected):
                    raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
            elif actual != expected:
                raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
            checks += 1

        def query(subject, sql, expected, label):
            equal(db.sql(as_user(subject, sql)), expected, label)

        def refused(statement, fragment, label):
            nonlocal checks
            error = db.error(statement)
            if fragment not in error:
                raise AssertionError(f"{label}: expected {fragment!r}, got {error}")
            checks += 1

        db.bootstrap_supabase()
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name != TOKEN_HOOK and migration.name <= "20260907120000_careon_scribe.sql":
                db.apply(migration)

        db.sql(f"""
          insert into public.organizations(id,name,slug) values ('{ORG}','Synthetic','synthetic-scribe');
          insert into auth.users(id,email) values
            ('{BEHEERDER}','beheerder@example.invalid'), ('{BEHANDELAAR}','behandelaar@example.invalid'),
            ('{LID}','lid@example.invalid'), ('{COLLEGA}','collega@example.invalid'),
            ('{SUPER}','super@example.invalid');
          insert into public.organization_members(org_id,user_id,role) values
            ('{ORG}','{BEHEERDER}','org_admin'), ('{ORG}','{BEHANDELAAR}','member'),
            ('{ORG}','{LID}','member'), ('{ORG}','{COLLEGA}','member');
          insert into public.platform_admins(user_id) values ('{SUPER}');
        """)

        # ── Instellingen en machtigingen: alleen de beheerder ────────────────
        refused(as_user(LID, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                             f"values ('{ORG}',{literal(instellingen())},1)"),
                "42501", "gewoon lid kan de scribe-instellingen niet vaststellen")
        query(BEHEERDER,
              f"with nieuw as (insert into public.careon_scribe_instellingen(org_id,state,revision) "
              f"values ('{ORG}',{literal(instellingen())},1) returning 1) select count(*) from nieuw",
              1, "beheerder stelt de instellingen vast")
        refused(as_user(LID, f"insert into public.careon_scribe_gemachtigden(org_id,user_id) "
                             f"values ('{ORG}','{LID}')"),
                "42501", "gewoon lid kan zichzelf niet machtigen")
        query(BEHEERDER,
              f"with nieuw as (insert into public.careon_scribe_gemachtigden(org_id,user_id,toegekend_door) "
              f"values ('{ORG}','{BEHANDELAAR}','{BEHEERDER}'),('{ORG}','{COLLEGA}','{BEHEERDER}') returning 1) "
              f"select count(*) from nieuw", 2, "beheerder machtigt twee behandelaren")

        # ── Rolpredicaten ───────────────────────────────────────────────────
        query(BEHEERDER, f"select app.mag_scribe_beheren('{ORG}'),app.mag_scribe_gebruiken('{ORG}')",
              "t|t", "org_admin beheert en gebruikt de module")
        query(BEHANDELAAR, f"select app.mag_scribe_beheren('{ORG}'),app.mag_scribe_gebruiken('{ORG}')",
              "f|t", "gemachtigde behandelaar gebruikt de module maar beheert niet")
        query(LID, f"select app.mag_scribe_beheren('{ORG}'),app.mag_scribe_gebruiken('{ORG}')",
              "f|f", "lid zonder machtiging valt buiten de module")
        # Geen kale superadmin-tak: zonder lidmaatschap geen enkele ingang.
        query(SUPER, f"select app.mag_scribe_beheren('{ORG}'),app.mag_scribe_gebruiken('{ORG}')",
              "f|f", "superadmin zonder lidmaatschap valt buiten de module")
        query(BEHANDELAAR, f"select app.scribe_ingeschakeld('{ORG}')", "t", "module staat aan voor deze org")

        # ── Consult starten: toestemming is een harde voorwaarde ─────────────
        def start(sessie, subject, consent="now()", status="'actief'"):
            return (
                f"insert into public.careon_scribe_sessies"
                f"(id,org_id,behandelaar_id,status,patient_referentie,consult_type,taal,"
                f"consent_bevestigd_op,consent_revisie,consent_tekst) values "
                f"('{sessie}','{ORG}','{subject}',{status},'D-2026-0417','soap','nl',"
                f"{consent},1,'Synthetische toestemmingstekst voor de regressietest.')"
            )

        refused(as_user(LID, start(SESSIE, LID)), "42501",
                "lid zonder machtiging kan geen consult starten")
        refused(as_user(BEHANDELAAR, start(SESSIE, BEHANDELAAR, consent="now() - interval '1 hour'")),
                "42501", "toestemming van een uur oud valt buiten het bevestigingsvenster")
        refused(as_user(BEHANDELAAR, start(SESSIE, BEHEERDER)), "42501",
                "een consult op naam van een collega wordt geweigerd")
        refused(as_user(BEHANDELAAR, start(SESSIE, BEHANDELAAR, status="'goedgekeurd'")), "42501",
                "een consult begint altijd als 'actief'")
        query(BEHANDELAAR, f"with nieuw as ({start(SESSIE, BEHANDELAAR)} returning 1) select count(*) from nieuw",
              1, "gemachtigde behandelaar start een consult")
        # Retentie is DB-werk: de trigger berekent beide termijnen uit de
        # laatste instellingen-revisie, ongeacht wat de client meestuurt.
        query(BEHANDELAAR,
              f"select transcript_verwijder_na between now() + interval '29 days' and now() + interval '31 days' "
              f"and sessie_verwijder_na = transcript_verwijder_na "
              f"from public.careon_scribe_sessies where id='{SESSIE}'",
              "t", "retentie wordt bij het starten door de database gezet")

        # Module uit ⇒ geen nieuw consult; daarna weer aan (append-only revisie).
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen(ingeschakeld=False))},2)"))
        refused(as_user(BEHANDELAAR, start(TWEEDE, BEHANDELAAR)), "42501",
                "met de module uit ontstaat er geen consult")
        refused(as_user(BEHEERDER, f"update public.careon_scribe_instellingen set revision=9 where revision=2"),
                "42501", "instellingen zijn append-only")
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen())},3)"))
        query(LID, f"select count(*) from public.careon_scribe_instellingen", 3,
              "elk organisatielid leest de instellingen (bewust rolblind)")
        # N21 — `ingeschakeld: true` zonder vastgelegde DPIA-datum of zonder
        # bevestigde verwerkersovereenkomst houdt de poort DICHT. De vlag alleen
        # was tot nu toe genoeg; daarmee stond de go-live-checklist alleen in een
        # document en niet in het product.
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen(dpia=None))},90)"))
        query(BEHANDELAAR, f"select app.scribe_ingeschakeld('{ORG}')", "f",
              "zonder vastgestelde DPIA blijft de module uit")
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen(verwerkersovereenkomst=False))},91)"))
        query(BEHANDELAAR, f"select app.scribe_ingeschakeld('{ORG}')", "f",
              "zonder bevestigde verwerkersovereenkomst blijft de module uit")
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen())},92)"))
        query(BEHANDELAAR, f"select app.scribe_ingeschakeld('{ORG}')", "t",
              "met het volledige bewijs gaat de module weer aan")

        # ── Segmenten: eigenaar-gebonden en uitsluitend via de RPC ──────────
        refused(as_user(COLLEGA,
                        f"insert into public.careon_scribe_segmenten(sessie_id,org_id,behandelaar_id,volgnummer,tekst) "
                        f"values ('{SESSIE}','{ORG}','{COLLEGA}',1,'Synthetische regel')"),
                "42501", "een segment op het consult van een collega wordt geweigerd")
        refused(as_user(COLLEGA, f"select public.careon_scribe_voeg_segmenten_toe("
                                 f"'{SESSIE}','{FRAGMENT}',{literal(segmenten('Synthetische regel'))},8000,false)"),
                "42501", "de RPC laat een collega niet op andermans consult schrijven")
        toegevoegd = json.loads(db.sql(as_user(BEHANDELAAR,
            f"select public.careon_scribe_voeg_segmenten_toe('{SESSIE}','{FRAGMENT}',"
            f"{literal(segmenten('Somberheid sinds drie maanden.', 'Sertraline vijftig milligram.'))},"
            f"8000,false)")).splitlines()[-1])
        equal(len(toegevoegd), 2, "de RPC voegt twee segmenten toe")
        equal([rij["volgnummer"] for rij in toegevoegd], [1, 2], "volgnummers komen uit de teller")
        herhaald = json.loads(db.sql(as_user(BEHANDELAAR,
            f"select public.careon_scribe_voeg_segmenten_toe('{SESSIE}','{FRAGMENT}',"
            f"{literal(segmenten('Somberheid sinds drie maanden.'))},8000,false)")).splitlines()[-1])
        equal([rij["id"] for rij in herhaald], [rij["id"] for rij in toegevoegd],
              "hetzelfde fragment levert dezelfde segmenten (idempotent)")
        query(BEHANDELAAR, f"select segment_teller,duur_ms from public.careon_scribe_sessies where id='{SESSIE}'",
              "2|8000", "de teller telt het herhaalde fragment niet dubbel")
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_voeg_segmenten_toe('{SESSIE}',null,"
                                     f"{literal(segmenten(*(['Synthetische regel.'] * 901)))},0,false)"),
                "maximaal 900", "de RPC begrenst een consult op 900 segmenten")
        refused(as_user(COLLEGA,
                        f"insert into public.careon_scribe_taken(sessie_id,org_id,behandelaar_id,omschrijving) "
                        f"values ('{SESSIE}','{ORG}','{COLLEGA}','Synthetische vervolgactie')"),
                "42501", "een vervolgactie op het consult van een collega wordt geweigerd")
        query(BEHANDELAAR,
              f"with nieuw as (insert into public.careon_scribe_taken"
              f"(sessie_id,org_id,behandelaar_id,omschrijving,soort) values "
              f"('{SESSIE}','{ORG}','{BEHANDELAAR}','Synthetische vervolgactie','lab') returning 1) "
              f"select count(*) from nieuw", 1, "de behandelaar legt een vervolgactie vast")
        query(BEHANDELAAR,
              "with gewijzigd as (update public.careon_scribe_segmenten set spreker='patient',"
              "tekst_gecorrigeerd='Sertraline 50 mg.',correctie_bron='behandelaar' where volgnummer=2 returning 1) "
              "select count(*) from gewijzigd", 1, "de behandelaar corrigeert spreker en tekst")
        refused(as_user(BEHANDELAAR, "update public.careon_scribe_segmenten set tekst='Herschreven' where volgnummer=1"),
                "alleen spreker en correctie", "het herkende transcript ligt vast")
        refused(as_user(BEHANDELAAR, "update public.careon_scribe_segmenten set correctie_bron='ai' where volgnummer=2"),
                "niet door de AI overschreven", "de AI overschrijft geen correctie van de behandelaar")

        # ── Consultstaat: vorm, geen diagnose ───────────────────────────────
        query(BEHANDELAAR,
              f"with nieuw as (insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat,laatste_segment) "
              f"values ('{SESSIE}','{ORG}','{BEHANDELAAR}',{literal(lege_staat({'samenvatting': 'Synthetisch.'}))},2) "
              f"returning 1) select count(*) from nieuw", 1, "de behandelaar legt de consultstaat vast")
        refused(as_user(BEHANDELAAR,
                        f"update public.careon_scribe_staat set staat="
                        f"{literal(lege_staat({'diagnose': 'depressieve episode'}))} where sessie_id='{SESSIE}'"),
                "23514", "een staat met een diagnoseveld wordt geweigerd")
        refused(as_user(BEHANDELAAR,
                        f"update public.careon_scribe_staat set staat='{{\"samenvatting\":\"leeg\"}}'::jsonb "
                        f"where sessie_id='{SESSIE}'"),
                "23514", "een staat zonder de vaste sleutels wordt geweigerd")

        # ── Beheerder ziet metadata, geen inhoud ────────────────────────────
        # C3/C10 — RLS is rij-niveau, niet kolomniveau: zolang de select-policy een
        # beheerderstak droeg, kon een org_admin met zijn eigen JWT gewoon
        # `select patient_referentie, consult_type` doen op elk consult van elke
        # collega — precies de twee velden die S12/V3 belooft weg te laten. Die
        # belofte stond alleen in de serializer. De tak is weg; de
        # metadatalijst loopt nu via de service-role met een vaste kolomlijst.
        query(BEHEERDER, "select count(*) from public.careon_scribe_sessies", 0,
              "org_admin leest het consult van een collega niet meer onder zijn eigen JWT")
        query(BEHEERDER, "select count(*) from public.careon_scribe_sessies where patient_referentie is not null", 0,
              "org_admin leest de dossierreferentie van een collega niet")
        equal(db.sql(as_service("select count(*) from public.careon_scribe_sessies")), 1,
              "de service-role levert de beheerderslijst wél (ná de beheerdersgate in de route)")
        query(BEHEERDER, "select count(*) from public.careon_scribe_segmenten", 0,
              "org_admin leest het transcript niet")
        query(BEHEERDER, "select count(*) from public.careon_scribe_staat", 0,
              "org_admin leest de consultstaat niet")
        query(SUPER, "select count(*) from public.careon_scribe_sessies", 0,
              "superadmin zonder lidmaatschap ziet geen enkel consult")
        query(COLLEGA, "select count(*) from public.careon_scribe_sessies", 0,
              "een gemachtigde collega ziet andermans consult niet")

        # ── Bevriestrigger: status en bewaartermijn zijn geen clientvelden ──
        refused(as_user(BEHANDELAAR, f"update public.careon_scribe_sessies set status='goedgekeurd' where id='{SESSIE}'"),
                "careon_scribe_status_zetten", "de client kan de status niet zetten")
        refused(as_user(BEHANDELAAR, f"update public.careon_scribe_sessies "
                                     f"set transcript_verwijder_na=now()+interval '999 days' where id='{SESSIE}'"),
                "careon_scribe_status_zetten", "de client kan de bewaartermijn niet oprekken")
        refused(as_user(BEHANDELAAR, f"update public.careon_scribe_sessies "
                                     f"set consent_tekst='Andere tekst' where id='{SESSIE}'"),
                "onwijzigbaar", "de vastgelegde toestemming is onwijzigbaar")
        query(BEHANDELAAR,
              f"with gewijzigd as (update public.careon_scribe_sessies set patient_referentie='D-2026-0418',"
              f"updated_at=now() where id='{SESSIE}' returning 1) select count(*) from gewijzigd",
              1, "de dossierreferentie blijft wel wijzigbaar")

        # ── Statusovergangen via de RPC ─────────────────────────────────────
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_status_zetten('{SESSIE}','goedgekeurd')"),
                "niet toegestaan", "actief -> goedgekeurd wordt geweigerd")
        refused(as_user(COLLEGA, f"select public.careon_scribe_status_zetten('{SESSIE}','afgerond')"),
                "42501", "een collega rondt het consult niet af")
        afgerond = json.loads(db.sql(as_user(BEHANDELAAR,
            f"select public.careon_scribe_status_zetten('{SESSIE}','afgerond')")).splitlines()[-1])
        equal(afgerond["status"], "afgerond", "actief -> afgerond via de RPC")
        equal(afgerond["beeindigd_op"] is not None, True, "afronden legt het eindtijdstip vast")
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_status_zetten('{SESSIE}','goedgekeurd')"),
                "nog niet goedgekeurd", "goedkeuren kan niet zonder goedgekeurd verslag")
        # Afrondingsvenster: fragmenten die nog onderweg waren mogen alsnog landen.
        query(BEHANDELAAR,
              f"select jsonb_array_length(public.careon_scribe_voeg_segmenten_toe('{SESSIE}',null,"
              f"{literal(segmenten('Nagekomen fragment.'))},1000,false))",
              1, "binnen het afrondingsvenster landt een nagekomen fragment alsnog")

        # ── Verslag: beoordelingssecties zijn van de behandelaar ────────────
        db.sql(as_user(BEHANDELAAR,
            f"insert into public.careon_scribe_notities(id,sessie_id,org_id,behandelaar_id,versie,formaat,secties) "
            f"values ('{NOTITIE}','{SESSIE}','{ORG}','{BEHANDELAAR}',1,'soap',{literal(secties())})"))
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_notitie_goedkeuren('{NOTITIE}')"),
                "beoordeling van de behandelaar ontbreekt",
                "een lege beoordelingssectie blokkeert de goedkeuring")
        refused(as_user(BEHANDELAAR, f"update public.careon_scribe_notities set status='goedgekeurd',"
                                     f"goedgekeurd_op=now() where id='{NOTITIE}'"),
                "careon_scribe_notitie_goedkeuren", "de client keurt niet buiten de RPC om goed")
        # C2 — de bevriestrigger is een BEFORE UPDATE en ziet een INSERT niet.
        # Zonder de status-pin in de insert-policy kon een behandelaar met zijn
        # eigen JWT een rij met status='goedgekeurd' invoegen en daarmee de hele
        # controle van careon_scribe_notitie_goedkeuren overslaan (S10).
        refused(as_user(BEHANDELAAR,
                        f"insert into public.careon_scribe_notities(sessie_id,org_id,behandelaar_id,versie,formaat,"
                        f"secties,status,goedgekeurd_op) values ('{SESSIE}','{ORG}','{BEHANDELAAR}',9,'soap',"
                        f"{literal(secties())},'goedgekeurd',now())"),
                "42501", "een verslag ontstaat nooit rechtstreeks als goedgekeurd")
        db.sql(as_user(BEHANDELAAR,
            f"update public.careon_scribe_notities set secties="
            f"{literal(secties('Beoordeling door de behandelaar, synthetisch.'))} where id='{NOTITIE}'"))
        refused(as_user(COLLEGA, f"select public.careon_scribe_notitie_goedkeuren('{NOTITIE}')"),
                "42501", "een collega keurt het verslag niet goed")
        goedgekeurd = json.loads(db.sql(as_user(BEHANDELAAR,
            f"select public.careon_scribe_notitie_goedkeuren('{NOTITIE}')")).splitlines()[-1])
        equal(goedgekeurd["status"], "goedgekeurd", "de behandelaar keurt het verslag goed")
        equal(goedgekeurd["goedgekeurd_op"] is not None, True, "goedkeuring legt het tijdstip vast")
        # C12/C34 — de goedkeuring schuift het consult in DEZELFDE transactie mee
        # naar 'goedgekeurd'. Voorheen deed de client dat in een tweede aanroep;
        # viel die weg, dan bleef er een goedgekeurd, nog niet overgenomen verslag
        # liggen op een consult dat nog 'afgerond' heette — precies de stand
        # waarin de verwijderguard van §5.3 niet vuurde.
        query(BEHANDELAAR,
              f"select status from public.careon_scribe_sessies where id='{SESSIE}'", "goedgekeurd",
              "de goedkeuring van het verslag schuift het consult mee")
        query(BEHANDELAAR,
              f"select goedgekeurd_op is not null from public.careon_scribe_sessies where id='{SESSIE}'", "t",
              "het consult krijgt daarbij zijn goedkeuringstijdstip")
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_notitie_goedkeuren('{NOTITIE}')"),
                "al goedgekeurd", "een tweede goedkeuring wordt geweigerd")
        refused(as_user(BEHANDELAAR, f"update public.careon_scribe_notities set secties="
                                     f"{literal(secties('Achteraf herschreven.'))} where id='{NOTITIE}'"),
                "onwijzigbaar", "een goedgekeurd verslag wordt niet meer bewerkt")
        refused(as_user(BEHANDELAAR, f"delete from public.careon_scribe_notities where id='{NOTITIE}'"),
                "niet los van het consult", "een goedgekeurd verslag verdwijnt niet los van het consult")

        # ── Goedkeuren en overnemen: synchroon wissen van het transcript ────
        # De overgang naar 'goedgekeurd' is hierboven al door de goedkeuring-RPC
        # gedaan (C12/C34); een tweede poging hoort dus te worden geweigerd.
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_status_zetten('{SESSIE}','goedgekeurd')"),
                "niet toegestaan", "goedgekeurd -> goedgekeurd is geen geldige overgang")
        overgenomen = json.loads(db.sql(as_user(BEHANDELAAR,
            f"select public.careon_scribe_status_zetten('{SESSIE}','overgenomen')")).splitlines()[-1])
        equal(overgenomen["status"], "overgenomen", "goedgekeurd -> overgenomen via de RPC")
        query(BEHANDELAAR, "select count(*) from public.careon_scribe_segmenten", 0,
              "het transcript is bij overname direct gewist")
        query(BEHANDELAAR, "select count(*) from public.careon_scribe_staat", 0,
              "de consultstaat is bij overname direct gewist")
        query(BEHANDELAAR, "select count(*) from public.careon_scribe_notities", 1,
              "het goedgekeurde verslag blijft na overname staan")
        query(BEHANDELAAR,
              f"select transcript_verwijder_na <= now() and sessie_verwijder_na > now() "
              f"from public.careon_scribe_sessies where id='{SESSIE}'",
              "t", "het transcript volgt altijd de kortste termijn")
        refused(as_user(BEHANDELAAR, f"select public.careon_scribe_voeg_segmenten_toe('{SESSIE}',null,"
                                     f"{literal(segmenten('Te laat.'))},0,false)"),
                "geen nieuwe segmenten", "een overgenomen consult neemt geen segmenten meer aan")

        # ── Vrijgave: de ontvanger leest uitsluitend het goedgekeurde verslag
        refused(as_user(BEHEERDER, f"insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id) "
                                   f"values ('{SESSIE}','{ORG}','{COLLEGA}','{BEHEERDER}')"),
                "42501", "een caller-JWT kan geen vrijgave registreren")
        # C9 — een beheerder geeft een verslag NOOIT aan zichzelf vrij. De insert
        # loopt via de service-role en slaat RLS dus over; alleen een CHECK houdt
        # dit tegen. Zonder die grens is de offboarding een leeskanaal naar elk
        # verslag van elke collega.
        refused(as_service(f"insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id) "
                           f"values ('{SESSIE}','{ORG}','{BEHEERDER}','{BEHEERDER}')"),
                "careon_scribe_vrijgaven_niet_zelf", "een beheerder geeft een verslag niet aan zichzelf vrij")
        db.sql(as_service(f"insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id,reden) "
                          f"values ('{SESSIE}','{ORG}','{COLLEGA}','{BEHEERDER}','Synthetische offboarding')"))
        db.sql(as_user(BEHANDELAAR,
            f"insert into public.careon_scribe_notities(sessie_id,org_id,behandelaar_id,versie,formaat,secties) "
            f"values ('{SESSIE}','{ORG}','{BEHANDELAAR}',2,'soap',{literal(secties('Concept.'))})"))
        query(COLLEGA, "select count(*) from public.careon_scribe_sessies", 1,
              "de vrijgave-ontvanger ziet het vrijgegeven consult")
        query(COLLEGA, "select count(*) from public.careon_scribe_notities where status='goedgekeurd'", 1,
              "de vrijgave-ontvanger leest het goedgekeurde verslag")
        query(COLLEGA, "select count(*) from public.careon_scribe_notities where status='concept'", 0,
              "de vrijgave-ontvanger leest geen conceptversie")
        query(COLLEGA, "select count(*) from public.careon_scribe_segmenten", 0,
              "de vrijgave-ontvanger leest nooit het transcript")
        # Een update-policy filtert rijen stil weg: de schrijfpoging raakt niets.
        query(COLLEGA,
              f"with gewijzigd as (update public.careon_scribe_notities set secties="
              f"{literal(secties('Door de ontvanger gewijzigd.'))} where id='{NOTITIE}' returning 1) "
              f"select count(*) from gewijzigd",
              0, "de vrijgave-ontvanger schrijft niet in het verslag")

        # C1 — de vrijgave-tak droeg geen rolpredicaat, dus wie eenmaal een
        # vrijgave had, hield leesrecht op het volledige verslag ook nadat zijn
        # machtiging of zijn lidmaatschap was ingetrokken. Een vrijgave is een
        # uitzondering, geen permanente toekenning.
        db.sql(as_user(BEHEERDER, f"delete from public.careon_scribe_gemachtigden "
                                  f"where org_id='{ORG}' and user_id='{COLLEGA}'"))
        query(COLLEGA, "select count(*) from public.careon_scribe_notities", 0,
              "een ingetrokken machtiging sluit ook het vrijgegeven verslag")
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_gemachtigden(org_id,user_id,toegekend_door) "
                                  f"values ('{ORG}','{COLLEGA}','{BEHEERDER}')"))
        query(COLLEGA, "select count(*) from public.careon_scribe_notities where status='goedgekeurd'", 1,
              "met de machtiging terug leest de ontvanger het verslag weer")
        db.sql(as_service(f"delete from public.organization_members where org_id='{ORG}' and user_id='{COLLEGA}'"))
        query(COLLEGA, "select count(*) from public.careon_scribe_notities", 0,
              "een verwijderd lidmaatschap sluit het vrijgegeven verslag")
        db.sql(as_service(f"insert into public.organization_members(org_id,user_id,role) "
                          f"values ('{ORG}','{COLLEGA}','member')"))
        # De intrekking zelf (N11): de beheerder mag de vrijgaverij verwijderen
        # onder zijn eigen JWT, en daarmee sluit de toegang meteen.
        query(BEHEERDER,
              f"with weg as (delete from public.careon_scribe_vrijgaven where sessie_id='{SESSIE}' "
              f"and aan_user_id='{COLLEGA}' returning 1) select count(*) from weg",
              1, "de beheerder trekt een vrijgave in onder zijn eigen JWT")
        query(COLLEGA, "select count(*) from public.careon_scribe_notities", 0,
              "een ingetrokken vrijgave sluit het verslag")
        query(COLLEGA, "select count(*) from public.careon_scribe_sessies", 0,
              "en ook de sessierij van het vrijgegeven consult")
        db.sql(as_service(f"insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id,reden) "
                          f"values ('{SESSIE}','{ORG}','{COLLEGA}','{BEHEERDER}','Synthetische offboarding')"))

        # ── Opschoning ──────────────────────────────────────────────────────
        db.sql(as_user(BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) "
                                  f"values ('{ORG}',{literal(instellingen())},4)"))
        db.sql(as_user(BEHANDELAAR, start(TWEEDE, BEHANDELAAR)))
        db.sql(as_user(BEHANDELAAR, f"select public.careon_scribe_voeg_segmenten_toe('{TWEEDE}',null,"
                                    f"{literal(segmenten('Synthetische regel.'))},4000,true)"))
        db.sql(as_user(BEHANDELAAR,
            f"insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat) "
            f"values ('{TWEEDE}','{ORG}','{BEHANDELAAR}',{literal(lege_staat())})"))
        query(BEHANDELAAR, f"select ontbrekende_fragmenten from public.careon_scribe_sessies where id='{TWEEDE}'",
              1, "een ontbrekend fragment wordt geteld")
        refused(as_user(BEHANDELAAR, "select public.careon_prune_scribe()"), "42501",
                "opschonen is voorbehouden aan de service-role")
        db.sql(as_service(f"update public.careon_scribe_sessies set transcript_verwijder_na=now()-interval '1 minute' "
                          f"where id='{TWEEDE}'"))
        opgeschoond = json.loads(db.sql(as_service("select public.careon_prune_scribe()")).splitlines()[-1])
        equal(opgeschoond["segmenten_verwijderd"], 1, "de opschoning wist het verlopen transcript")
        equal(opgeschoond["staat_verwijderd"], 1, "de opschoning wist de verlopen consultstaat")
        equal(opgeschoond["sessies_verwijderd"], 0, "de sessiemetadata blijft binnen haar eigen termijn staan")
        equal(db.sql(as_service(f"select count(*) from public.careon_scribe_sessies where id='{TWEEDE}'")), 1,
              "het consult zelf staat er na de transcriptopschoning nog")
        db.sql(as_service(f"update public.careon_scribe_sessies set sessie_verwijder_na=now()-interval '1 minute' "
                          f"where id='{TWEEDE}'"))
        equal(json.loads(db.sql(as_service("select public.careon_prune_scribe()")).splitlines()[-1])["sessies_verwijderd"],
              1, "de opschoning wist het consult op de tweede termijn")
        equal(db.sql(as_service(f"select count(*) from public.careon_scribe_sessies where id='{TWEEDE}'")), 0,
              "de sessiemetadata is verdwenen")
        # Verlaten consulten worden afgerond met de retentie uit de instellingen.
        db.sql(as_user(BEHANDELAAR, start(TWEEDE, BEHANDELAAR)))
        db.sql(as_service(f"update public.careon_scribe_sessies set updated_at=now()-interval '2 days' "
                          f"where id='{TWEEDE}'"))
        equal(json.loads(db.sql(as_service("select public.careon_prune_scribe()")).splitlines()[-1])["verlaten_afgerond"],
              1, "een verlaten consult wordt afgerond")
        equal(db.sql(as_service(f"select status from public.careon_scribe_sessies where id='{TWEEDE}'")), "afgerond",
              "het verlaten consult staat op 'afgerond'")

        # ── Annuleren wist synchroon ────────────────────────────────────────
        db.sql(as_service(f"delete from public.careon_scribe_sessies where id='{TWEEDE}'"))
        db.sql(as_user(BEHANDELAAR, start(TWEEDE, BEHANDELAAR)))
        db.sql(as_user(BEHANDELAAR, f"select public.careon_scribe_voeg_segmenten_toe('{TWEEDE}',null,"
                                    f"{literal(segmenten('Synthetische regel.'))},4000,false)"))
        db.sql(as_user(BEHANDELAAR, f"select public.careon_scribe_status_zetten('{TWEEDE}','geannuleerd')"))
        query(BEHANDELAAR, f"select count(*) from public.careon_scribe_segmenten where sessie_id='{TWEEDE}'", 0,
              "annuleren wist het transcript direct")
        query(BEHANDELAAR,
              f"select transcript_verwijder_na <= now() and sessie_verwijder_na <= now() + interval '1 day' "
              f"from public.careon_scribe_sessies where id='{TWEEDE}'",
              "t", "een geannuleerd consult verdwijnt bij de eerstvolgende opschoning")

        # ── Structurele eisen: restrictieve policy, geen definer-RPC, quota ──
        tabellen = "','".join(SCRIBE_TABELLEN)
        equal(db.sql(f"""
          select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname in ('{tabellen}') and c.relrowsecurity
            and exists (
              select 1 from pg_policy p where p.polrelid=c.oid
                and p.polname='careon_active_account' and not p.polpermissive
                and p.polcmd='*' and 'authenticated'::regrole::oid=any(p.polroles)
                and pg_get_expr(p.polqual,p.polrelid) like '%app.is_active_user()%'
                and pg_get_expr(p.polwithcheck,p.polrelid) like '%app.is_active_user()%')
        """), 8, "alle acht scribe-tabellen dragen RLS en de restrictieve careon_active_account-policy")
        equal(db.sql(f"""
          select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname in ('{tabellen}')
            and has_table_privilege('anon',c.oid,'SELECT')
        """), 0, "anon heeft nergens leesrecht op de scribe-tabellen")
        equal(db.sql("""
          select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname like 'careon_scribe%' and p.prosecdef
            and has_function_privilege('authenticated',p.oid,'EXECUTE')
        """), 0, "geen enkele scribe-RPC omzeilt de policies als definer voor authenticated")
        equal(db.sql("""
          select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='careon_prune_scribe'
            and (has_function_privilege('authenticated',p.oid,'EXECUTE')
              or has_function_privilege('anon',p.oid,'EXECUTE'))
        """), 0, "de opschoon-RPC is uitsluitend voor de service-role")
        toegestaan = json.loads(db.sql(as_service(
            "select public.careon_consume_assistant_quota('scribe',repeat('a',32),10,100)")).splitlines()[-1])
        equal(toegestaan["allowed"], True, "quota-scope 'scribe' wordt geaccepteerd")
        equal(db.sql(as_service("select count(*) from public.careon_assistant_rate_limits where scope='scribe'")), 1,
              "de CHECK-constraint laat de scope 'scribe' door")
        refused(as_service("select public.careon_consume_assistant_quota('bogus',repeat('a',32),10,100)"),
                "invalid quota parameters", "een onbekende quota-scope wordt geweigerd")

        # ── Een geblokkeerd account verliest ook zijn eigen consulten ───────
        db.sql(f"update auth.users set banned_until=now()+interval '1 day' where id='{BEHANDELAAR}'")
        query(BEHANDELAAR, "select count(*) from public.careon_scribe_sessies", 0,
              "een geblokkeerde behandelaar leest zijn eigen consulten niet meer")
        query(BEHANDELAAR, f"select app.mag_scribe_gebruiken('{ORG}')", "f",
              "een geblokkeerde behandelaar valt buiten de module")

        # Exercise an actual additive upgrade after the original 105-contract
        # baseline. The audit tests below run with the NEW migration active.
        baseline_checks = checks
        db.apply(MIGRATIONS / "20260910120000_scribe_audit_integrity.sql")
        from scribe_integrity import verify_integrity
        checks += verify_integrity(db)
        integrity_checks = checks - baseline_checks
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if "20260910120000_scribe_audit_integrity.sql" < migration.name <= "20260911180611_scribe_conversation_context.sql":
                db.apply(migration)
        from scribe_context import verify_context
        context_checks = verify_context(db)
        legacy_segments = int(db.sql("select count(*) from public.careon_scribe_segmenten"))
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if "20260911180611_scribe_conversation_context.sql" < migration.name <= "20260911182326_scribe_speaker_provenance.sql":
                db.apply(migration)
        from scribe_speaker_provenance import verify_speaker_provenance
        speaker_checks = verify_speaker_provenance(db, legacy_segments)
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name > "20260911182326_scribe_speaker_provenance.sql":
                db.apply(migration)
        from scribe_english_drafts import verify_english_drafts
        draft_checks = verify_english_drafts(db)

    # A separate fresh chain prevents an upgrade-only test from hiding missing
    # dependencies or accidental migration reordering.
    with LocalPostgres(port, user, prefix="careon_scribe_fresh_regression") as db:
        db.bootstrap_supabase()
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name != TOKEN_HOOK:
                db.apply(migration)
        fresh_checks = verify_context(db)
        fresh_speaker_checks = verify_speaker_provenance(db)
        fresh_draft_checks = verify_english_drafts(db)

    print(f"verify-scribe-postgres: {baseline_checks} base-schema + {integrity_checks} audit upgrade + {context_checks} context upgrade + {speaker_checks} provenance upgrade + {draft_checks} factual-draft upgrade + {fresh_checks + fresh_speaker_checks + fresh_draft_checks} fresh-chain checks passed; synthetic databases removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--user", required=True)
    options = parser.parse_args()
    run(options.port, options.user)
