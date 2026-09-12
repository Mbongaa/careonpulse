# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: careon.spec.ts >> scribe (demo-pad, handoff 20) >> consultstaat corrigeren: feit intrekken en de EPD-lijst overnemen
- Location: e2e\careon.spec.ts:1108:7

# Error details

```
Error: locator.check: Clicking the checkbox did not change its state
Call log:
  - waiting for getByRole('region', { name: 'AI-notities' }).first().getByLabel('Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.')
    - locator resolved to <button value="on" id="_r_s_" type="button" role="checkbox" aria-checked="false" data-slot="checkbox" data-state="unchecked" class="peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-in…></button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action
    - click action done
    - waiting for scheduled navigations to finish
    - navigations have finished

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - img [ref=e7]
          - generic [ref=e11]:
            - generic [ref=e12]: Careon Pulse
            - generic [ref=e13]: Technology · Growth · Care
        - generic [ref=e14]:
          - paragraph [ref=e15]: Careon Scribe
          - paragraph [ref=e16]: TGC Groep
      - generic [ref=e17]:
        - link "Naar modules" [ref=e18] [cursor=pointer]:
          - /url: /modules
        - button "Uitloggen" [ref=e20]:
          - img
          - text: Uitloggen
    - navigation "Careon Scribe" [ref=e21]:
      - link "Consulten" [ref=e22] [cursor=pointer]:
        - /url: /scribe
      - link "Logboek" [ref=e23] [cursor=pointer]:
        - /url: /scribe/logboek
      - link "Instellingen" [ref=e24] [cursor=pointer]:
        - /url: /scribe/instellingen
    - main [ref=e25]:
      - generic [ref=e26]:
        - generic [ref=e27]:
          - generic [ref=e28]:
            - heading "D-2026-0417 Psychiatrisch consult" [level=1] [ref=e29]:
              - text: D-2026-0417
              - generic [ref=e30]: Psychiatrisch consult
            - paragraph [ref=e31]: Loopt 3766:56
          - generic [ref=e32]:
            - button "Consult afronden" [ref=e33]:
              - img
              - text: Consult afronden
            - button "Annuleren" [ref=e34]:
              - img
              - text: Annuleren
        - paragraph [ref=e35]: Lokale demo-opslag — geen centrale registratie.
        - paragraph [ref=e36]: 2 middel(en) en 1 allergie(ën) uit het EPD toegevoegd aan de consultstaat. Controleer de lijst en bevestig daarna uw beoordeling.
        - generic [ref=e37]:
          - generic [ref=e38]:
            - button "Demo-opname" [disabled]:
              - img
              - text: Demo-opname
            - button "Volledig afspelen" [disabled]:
              - img
              - text: Volledig afspelen
            - generic [ref=e39]: Het demo-consult is volledig afgespeeld
          - paragraph [ref=e40]: "Demo-opname: er wordt geen microfoon gebruikt en er wordt geen audio verwerkt."
        - generic [ref=e41]:
          - region "Transcript" [ref=e42]:
            - generic [ref=e43]:
              - heading "Transcript" [level=2] [ref=e44]
              - generic [ref=e45]: 30 regels
            - generic [ref=e46]:
              - region "Transcriptregels" [ref=e47]:
                - list [ref=e48]:
                  - listitem [ref=e49]:
                    - generic [ref=e50]:
                      - generic [ref=e51]: 00:00
                      - 'button "Spreker van regel 1: Arts — wijzigen" [ref=e52]': Arts
                    - generic [ref=e53]:
                      - paragraph [ref=e54]:
                        - generic [ref=e55]: §1
                        - text: Goedemiddag, fijn dat u er bent. Waarvoor komt u vandaag bij mij?
                      - button "Tekst corrigeren" [ref=e57]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e58]:
                    - generic [ref=e59]:
                      - generic [ref=e60]: 00:08
                      - 'button "Spreker van regel 2: Patiënt — wijzigen" [ref=e61]': Patiënt
                    - generic [ref=e62]:
                      - paragraph [ref=e63]:
                        - generic [ref=e64]: §2
                        - text: Ik voel me al een tijd erg somber en ik krijg bijna niets meer gedaan.
                      - button "Tekst corrigeren" [ref=e66]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e67]:
                    - generic [ref=e68]:
                      - generic [ref=e69]: 00:16
                      - 'button "Spreker van regel 3: Arts — wijzigen" [ref=e70]': Arts
                    - generic [ref=e71]:
                      - paragraph [ref=e72]:
                        - generic [ref=e73]: §3
                        - text: Hoe lang speelt die somberheid al?
                      - button "Tekst corrigeren" [ref=e75]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e76]:
                    - generic [ref=e77]:
                      - generic [ref=e78]: 00:24
                      - 'button "Spreker van regel 4: Patiënt — wijzigen" [ref=e79]': Patiënt
                    - generic [ref=e80]:
                      - paragraph [ref=e81]:
                        - generic [ref=e82]: §4
                        - text: Sinds drie maanden ongeveer, en het wordt geleidelijk erger.
                      - button "Tekst corrigeren" [ref=e84]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e85]:
                    - generic [ref=e86]:
                      - generic [ref=e87]: 00:32
                      - 'button "Spreker van regel 5: Patiënt — wijzigen" [ref=e88]': Patiënt
                    - generic [ref=e89]:
                      - paragraph [ref=e90]:
                        - generic [ref=e91]: §5
                        - text: Ik slaap heel slecht, ik lig uren wakker en ik pieker de hele nacht door.
                      - button "Tekst corrigeren" [ref=e93]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e94]:
                    - generic [ref=e95]:
                      - generic [ref=e96]: 00:40
                      - 'button "Spreker van regel 6: Arts — wijzigen" [ref=e97]': Arts
                    - generic [ref=e98]:
                      - paragraph [ref=e99]:
                        - generic [ref=e100]: §6
                        - text: En hoe is uw eetlust?
                      - button "Tekst corrigeren" [ref=e102]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e103]:
                    - generic [ref=e104]:
                      - generic [ref=e105]: 00:48
                      - 'button "Spreker van regel 7: Patiënt — wijzigen" [ref=e106]': Patiënt
                    - generic [ref=e107]:
                      - paragraph [ref=e108]:
                        - generic [ref=e109]: §7
                        - text: Mijn eetlust is verminderd, ik ben ongeveer vier kilo afgevallen.
                      - button "Tekst corrigeren" [ref=e111]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e112]:
                    - generic [ref=e113]:
                      - generic [ref=e114]: 00:56
                      - 'button "Spreker van regel 8: Arts — wijzigen" [ref=e115]': Arts
                    - generic [ref=e116]:
                      - paragraph [ref=e117]:
                        - generic [ref=e118]: §8
                        - text: Zijn er dingen die het erger maken?
                      - button "Tekst corrigeren" [ref=e120]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e121]:
                    - generic [ref=e122]:
                      - generic [ref=e123]: 01:04
                      - 'button "Spreker van regel 9: Patiënt — wijzigen" [ref=e124]': Patiënt
                    - generic [ref=e125]:
                      - paragraph [ref=e126]:
                        - generic [ref=e127]: §9
                        - text: Werkstress vooral; er is een reorganisatie op mijn werk en de druk is hoog.
                      - button "Tekst corrigeren" [ref=e129]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e130]:
                    - generic [ref=e131]:
                      - generic [ref=e132]: 01:12
                      - 'button "Spreker van regel 10: Patiënt — wijzigen" [ref=e133]': Patiënt
                    - generic [ref=e134]:
                      - paragraph [ref=e135]:
                        - generic [ref=e136]: §10
                        - text: Als ik ga wandelen met mijn hond voelt het even wat lichter.
                      - button "Tekst corrigeren" [ref=e138]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e139]:
                    - generic [ref=e140]:
                      - generic [ref=e141]: 01:20
                      - 'button "Spreker van regel 11: Arts — wijzigen" [ref=e142]': Arts
                    - generic [ref=e143]:
                      - paragraph [ref=e144]:
                        - generic [ref=e145]: §11
                        - text: Gebruikt u alcohol of andere middelen?
                      - button "Tekst corrigeren" [ref=e147]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e148]:
                    - generic [ref=e149]:
                      - generic [ref=e150]: 01:28
                      - 'button "Spreker van regel 12: Patiënt — wijzigen" [ref=e151]': Patiënt
                    - generic [ref=e152]:
                      - paragraph [ref=e153]:
                        - generic [ref=e154]: §12
                        - text: In het weekend drink ik vier glazen wijn op een avond, doordeweeks niet. Roken doe ik niet.
                      - button "Tekst corrigeren" [ref=e156]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e157]:
                    - generic [ref=e158]:
                      - generic [ref=e159]: 01:36
                      - 'button "Spreker van regel 13: Arts — wijzigen" [ref=e160]': Arts
                    - generic [ref=e161]:
                      - paragraph [ref=e162]:
                        - generic [ref=e163]: §13
                        - text: "Ik wil u iets vragen wat ik iedereen vraag: denkt u er weleens aan om een einde aan uw leven te maken?"
                      - button "Tekst corrigeren" [ref=e165]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e166]:
                    - generic [ref=e167]:
                      - generic [ref=e168]: 01:44
                      - 'button "Spreker van regel 14: Patiënt — wijzigen" [ref=e169]': Patiënt
                    - generic [ref=e170]:
                      - paragraph [ref=e171]:
                        - generic [ref=e172]: §14
                        - text: Nee, daar denk ik niet aan. Ik wil gewoon dat het beter gaat.
                      - button "Tekst corrigeren" [ref=e174]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e175]:
                    - generic [ref=e176]:
                      - generic [ref=e177]: 01:52
                      - 'button "Spreker van regel 15: Arts — wijzigen" [ref=e178]': Arts
                    - generic [ref=e179]:
                      - paragraph [ref=e180]:
                        - generic [ref=e181]: §15
                        - text: Welke medicijnen gebruikt u op dit moment?
                      - button "Tekst corrigeren" [ref=e183]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e184]:
                    - generic [ref=e185]:
                      - generic [ref=e186]: 02:00
                      - 'button "Spreker van regel 16: Patiënt — wijzigen" [ref=e187]': Patiënt
                    - generic [ref=e188]:
                      - paragraph [ref=e189]:
                        - generic [ref=e190]: §16
                        - text: Ik gebruik sertraline vijftig milligram, sinds zes weken.
                      - button "Tekst corrigeren" [ref=e192]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e193]:
                    - generic [ref=e194]:
                      - generic [ref=e195]: 02:08
                      - 'button "Spreker van regel 17: Patiënt — wijzigen" [ref=e196]': Patiënt
                    - generic [ref=e197]:
                      - paragraph [ref=e198]:
                        - generic [ref=e199]: §17
                        - text: En sinds vorige week gebruik ik tramadol voor mijn rugpijn.
                      - button "Tekst corrigeren" [ref=e201]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e202]:
                    - generic [ref=e203]:
                      - generic [ref=e204]: 02:16
                      - 'button "Spreker van regel 18: Arts — wijzigen" [ref=e205]': Arts
                    - generic [ref=e206]:
                      - paragraph [ref=e207]:
                        - generic [ref=e208]: §18
                        - text: Bent u ergens allergisch voor?
                      - button "Tekst corrigeren" [ref=e210]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e211]:
                    - generic [ref=e212]:
                      - generic [ref=e213]: 02:24
                      - 'button "Spreker van regel 19: Patiënt — wijzigen" [ref=e214]': Patiënt
                    - generic [ref=e215]:
                      - paragraph [ref=e216]:
                        - generic [ref=e217]: §19
                        - text: Ik ben allergisch voor amoxicilline, daar krijg ik uitslag van.
                      - button "Tekst corrigeren" [ref=e219]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e220]:
                    - generic [ref=e221]:
                      - generic [ref=e222]: 02:32
                      - 'button "Spreker van regel 20: Arts — wijzigen" [ref=e223]': Arts
                    - generic [ref=e224]:
                      - paragraph [ref=e225]:
                        - generic [ref=e226]: §20
                        - text: Bent u eerder behandeld voor psychische klachten, en komt er in uw familie iets voor?
                      - button "Tekst corrigeren" [ref=e228]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e229]:
                    - generic [ref=e230]:
                      - generic [ref=e231]: 02:40
                      - 'button "Spreker van regel 21: Patiënt — wijzigen" [ref=e232]': Patiënt
                    - generic [ref=e233]:
                      - paragraph [ref=e234]:
                        - generic [ref=e235]: §21
                        - text: In 2022 heb ik een burn-out gehad, toen ben ik drie maanden thuis geweest.
                      - button "Tekst corrigeren" [ref=e237]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e238]:
                    - generic [ref=e239]:
                      - generic [ref=e240]: 02:48
                      - 'button "Spreker van regel 22: Patiënt — wijzigen" [ref=e241]': Patiënt
                    - generic [ref=e242]:
                      - paragraph [ref=e243]:
                        - generic [ref=e244]: §22
                        - text: Mijn moeder heeft een depressie gehad toen ik jong was.
                      - button "Tekst corrigeren" [ref=e246]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e247]:
                    - generic [ref=e248]:
                      - generic [ref=e249]: 02:56
                      - 'button "Spreker van regel 23: Arts — wijzigen" [ref=e250]': Arts
                    - generic [ref=e251]:
                      - paragraph [ref=e252]:
                        - generic [ref=e253]: §23
                        - text: Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.
                      - button "Tekst corrigeren" [ref=e255]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e256]:
                    - generic [ref=e257]:
                      - generic [ref=e258]: 03:04
                      - 'button "Spreker van regel 24: Arts — wijzigen" [ref=e259]': Arts
                    - generic [ref=e260]:
                      - paragraph [ref=e261]:
                        - generic [ref=e262]: §24
                        - text: De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen.
                      - button "Tekst corrigeren" [ref=e264]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e265]:
                    - generic [ref=e266]:
                      - generic [ref=e267]: 03:12
                      - 'button "Spreker van regel 25: Arts — wijzigen" [ref=e268]': Arts
                    - generic [ref=e269]:
                      - paragraph [ref=e270]:
                        - generic [ref=e271]: §25
                        - text: Ik wil de sertraline ophogen naar honderd milligram.
                      - button "Tekst corrigeren" [ref=e273]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e274]:
                    - generic [ref=e275]:
                      - generic [ref=e276]: 03:20
                      - 'button "Spreker van regel 26: Arts — wijzigen" [ref=e277]': Arts
                    - generic [ref=e278]:
                      - paragraph [ref=e279]:
                        - generic [ref=e280]: §26
                        - text: Ik vraag via de huisarts een TSH-bepaling aan om de schildklier te laten controleren.
                      - button "Tekst corrigeren" [ref=e282]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e283]:
                    - generic [ref=e284]:
                      - generic [ref=e285]: 03:28
                      - 'button "Spreker van regel 27: Arts — wijzigen" [ref=e286]': Arts
                    - generic [ref=e287]:
                      - paragraph [ref=e288]:
                        - generic [ref=e289]: §27
                        - text: Ik overleg met de huisarts over de tramadol.
                      - button "Tekst corrigeren" [ref=e291]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e292]:
                    - generic [ref=e293]:
                      - generic [ref=e294]: 03:36
                      - 'button "Spreker van regel 28: Arts — wijzigen" [ref=e295]': Arts
                    - generic [ref=e296]:
                      - paragraph [ref=e297]:
                        - generic [ref=e298]: §28
                        - text: We doen psycho-educatie en ik geef u adviezen over slaaphygiëne.
                      - button "Tekst corrigeren" [ref=e300]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e301]:
                    - generic [ref=e302]:
                      - generic [ref=e303]: 03:44
                      - 'button "Spreker van regel 29: Arts — wijzigen" [ref=e304]': Arts
                    - generic [ref=e305]:
                      - paragraph [ref=e306]:
                        - generic [ref=e307]: §29
                        - text: We maken een vervolgafspraak over twee weken.
                      - button "Tekst corrigeren" [ref=e309]:
                        - img
                        - text: Tekst corrigeren
                  - listitem [ref=e310]:
                    - generic [ref=e311]:
                      - generic [ref=e312]: 03:52
                      - 'button "Spreker van regel 30: Patiënt — wijzigen" [ref=e313]': Patiënt
                    - generic [ref=e314]:
                      - paragraph [ref=e315]:
                        - generic [ref=e316]: §30
                        - text: Dat is goed, dank u wel.
                      - button "Tekst corrigeren" [ref=e318]:
                        - img
                        - text: Tekst corrigeren
              - button "Nieuwe regels" [ref=e319]:
                - img
                - text: Nieuwe regels
            - generic [ref=e320]:
              - generic [ref=e321]: Gesprekstekst handmatig toevoegen
              - textbox "Gesprekstekst handmatig toevoegen" [ref=e322]:
                - /placeholder: Typ wat er is gezegd…
              - generic [ref=e323]:
                - generic [ref=e324]:
                  - generic [ref=e325]: Spreker
                  - generic [ref=e326]:
                    - combobox "Spreker" [ref=e327]:
                      - option "Arts" [selected]
                      - option "Patiënt"
                      - option "Overig"
                      - option "Onbekend"
                    - img
                - button "Regel toevoegen" [disabled]:
                  - img
                  - text: Regel toevoegen
          - region "AI-notities" [ref=e328]:
            - generic [ref=e329]:
              - heading "Notities" [level=2] [ref=e330]
              - generic [ref=e331]:
                - generic [ref=e332]: Demo
                - button "Nu analyseren" [ref=e333]:
                  - img
                  - text: Nu analyseren
            - region "AI-notities" [ref=e334]:
              - generic [ref=e335]:
                - paragraph [ref=e336]: Somberheid sinds drie maanden.
                - generic [ref=e337]:
                  - generic [ref=e338]:
                    - term [ref=e339]: Hoofdklacht
                    - definition [ref=e340]:
                      - list [ref=e341]:
                        - listitem [ref=e342]: somberheid
                  - generic [ref=e343]:
                    - term [ref=e344]: Duur
                    - definition [ref=e345]:
                      - list [ref=e346]:
                        - listitem [ref=e347]: drie maanden
                  - generic [ref=e348]:
                    - term [ref=e349]: Beloop
                    - definition [ref=e350]:
                      - list [ref=e351]:
                        - listitem [ref=e352]: geleidelijk erger
                  - generic [ref=e353]:
                    - term [ref=e354]: Ernst
                    - definition [ref=e355]: Nog niet besproken
                  - generic [ref=e356]:
                    - term [ref=e357]: Symptomen
                    - definition [ref=e358]:
                      - list [ref=e359]:
                        - listitem [ref=e360]:
                          - text: somberheid
                          - button "Toon transcriptregel 2" [ref=e362]: §2
                          - 'button "Intrekken: somberheid" [ref=e363]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e364]:
                          - text: piekeren
                          - button "Toon transcriptregel 5" [ref=e366]: §5
                          - 'button "Intrekken: piekeren" [ref=e367]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e368]:
                          - text: verminderde eetlust
                          - button "Toon transcriptregel 7" [ref=e370]: §7
                          - 'button "Intrekken: verminderde eetlust" [ref=e371]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e372]:
                          - text: rugpijn
                          - button "Toon transcriptregel 17" [ref=e374]: §17
                          - 'button "Intrekken: rugpijn" [ref=e375]':
                            - img
                            - text: Intrekken
                  - generic [ref=e376]:
                    - term [ref=e377]: Begeleidende symptomen
                    - definition [ref=e378]:
                      - list [ref=e379]:
                        - listitem [ref=e380]:
                          - text: ongeveer vier kilo afgevallen
                          - button "Toon transcriptregel 7" [ref=e382]: §7
                          - 'button "Intrekken: ongeveer vier kilo afgevallen" [ref=e383]':
                            - img
                            - text: Intrekken
                  - generic [ref=e384]:
                    - term [ref=e385]: Uitlokkende factoren
                    - definition [ref=e386]:
                      - list [ref=e387]:
                        - listitem [ref=e388]:
                          - text: er is een reorganisatie op mijn werk en de druk is hoog
                          - button "Toon transcriptregel 9" [ref=e390]: §9
                          - 'button "Intrekken: er is een reorganisatie op mijn werk en de druk is hoog" [ref=e391]':
                            - img
                            - text: Intrekken
                  - generic [ref=e392]:
                    - term [ref=e393]: Verlichtende factoren
                    - definition [ref=e394]: Nog niet besproken
                  - generic [ref=e395]:
                    - term [ref=e396]: Medicatie
                    - definition [ref=e397]:
                      - list [ref=e398]:
                        - listitem [ref=e399]:
                          - text: sertraline 50 mg (huidig)
                          - button "Toon transcriptregel 16" [ref=e401]: §16
                          - 'button "Intrekken: sertraline 50 mg (huidig)" [ref=e402]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e403]:
                          - text: tramadol (huidig)
                          - generic [ref=e404]:
                            - button "Toon transcriptregel 17" [ref=e405]: §17
                            - button "Toon transcriptregel 24" [ref=e406]: §24
                            - button "Toon transcriptregel 27" [ref=e407]: §27
                        - listitem [ref=e408]:
                          - text: sertraline 100 mg (voorgesteld)
                          - button "Toon transcriptregel 25" [ref=e410]: §25
                          - 'button "Intrekken: sertraline 100 mg (voorgesteld)" [ref=e411]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e412]:
                          - text: lorazepam 1 mg (huidig)
                          - generic [ref=e413]: Zelf aangevuld
                          - 'button "Intrekken: lorazepam 1 mg (huidig)" [ref=e414]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e415]:
                          - text: lithium 400 mg (huidig)
                          - generic [ref=e416]: Zelf aangevuld
                          - 'button "Intrekken: lithium 400 mg (huidig)" [ref=e417]':
                            - img
                            - text: Intrekken
                  - generic [ref=e418]:
                    - term [ref=e419]: Allergieën
                    - definition [ref=e420]:
                      - list [ref=e421]:
                        - listitem [ref=e422]:
                          - text: amoxicilline (allergie)
                          - button "Toon transcriptregel 19" [ref=e424]: §19
                          - generic [ref=e425]: Zelf aangevuld
                          - 'button "Intrekken: amoxicilline (allergie)" [ref=e426]':
                            - img
                            - text: Intrekken
                    - definition [ref=e427]:
                      - generic [ref=e428]:
                        - paragraph [ref=e429]: Zelf aanvullen
                        - generic [ref=e430]:
                          - generic [ref=e431]:
                            - generic [ref=e432]: Middel
                            - textbox "Middel" [ref=e433]:
                              - /placeholder: Bijv. sertraline
                          - generic [ref=e434]:
                            - generic [ref=e435]: Dosering
                            - textbox "Dosering" [ref=e436]:
                              - /placeholder: Bijv. 50 mg
                          - generic [ref=e437]:
                            - generic [ref=e438]: Gebruik
                            - generic [ref=e439]:
                              - combobox "Gebruik" [ref=e440]:
                                - option "Huidig gebruik" [selected]
                                - option "Gestopt"
                                - option "Voorgesteld"
                                - option "Onbekend"
                              - img
                        - button "Medicatie toevoegen" [disabled]
                        - generic [ref=e441]:
                          - generic [ref=e442]:
                            - generic [ref=e443]: Allergie of intolerantie
                            - textbox "Allergie of intolerantie" [ref=e444]:
                              - /placeholder: Bijv. amoxicilline
                          - generic [ref=e445]:
                            - generic [ref=e446]: Aard
                            - generic [ref=e447]:
                              - combobox "Aard" [ref=e448]:
                                - option "Allergie" [selected]
                                - option "Intolerantie"
                                - option "Onbekend"
                              - img
                        - button "Allergie toevoegen" [disabled]
                      - generic [ref=e449]:
                        - generic [ref=e450]:
                          - generic [ref=e451]: Actuele medicatie & allergieën uit het EPD
                          - generic [ref=e452]: Beoordeeld
                        - button "EPD-lijst plakken" [ref=e453]
                        - generic [ref=e454]:
                          - checkbox "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen." [checked] [disabled] [ref=e455]:
                            - generic:
                              - img
                          - generic [ref=e456]: Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.
                        - paragraph [ref=e457]: De lijst blijft in dit consult; Careon haalt niets uit het EPD op en schrijft er niets naartoe.
                  - generic [ref=e458]:
                    - term [ref=e459]: Voorgeschiedenis
                    - definition [ref=e460]:
                      - list [ref=e461]:
                        - listitem [ref=e462]:
                          - text: In 2022 heb ik een burn-out gehad, toen ben ik drie maanden thuis geweest
                          - button "Toon transcriptregel 21" [ref=e464]: §21
                          - 'button "Intrekken: In 2022 heb ik een burn-out gehad, toen ben ik drie maanden thuis geweest" [ref=e465]':
                            - img
                            - text: Intrekken
                  - generic [ref=e466]:
                    - term [ref=e467]: Familieanamnese
                    - definition [ref=e468]:
                      - list [ref=e469]:
                        - listitem [ref=e470]:
                          - text: Mijn moeder heeft een depressie gehad toen ik jong was
                          - button "Toon transcriptregel 22" [ref=e472]: §22
                          - 'button "Intrekken: Mijn moeder heeft een depressie gehad toen ik jong was" [ref=e473]':
                            - img
                            - text: Intrekken
                  - generic [ref=e474]:
                    - term [ref=e475]: Leefstijl
                    - definition [ref=e476]:
                      - list [ref=e477]:
                        - listitem [ref=e478]:
                          - text: "Slaap: besproken"
                          - generic [ref=e479]:
                            - button "Toon transcriptregel 5" [ref=e480]: §5
                            - button "Toon transcriptregel 24" [ref=e481]: §24
                            - button "Toon transcriptregel 28" [ref=e482]: §28
                          - 'button "Intrekken: Slaap: besproken" [ref=e483]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e484]:
                          - text: "Voeding: besproken"
                          - generic [ref=e485]:
                            - button "Toon transcriptregel 6" [ref=e486]: §6
                            - button "Toon transcriptregel 7" [ref=e487]: §7
                          - 'button "Intrekken: Voeding: besproken" [ref=e488]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e489]:
                          - text: "Werk: besproken"
                          - button "Toon transcriptregel 9" [ref=e491]: §9
                          - 'button "Intrekken: Werk: besproken" [ref=e492]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e493]:
                          - text: "Beweging: besproken"
                          - button "Toon transcriptregel 10" [ref=e495]: §10
                          - 'button "Intrekken: Beweging: besproken" [ref=e496]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e497]:
                          - text: "Alcohol: vier glazen"
                          - generic [ref=e498]:
                            - button "Toon transcriptregel 11" [ref=e499]: §11
                            - button "Toon transcriptregel 12" [ref=e500]: §12
                          - 'button "Intrekken: Alcohol: vier glazen" [ref=e501]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e502]:
                          - text: "Roken: ontkend"
                          - button "Toon transcriptregel 12" [ref=e504]: §12
                          - 'button "Intrekken: Roken: ontkend" [ref=e505]':
                            - img
                            - text: Intrekken
                  - generic [ref=e506]:
                    - term [ref=e507]: Psychisch functioneren
                    - definition [ref=e508]:
                      - list [ref=e509]:
                        - listitem [ref=e510]:
                          - text: somberheid
                          - button "Toon transcriptregel 2" [ref=e512]: §2
                          - 'button "Intrekken: somberheid" [ref=e513]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e514]:
                          - text: piekeren
                          - button "Toon transcriptregel 5" [ref=e516]: §5
                          - 'button "Intrekken: piekeren" [ref=e517]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e518]:
                          - text: Suïcidaliteit besproken — beoordeling behandelaar
                          - button "Toon transcriptregel 13" [ref=e520]: §13
                          - 'button "Intrekken: Suïcidaliteit besproken — beoordeling behandelaar" [ref=e521]':
                            - img
                            - text: Intrekken
                  - generic [ref=e522]:
                    - term [ref=e523]: Metingen
                    - definition [ref=e524]: Nog niet besproken
                  - generic [ref=e525]:
                    - term [ref=e526]: Onderzoek
                    - definition [ref=e527]: Nog niet besproken
                  - generic [ref=e528]:
                    - term [ref=e529]: Plan
                    - definition [ref=e530]:
                      - list [ref=e531]:
                        - listitem [ref=e532]:
                          - text: Ik wil de sertraline ophogen naar honderd milligram.
                          - button "Toon transcriptregel 25" [ref=e534]: §25
                          - 'button "Intrekken: Ik wil de sertraline ophogen naar honderd milligram." [ref=e535]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e536]:
                          - text: Ik vraag via de huisarts een TSH-bepaling aan om de schildklier te laten controleren.
                          - button "Toon transcriptregel 26" [ref=e538]: §26
                          - 'button "Intrekken: Ik vraag via de huisarts een TSH-bepaling aan om de schildklier te laten controleren." [ref=e539]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e540]:
                          - text: Ik overleg met de huisarts over de tramadol.
                          - button "Toon transcriptregel 27" [ref=e542]: §27
                          - 'button "Intrekken: Ik overleg met de huisarts over de tramadol." [ref=e543]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e544]:
                          - text: We doen psycho-educatie en ik geef u adviezen over slaaphygiëne.
                          - button "Toon transcriptregel 28" [ref=e546]: §28
                          - 'button "Intrekken: We doen psycho-educatie en ik geef u adviezen over slaaphygiëne." [ref=e547]':
                            - img
                            - text: Intrekken
                        - listitem [ref=e548]:
                          - text: We maken een vervolgafspraak over twee weken.
                          - button "Toon transcriptregel 29" [ref=e550]: §29
                          - 'button "Intrekken: We maken een vervolgafspraak over twee weken." [ref=e551]':
                            - img
                            - text: Intrekken
          - region "Klinische aanwijzingen" [ref=e552]:
            - heading "Aanwijzingen" [level=2] [ref=e553]
            - region "Klinische aanwijzingen" [ref=e554]:
              - generic [ref=e555]:
                - heading "Overweeg te vragen naar" [level=3] [ref=e556]
                - list [ref=e557]:
                  - listitem [ref=e558]:
                    - generic [ref=e559]:
                      - text: Suïcidaliteit uitvragen — besproken
                      - button "Toon transcriptregel 13" [ref=e561]: §13
                  - listitem [ref=e562]:
                    - 'checkbox "Suggestie negeren: Eerdere suïcidepogingen" [ref=e563]'
                    - generic [ref=e564]: Eerdere suïcidepogingen
                  - listitem [ref=e565]:
                    - 'checkbox "Suggestie negeren: Crisisplan en crisisafspraken" [ref=e566]'
                    - generic [ref=e567]: Crisisplan en crisisafspraken
                  - listitem [ref=e568]:
                    - 'checkbox "Suggestie negeren: Psychotische verschijnselen uitvragen" [ref=e569]'
                    - generic [ref=e570]: Psychotische verschijnselen uitvragen
                  - listitem [ref=e571]:
                    - 'checkbox "Suggestie negeren: Veiligheid van anderen en huiselijk geweld" [ref=e572]'
                    - generic [ref=e573]: Veiligheid van anderen en huiselijk geweld
                  - listitem [ref=e574]:
                    - 'checkbox "Suggestie negeren: Kindcheck: kinderen in het gezin en hun veiligheid" [ref=e575]'
                    - generic [ref=e576]: "Kindcheck: kinderen in het gezin en hun veiligheid"
                  - listitem [ref=e577]:
                    - 'checkbox "Suggestie negeren: Zwangerschap, kinderwens en anticonceptie" [ref=e578]'
                    - generic [ref=e579]: Zwangerschap, kinderwens en anticonceptie
                  - listitem [ref=e580]:
                    - generic [ref=e581]:
                      - text: Middelengebruik (alcohol, drugs, roken) uitvragen — besproken
                      - generic [ref=e582]:
                        - button "Toon transcriptregel 11" [ref=e583]: §11
                        - button "Toon transcriptregel 12" [ref=e584]: §12
                  - listitem [ref=e585]:
                    - generic [ref=e586]:
                      - text: Slaap uitvragen — besproken
                      - generic [ref=e587]:
                        - button "Toon transcriptregel 5" [ref=e588]: §5
                        - button "Toon transcriptregel 24" [ref=e589]: §24
                        - button "Toon transcriptregel 28" [ref=e590]: §28
                  - listitem [ref=e591]:
                    - generic [ref=e592]:
                      - text: Actuele medicatie verifiëren — besproken
                      - generic [ref=e593]:
                        - button "Toon transcriptregel 16" [ref=e594]: §16
                        - button "Toon transcriptregel 17" [ref=e595]: §17
                        - button "Toon transcriptregel 24" [ref=e596]: §24
                        - button "Toon transcriptregel 25" [ref=e597]: §25
                        - button "Toon transcriptregel 27" [ref=e598]: §27
                  - listitem [ref=e599]:
                    - 'checkbox "Suggestie negeren: Bijwerkingen van de medicatie uitvragen" [ref=e600]'
                    - generic [ref=e601]: Bijwerkingen van de medicatie uitvragen
                  - listitem [ref=e602]:
                    - 'checkbox "Suggestie negeren: Therapietrouw uitvragen" [ref=e603]'
                    - generic [ref=e604]: Therapietrouw uitvragen
                  - listitem [ref=e605]:
                    - generic [ref=e606]:
                      - text: Allergieën verifiëren — besproken
                      - button "Toon transcriptregel 19" [ref=e608]: §19
                  - listitem [ref=e609]:
                    - 'checkbox "Suggestie negeren: Somatische/metabole controle bij antipsychotica" [ref=e610]'
                    - generic [ref=e611]: Somatische/metabole controle bij antipsychotica
                  - listitem [ref=e612]:
                    - generic [ref=e613]:
                      - text: Voorgeschiedenis en eerdere behandelingen — besproken
                      - button "Toon transcriptregel 21" [ref=e615]: §21
                  - listitem [ref=e616]:
                    - generic [ref=e617]:
                      - text: Familieanamnese — besproken
                      - button "Toon transcriptregel 22" [ref=e619]: §22
                  - listitem [ref=e620]:
                    - generic [ref=e621]:
                      - text: Werk en sociale context — besproken
                      - button "Toon transcriptregel 9" [ref=e623]: §9
                  - listitem [ref=e624]:
                    - 'checkbox "Suggestie negeren: Wonen, financiën en schulden" [ref=e625]'
                    - generic [ref=e626]: Wonen, financiën en schulden
                  - listitem [ref=e627]:
                    - generic [ref=e628]:
                      - text: Beleid afspreken — besproken
                      - generic [ref=e629]:
                        - button "Toon transcriptregel 25" [ref=e630]: §25
                        - button "Toon transcriptregel 26" [ref=e631]: §26
                        - button "Toon transcriptregel 27" [ref=e632]: §27
                        - button "Toon transcriptregel 28" [ref=e633]: §28
                        - button "Toon transcriptregel 29" [ref=e634]: §29
                  - listitem [ref=e635]:
                    - 'checkbox "Suggestie negeren: Vangnetadvies: wanneer contact opnemen" [ref=e636]'
                    - generic [ref=e637]: "Vangnetadvies: wanneer contact opnemen"
                  - listitem [ref=e638]:
                    - generic [ref=e639]:
                      - text: Vervolgafspraak maken — besproken
                      - button "Toon transcriptregel 29" [ref=e641]: §29
              - generic [ref=e642]:
                - heading "Klinische overwegingen" [level=3] [ref=e643]
                - paragraph [ref=e644]: Beoordeling door behandelaar vereist
                - paragraph [ref=e645]: Dit paneel toont uw eigen uitgesproken overwegingen; alleen de AI-analyse voegt signalen toe.
                - list [ref=e646]:
                  - listitem [ref=e647]:
                    - text: Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.
                    - button "Toon transcriptregel 23" [ref=e649]: §23
                  - listitem [ref=e650]:
                    - text: De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen.
                    - button "Toon transcriptregel 24" [ref=e652]: §24
              - generic [ref=e653]:
                - heading "Medicatieveiligheid" [level=3] [ref=e654]
                - note [ref=e655]: Controle beperkt tot de ingevoerde lijst en beschikbare regels — dit is geen volledige medicatiebewaking.
                - generic [ref=e656]:
                  - paragraph [ref=e657]: Gecontroleerde medicatieregels
                  - alert [ref=e658]:
                    - list [ref=e659]:
                      - listitem [ref=e660]:
                        - text: "Mogelijke interactie sertraline × lithium: verhoogd risico op serotonerge toxiciteit (serotoninesyndroom). Controleer vóór voorschrijven."
                        - button "Toon transcriptregel 16" [ref=e662]: §16
                - generic [ref=e663]:
                  - paragraph [ref=e664]: AI-signalen — niet geverifieerd, controleer in het Farmacotherapeutisch Kompas
                  - paragraph [ref=e665]: Geen AI-signalen.
              - generic [ref=e666]:
                - heading "Vervolgacties" [level=3] [ref=e667]
                - list [ref=e668]:
                  - listitem [ref=e669]:
                    - paragraph [ref=e670]:
                      - text: Ik wil de sertraline ophogen naar honderd milligram.
                      - button "Toon transcriptregel 25" [ref=e672]: §25
                    - generic [ref=e673]:
                      - generic [ref=e674]: Medicatie
                      - generic [ref=e675]: Voorgesteld
                      - generic [ref=e676]:
                        - button "Goedkeuren" [ref=e677]:
                          - img
                          - text: Goedkeuren
                        - button "Afwijzen" [ref=e678]:
                          - img
                          - text: Afwijzen
                  - listitem [ref=e679]:
                    - paragraph [ref=e680]:
                      - text: Ik vraag via de huisarts een TSH-bepaling aan om de schildklier te laten controleren.
                      - button "Toon transcriptregel 26" [ref=e682]: §26
                    - generic [ref=e683]:
                      - generic [ref=e684]: Laboratorium
                      - generic [ref=e685]: Voorgesteld
                      - generic [ref=e686]:
                        - button "Goedkeuren" [ref=e687]:
                          - img
                          - text: Goedkeuren
                        - button "Afwijzen" [ref=e688]:
                          - img
                          - text: Afwijzen
                  - listitem [ref=e689]:
                    - paragraph [ref=e690]:
                      - text: Ik overleg met de huisarts over de tramadol.
                      - button "Toon transcriptregel 27" [ref=e692]: §27
                    - generic [ref=e693]:
                      - generic [ref=e694]: Communicatie
                      - generic [ref=e695]: Voorgesteld
                      - generic [ref=e696]:
                        - button "Goedkeuren" [ref=e697]:
                          - img
                          - text: Goedkeuren
                        - button "Afwijzen" [ref=e698]:
                          - img
                          - text: Afwijzen
                  - listitem [ref=e699]:
                    - paragraph [ref=e700]:
                      - text: We doen psycho-educatie en ik geef u adviezen over slaaphygiëne.
                      - button "Toon transcriptregel 28" [ref=e702]: §28
                    - generic [ref=e703]:
                      - generic [ref=e704]: Overig
                      - generic [ref=e705]: Voorgesteld
                      - generic [ref=e706]:
                        - button "Goedkeuren" [ref=e707]:
                          - img
                          - text: Goedkeuren
                        - button "Afwijzen" [ref=e708]:
                          - img
                          - text: Afwijzen
                  - listitem [ref=e709]:
                    - paragraph [ref=e710]:
                      - text: We maken een vervolgafspraak over twee weken.
                      - button "Toon transcriptregel 29" [ref=e712]: §29
                    - generic [ref=e713]:
                      - generic [ref=e714]: Vervolgafspraak
                      - generic [ref=e715]: Voorgesteld
                      - generic [ref=e716]:
                        - button "Goedkeuren" [ref=e717]:
                          - img
                          - text: Goedkeuren
                        - button "Afwijzen" [ref=e718]:
                          - img
                          - text: Afwijzen
  - region "Notifications alt+T"
  - alert [ref=e719]
```

# Test source

```ts
  1037 |   test("werkruimte: getempode demo-opname, volledig afspelen, aanwijzingen en verouderde analyse", async ({ page }) => {
  1038 |     await page.goto("/scribe/demo-consult-1");
  1039 |     await expect(page.getByRole("heading", { name: /D-2026-0417/ })).toBeVisible();
  1040 | 
  1041 |     // C20/S14 — "Demo-opname" speelt het gescripte consult getempo af
  1042 |     // (DEMO_SEGMENT_INTERVAL_MS = 1,5 s). Een paar seconden volstaan als bewijs;
  1043 |     // de rest gaat via "Volledig afspelen".
  1044 |     const transcript = page.getByRole("region", { name: "Transcript" });
  1045 |     await page.getByRole("button", { name: "Demo-opname", exact: true }).click();
  1046 |     await expect
  1047 |       .poll(async () => transcript.locator('li[id^="scribe-segment-"]').count(), { timeout: 15_000 })
  1048 |       .toBeGreaterThanOrEqual(2);
  1049 |     await page.getByRole("button", { name: "Demo-opname stoppen" }).click();
  1050 |     await expect(page.getByRole("button", { name: "Demo-opname", exact: true })).toBeVisible();
  1051 | 
  1052 |     // "Volledig afspelen" zet de rest van het consult in één keer neer en
  1053 |     // analyseert daarna deterministisch.
  1054 |     await page.getByRole("button", { name: "Volledig afspelen" }).click();
  1055 |     await expect(transcript.getByText("30 regels")).toBeVisible();
  1056 |     await expect(page.getByText("Het demo-consult is volledig afgespeeld")).toBeVisible();
  1057 | 
  1058 |     // Paneel B — gestructureerde consultstaat uit de deterministische laag.
  1059 |     const notities = page.getByRole("region", { name: "AI-notities" });
  1060 |     await expect(notities.getByText("Hoofdklacht")).toBeVisible();
  1061 |     await expect(notities.getByText("somberheid", { exact: true }).first()).toBeVisible();
  1062 |     await expect(notities.getByText("drie maanden", { exact: true })).toBeVisible();
  1063 |     await expect(notities.getByText("sertraline 50 mg (huidig)")).toBeVisible();
  1064 |     await expect(notities.getByText("Deterministische analyse").or(notities.getByText("Demo")).first()).toBeVisible();
  1065 | 
  1066 |     // Paneel C — gecontroleerde regel apart van de (hier lege) AI-signalen.
  1067 |     const aanwijzingen = page.getByRole("region", { name: "Klinische aanwijzingen" });
  1068 |     await expect(aanwijzingen.getByText("Gecontroleerde medicatieregels")).toBeVisible();
  1069 |     await expect(
  1070 |       aanwijzingen.getByText(
  1071 |         "Mogelijke interactie sertraline × tramadol: verhoogd risico op serotonerge toxiciteit (serotoninesyndroom). Controleer vóór voorschrijven.",
  1072 |       ),
  1073 |     ).toBeVisible();
  1074 |     await expect(aanwijzingen.getByText("Farmacotherapeutisch Kompas", { exact: false })).toBeVisible();
  1075 |     await expect(aanwijzingen.getByText("Geen AI-signalen.")).toBeVisible();
  1076 | 
  1077 |     // S10: risicocategorie zonder polariteit — het checklist-item schuift naar
  1078 |     // "besproken" en verdwijnt nooit.
  1079 |     await expect(aanwijzingen.getByText("Suïcidaliteit uitvragen — besproken")).toBeVisible();
  1080 |     await expect(aanwijzingen.getByText("Beoordeling door behandelaar vereist")).toBeVisible();
  1081 |     await expect(
  1082 |       aanwijzingen.getByText(
  1083 |         "Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.",
  1084 |       ),
  1085 |     ).toBeVisible();
  1086 |     await expect(
  1087 |       aanwijzingen.getByText("De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen."),
  1088 |     ).toBeVisible();
  1089 | 
  1090 |     // S8: een sprekercorrectie op een geanalyseerd segment veroudert de analyse
  1091 |     // en dwingt heranalyse af.
  1092 |     await transcript.getByRole("button", { name: "Spreker van regel 1: Arts — wijzigen" }).click();
  1093 |     await expect(
  1094 |       notities.getByText("Analyse verouderd sinds uw correctie — opnieuw analyseren voordat u het verslag opstelt."),
  1095 |     ).toBeVisible();
  1096 |     await notities.getByRole("button", { name: "Opnieuw analyseren" }).click();
  1097 |     await expect(notities.getByRole("button", { name: "Nu analyseren" })).toBeVisible();
  1098 |     await expect(notities.getByText("Analyse verouderd", { exact: false })).toHaveCount(0);
  1099 | 
  1100 |     // Afronden schakelt over naar de verslagreview van hetzelfde consult.
  1101 |     await page.getByRole("button", { name: "Consult afronden" }).click();
  1102 |     const verslag = page.getByRole("region", { name: "Verslag" });
  1103 |     await expect(verslag.getByRole("heading", { name: "Reden van komst" })).toBeVisible();
  1104 |     await expect(verslag.getByRole("heading", { name: "Risicotaxatie" })).toBeVisible();
  1105 |     await expect(page.getByRole("button", { name: "Consult afronden" })).toHaveCount(0);
  1106 |   });
  1107 | 
  1108 |   test("consultstaat corrigeren: feit intrekken en de EPD-lijst overnemen", async ({ page }) => {
  1109 |     await page.goto("/scribe/demo-consult-1");
  1110 |     await page.getByRole("button", { name: "Volledig afspelen" }).click();
  1111 | 
  1112 |     const notities = page.getByRole("region", { name: "AI-notities" }).first();
  1113 |     await expect(notities.getByText("tramadol (huidig)")).toBeVisible();
  1114 | 
  1115 |     // N6/S7 — intrekken haalt het feit uit het verslag, maar laat de regel
  1116 |     // doorgehaald staan: een weglating mag nooit stil gebeuren.
  1117 |     await notities.getByRole("button", { name: "Intrekken: tramadol (huidig)" }).click();
  1118 |     await expect(notities.getByRole("button", { name: "Intrekken: tramadol (huidig)" })).toHaveCount(0);
  1119 |     await expect(notities.locator("li").filter({ hasText: "tramadol (huidig)" }).first()).toHaveClass(/line-through/);
  1120 | 
  1121 |     // N6 — de geplakte EPD-lijst gaat door dezelfde deterministische extractie
  1122 |     // als het transcript; alleen de gevonden feiten belanden in de staat.
  1123 |     await notities.getByRole("button", { name: "EPD-lijst plakken" }).click();
  1124 |     await notities
  1125 |       .getByLabel("Actuele medicatie & allergieën uit het EPD")
  1126 |       .fill("lorazepam 1 mg zo nodig\nlithium 400 mg dagelijks\nAllergie voor amoxicilline");
  1127 |     await notities.getByRole("button", { name: "Lijst overnemen" }).click();
  1128 |     await expect(page.getByText(/2 middel\(en\) en 1 allergie\(ën\) uit het EPD toegevoegd/)).toBeVisible();
  1129 |     await expect(notities.getByText("lorazepam 1 mg (huidig)")).toBeVisible();
  1130 |     await expect(notities.getByText("Zelf aangevuld").first()).toBeVisible();
  1131 |     await expect(notities.getByText("lithium 400 mg (huidig)")).toBeVisible();
  1132 |     await expect(notities.getByText("Beoordeeld", { exact: true })).toHaveCount(0);
  1133 |     await notities
  1134 |       .getByLabel(
  1135 |         "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.",
  1136 |       )
> 1137 |       .check();
       |        ^ Error: locator.check: Clicking the checkbox did not change its state
  1138 |     await expect(notities.getByText("Beoordeeld", { exact: true })).toBeVisible();
  1139 |     await expect(page.getByText(/dit is geen volledige medicatiebewaking/)).toBeVisible();
  1140 |   });
  1141 | 
  1142 |   test("handmatige invoer blijft behouden tijdens verzenden en blokkeert afronden", async ({ page }) => {
  1143 |     await page.goto("/scribe/demo-consult-1");
  1144 |     const veld = page.getByLabel("Gesprekstekst handmatig toevoegen", { exact: true });
  1145 |     let release: () => void = () => undefined;
  1146 |     let markSeen: () => void = () => undefined;
  1147 |     const seen = new Promise<void>((resolve) => {
  1148 |       markSeen = resolve;
  1149 |     });
  1150 |     await page.route("**/api/careon/scribe/sessies/demo-consult-1/segmenten", async (route) => {
  1151 |       markSeen();
  1152 |       await new Promise<void>((resolve) => {
  1153 |         release = resolve;
  1154 |       });
  1155 |       await route.fulfill({ status: 501, contentType: "application/json", body: '{"demo":true}' });
  1156 |     });
  1157 |     await veld.fill("Eerste synthetische zin.");
  1158 |     await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeDisabled();
  1159 |     await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
  1160 |     await seen;
  1161 |     await veld.fill("Tweede synthetische zin tijdens verzenden.");
  1162 |     release();
  1163 |     await expect(page.getByRole("region", { name: "Transcriptregels" })).toContainText("Eerste synthetische zin.");
  1164 |     await expect(veld).toHaveValue("Tweede synthetische zin tijdens verzenden.");
  1165 |     await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeDisabled();
  1166 |     await page.unroute("**/api/careon/scribe/sessies/demo-consult-1/segmenten");
  1167 |     await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
  1168 |     await expect(veld).toHaveValue("");
  1169 |     await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeEnabled();
  1170 |   });
  1171 | 
  1172 |   test("annuleren wist handmatige concepten", async ({ page }) => {
  1173 |     await page.goto("/scribe/demo-consult-1");
  1174 |     await page
  1175 |       .getByLabel("Gesprekstekst handmatig toevoegen", { exact: true })
  1176 |       .fill("Synthetisch concept voor intrekking.");
  1177 |     await page.getByRole("button", { name: "Annuleren", exact: true }).click();
  1178 |     await page.getByRole("button", { name: "Consult annuleren", exact: true }).click();
  1179 |     await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toHaveCount(0);
  1180 |     expect(await page.evaluate(() => sessionStorage.getItem("careon-scribe-concept-demo-consult-1"))).toBeNull();
  1181 |   });
  1182 | 
  1183 |   test("verslagreview: beoordelingssecties blijven van de behandelaar, daarna overname in het EPD", async ({
  1184 |     page,
  1185 |   }) => {
  1186 |     await page.goto("/scribe/demo-consult-2");
  1187 |     const verslag = page.getByRole("region", { name: "Verslag" });
  1188 |     const sectie = (titel: string) =>
  1189 |       page.getByRole("article").filter({ has: page.getByRole("heading", { name: titel }) });
  1190 | 
  1191 |     // N7 — de deterministische secties dragen lopende zinnen, geen opsomming
  1192 |     // van trefwoorden.
  1193 |     await expect(sectie("Reden van komst").getByRole("textbox", { name: "Reden van komst" })).toHaveValue(
  1194 |       /^Cliënt meldt somberheid sinds drie maanden/,
  1195 |     );
  1196 | 
  1197 |     await expect(verslag.getByRole("button", { name: "Kopieer sectie" })).toHaveCount(0);
  1198 | 
  1199 |     // S10/N3: ★-secties komen leeg binnen, met citaten uit hún eigen onderwerp —
  1200 |     // de risicotaxatie citeert het risicosegment (§13), niet de overwegingen.
  1201 |     const risicotaxatie = sectie("Risicotaxatie");
  1202 |     await expect(risicotaxatie.getByText("Leeg", { exact: true })).toBeVisible();
  1203 |     await expect(risicotaxatie.getByText("Uitspraken hierover in dit consult: §13")).toBeVisible();
  1204 |     await expect(risicotaxatie.getByRole("textbox", { name: "Risicotaxatie" })).toHaveValue("");
  1205 |     await expect(sectie("Overwegingen").getByText("Uitspraken hierover in dit consult: §23, §24")).toBeVisible();
  1206 | 
  1207 |     // "Alles goedkeuren" slaat ze over en meldt dat. De dialoog sluit zichzelf:
  1208 |     // de actieknop roept alleen preventDefault aan zolang een bevestiging
  1209 |     // ontbreekt, en dit demo-consult heeft geen ontbrekende fragmenten.
  1210 |     await verslag.getByRole("button", { name: "Alles goedkeuren" }).click();
  1211 |     const goedkeurDialoog = page.getByRole("alertdialog");
  1212 |     // N22 — het gatenvinkje verschijnt uitsluitend bij ontbrekende fragmenten.
  1213 |     await expect(goedkeurDialoog.getByLabel("Ik heb de ontbrekende fragmenten aangevuld of beoordeeld.")).toHaveCount(
  1214 |       0,
  1215 |     );
  1216 |     await goedkeurDialoog.getByRole("button", { name: "Goedkeuren" }).click();
  1217 |     await expect(page.getByRole("alertdialog")).toHaveCount(0);
  1218 |     await expect(
  1219 |       page.getByText("2 beoordelingssecties zijn overgeslagen: schrijf en keur die zelf goed."),
  1220 |     ).toBeVisible();
  1221 |     await expect(sectie("Reden van komst").getByText("Goedgekeurd", { exact: true })).toBeVisible();
  1222 |     await expect(risicotaxatie.getByText("Leeg", { exact: true })).toBeVisible();
  1223 | 
  1224 |     // Zelf schrijven en per sectie goedkeuren; pas dan is het verslag vast.
  1225 |     for (const titel of ["Risicotaxatie", "Overwegingen"]) {
  1226 |       const blok = sectie(titel);
  1227 |       const veld = blok.getByRole("textbox", { name: titel });
  1228 |       await veld.fill(`${titel}: beoordeling door de behandelaar, vastgesteld tijdens het consult.`);
  1229 |       await veld.press("Tab");
  1230 |       await expect(blok.getByText("Bewerkt", { exact: true })).toBeVisible();
  1231 |       await blok.getByRole("button", { name: "Goedkeuren" }).click();
  1232 |       await expect(blok.getByText("Goedgekeurd", { exact: true })).toBeVisible();
  1233 |       if (titel === "Risicotaxatie") {
  1234 |         await expect(
  1235 |           page.getByText("1 beoordelingssectie is overgeslagen: schrijf en keur die zelf goed."),
  1236 |         ).toBeVisible();
  1237 |       }
```