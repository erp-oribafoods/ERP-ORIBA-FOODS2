# Classeur journalier ORIBA ERP : saisie quotidienne de toutes les données de l'ERP, importable tel quel
# (Saisie rapide > « Classeur du jour (dépôts) » > Importer). Listes reprises du fichier ERP_Base_de_données1,
# objectifs du fichier DONNEES_FORCE_DE_VENTE, budgets et dépenses du 03/11 tels qu'enregistrés dans l'ERP.
# Usage : python3 build_erp.py BASE.xlsx FORCE_DE_VENTE.xlsx SORTIE.xlsx
import datetime as dt, sys
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as L

BASE, FDV, OUT = sys.argv[1:4]
TBS = sys.argv[4:]  # fichiers TB des équipes (Tahoua, Balleyara…)
VERT, VERT_F, VIOLET, GRIS, BLANC, BLEU = '2E7D32', '1B5E20', '5B3E96', 'F2F7EE', 'FFFFFF', 'E8F0FE'
LIGNES = 400
DEPART = dt.date(2026, 11, 4)

src = load_workbook(BASE, data_only=True)
def lignes(nom, n):
    out = []
    for r in src[nom].iter_rows(min_row=5, values_only=True):
        r = list(r[:n]) + [None] * max(0, n - len(r))
        if r[1] not in (None, ''): out.append([x.strip() if isinstance(x, str) else x for x in r])
    return out
DEPOTS, AGENTS, CLIENTS, GROSSISTES = lignes('Dépôts', 9), lignes('Agents', 7), lignes('Clients', 6), lignes('Grossistes', 7)
# Schéma du circuit : le chef d'équipe EST le dépôt (il n'est plus listé parmi les agents) ; chaque agent a son marché
CHEFS = {'NY1-01': 'DEP-NY1', 'NY2-01': 'DEP-NY2', 'BAL-01': 'DEP-TIL', 'KON-01': 'DEP-KON', 'TAH-07': 'DEP-TAH', 'MAR-01': 'DEP-MAR', 'MAR-02': 'DEP-MAR', 'ZIN-01': 'DEP-ZIN', 'DOS-01': 'DEP-DOS'}
MARCHES = {'DEP-NY1': 'Aéroport', 'NY1-02': 'Dolé', 'NY1-03': 'Koira Tégui', 'NY1-04': 'Dar es Salam', 'NY1-05': 'Yantala', 'DEP-NY2': 'Grand Marché', 'NY2-02': 'Petit Marché',
           'NY2-03': 'Nouveau Marché', 'NY2-04': 'Wadata', 'NY2-05': 'Bonkaney', 'NY2-06': 'Katako', 'NY2-07': 'Gamkallé', 'DEP-TIL': 'Balleyara', 'DEP-KON': 'Konni Ville',
           'KON-02': 'Gidan Ider', 'KON-03': 'Tunfafi', 'KON-06': 'Galmi', 'DEP-TAH': 'Badaguichiri', 'TAH-02': 'Abalak', 'TAH-06': 'Tahoua Ville', 'TAH-03': 'Tchinta', 'TAH-04': 'Bouza', 'TAH-01': 'Agadez'}
NOM_AG = {a[0]: a[1] for a in AGENTS}
NOM_DEP = {d[0]: d[1] for d in DEPOTS}
RESP = {}
for c, d in CHEFS.items(): RESP.setdefault(d, []).append(NOM_AG[c])
for d in DEPOTS: d.append(' / '.join(RESP.get(d[0], [])) or None); d.append(MARCHES.get(d[0]))
AGENTS = [a for a in AGENTS if a[0] not in CHEFS]
for a in AGENTS: a[4] = MARCHES.get(a[0])
CHEF_DEP = {NOM_AG[c]: NOM_DEP[d] for c, d in CHEFS.items()}

LISTE_MARCHES = ['Aéroport', 'Dolé', 'Koira Tégui', 'Dar es Salam', 'Yantala', 'Grand Marché', 'Petit Marché', 'Nouveau Marché', 'Wadata', 'Bonkaney', 'Katako', 'Gamkallé',
    'Balleyara', 'Loga', 'Gotheye', 'Hamdallahi', 'Ouallam', 'Konni Ville', 'Gidan Ider', 'Tunfafi', 'Galmi', 'Malbaza', 'Karofan', 'Madaoua', 'Tsernaoua', 'Massalata', 'Dossey', 'Dibissou',
    'Tahoua Ville', 'Badaguichiri', 'Abalak', 'Tchinta', 'Bouza', 'Agadez']
# ---------- Historique du fichier TB de l'équipe (ex. TB Mohamedine Tahoua) : ventes comptant, ventes à crédit, remboursements
import re
def nom_client(c, zone):
    brut = re.sub(r'\s+', ' ', str(c or '')).strip()
    if not brut: return None
    m = re.match(r'^Clien?t?\s+(\w+)\s*-\s*(.*)$', brut, re.I)
    if m:
        n = m.group(2).strip()
        if not n: return f'Client {m.group(1).upper()} ({zone})'   # client sans nom dans le TB
    else: n = brut
    return f'Détaillants divers ({zone})' if re.match(r'^d[ée]taill', n, re.I) else n
def unite(u, prix):  # l'unité suit le prix : prix de carton = Carton, prix de pack (moins de 5 000 F) = Pack
    if not prix: return u or 'Carton'
    return 'Carton' if prix >= 5000 else 'Pack'
import difflib, unicodedata
def _cle(x): return ''.join(ch for ch in unicodedata.normalize('NFD', str(x).lower()) if unicodedata.category(ch) != 'Mn').replace('-', ' ').strip()
def nom_marche(m):
    n = re.sub(r'\s+', ' ', re.sub(r'^\s*March[ée]s?\s+', '', str(m or ''))).strip()
    if not n or _cle(n) == 'secteur': return None     # « Secteur » : vente ambulante, sans marché
    n = re.sub(r'^Nouveaux\s+', 'Nouveau ', n)
    k = _cle(n)
    for x in LISTE_MARCHES:
        if _cle(x) == k or k.startswith(_cle(x) + ' '): return x
    p = difflib.get_close_matches(k, [_cle(x) for x in LISTE_MARCHES], 1, 0.8)
    return next(x for x in LISTE_MARCHES if _cle(x) == p[0]) if p else n
def jour(v):
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    m = re.match(r'^(\d{1,2})/(\d{1,2})/0?(\d{3,4})$', str(v or '').strip())
    if m: y = int(m.group(3)); y = 2026 if y in (206, 2026) else y; return dt.date(y, int(m.group(2)), int(m.group(1)))
    return None
HIST_V, HIST_R, TB_NOMS, TEL, CORR, PLAF = [], [], [], {}, [], []
ZONE_DEP = {d[1]: d[2] for d in DEPOTS}
for TB in TBS:
    tb_wb = load_workbook(TB, data_only=True)
    TB_NOMS.append(TB.rsplit('/', 1)[-1])
    JC = tb_wb[next(n for n in tb_wb.sheetnames if n.lower().startswith('journal comptant'))]
    JK = tb_wb[next(n for n in tb_wb.sheetnames if re.match(r'journal cr[ée]dit', n.lower()))]
    chef = next((re.sub(r'\s+', ' ', str(r[1])).strip() for J in (JC, JK) for r in J.iter_rows(min_row=3, values_only=True) if r[1] and re.sub(r'\s+', ' ', str(r[1])).strip() in CHEF_DEP), None)
    dep = CHEF_DEP.get(chef, '')
    zone = ZONE_DEP.get(dep, dep.replace('Dépôt ', ''))
    if 'Paramètres' in tb_wb.sheetnames:
        for r in tb_wb['Paramètres'].iter_rows(values_only=True):
            if r and isinstance(r[0], str) and r[0].lower().startswith('plafond cumul') and isinstance(r[1], (int, float)): PLAF.append((zone, r[1]))
    VUS = {}
    def vend(a):
        n = re.sub(r'\s+', ' ', str(a)).strip()
        if n in VUS: return VUS[n]
        if n in CHEF_DEP: r = CHEF_DEP[n]
        elif any(x[1] == n for x in AGENTS): r = n
        else:
            du = [x[1] for x in AGENTS if x[2] == dep] or [x[1] for x in AGENTS]
            c = [x for x in du if any(w.lower().startswith(n.lower()) for w in x.split())]                    # nom abrégé (« Mahfouz », « Saliya »)
            c = c or [x for x in du if set(x.lower().split()) <= set(n.lower().split())]                        # nom complété (« Abdou Rachid Ousmane »)
            c = c or difflib.get_close_matches(n, du, 1, 0.85)                                                  # orthographe (« Roukiatou »)
            if len(c) == 1: r = c[0]; CORR.append(f'{zone} : agent « {n} » du TB reconnu comme {r}')
            else:
                pre = next((d[0] for d in DEPOTS if d[1] == dep), 'DEP').replace('DEP-', '')
                k = 1 + max([int(x[0].split('-')[1]) for x in AGENTS if str(x[0]).startswith(pre + '-') and x[0].split('-')[1].isdigit()] + [0])
                AGENTS.append([f'{pre}-{k:02d}', n, dep, 'Agent Commercial', None, None, 0]); r = n
                CORR.append(f'{zone} : agent « {n} » absent de la liste, ajouté au {dep}')
        VUS[n] = r; return r
    pref = next((d[0] for d in DEPOTS if d[1] == dep), 'DEP').replace('DEP-', '')
    # Téléphones des clients (onglet Paramètres du TB : « Client X - Nom » suivi du numéro)
    if 'Paramètres' in tb_wb.sheetnames:
        for r in tb_wb['Paramètres'].iter_rows(values_only=True):
            for k in range(len(r) - 1):
                if isinstance(r[k], str) and re.match(r'^\s*Client\s+\w+\s*-', r[k]) and isinstance(r[k + 1], str) and re.search(r'\d{2}\s?\d{2}', r[k + 1]) and 'X' not in r[k + 1]:
                    TEL[nom_client(r[k], zone)] = r[k + 1].strip()
    for r in JC.iter_rows(min_row=3, values_only=True):
        d = jour(r[0])
        if not d or not r[1]: continue
        if not r[6]: CORR.append(f'{zone} : vente au comptant du {d:%d/%m/%Y} sans quantité, ignorée'); continue
        HIST_V.append([d, vend(r[1]), nom_marche(r[2]), nom_client(r[3], zone), r[4], unite(r[5], r[7]), r[6], r[7], 'Comptant', None, None, r[9] or None])
    n = 0
    for r in JK.iter_rows(min_row=3, values_only=True):
        d = jour(r[0])
        if not d or not r[1]: continue
        n += 1; num_v = f'{pref}-C{n:03d}'
        ech = jour(r[9]) or d
        if ech < d:  # date promesse saisie avant la vente : même jour du mois suivant
            e2 = (dt.date(d.year + (d.month == 12), d.month % 12 + 1, min(ech.day, 28)))
            CORR.append(f'{zone} : crédit du {d:%d/%m/%Y} ({num_v}), date promesse {ech:%d/%m/%Y} avant la vente, corrigée en {e2:%d/%m/%Y}'); ech = e2
        HIST_V.append([d, vend(r[1]), nom_marche(r[2]), nom_client(r[3], zone), r[4], unite(r[5], r[7]), r[6], r[7], 'Crédit', ech, num_v, f'Reprise du TB {zone}'])
        rb = r[10] or 0
        if rb > 0:
            dr = jour(r[11]) or min(ech, dt.date.today())   # sans date de remboursement : date promesse (au plus tard aujourd'hui)
            if dr.year > 2026:
                CORR.append(f'{zone} : remboursement de {num_v} daté du {dr:%d/%m/%Y}, corrigé en {dr.day:02d}/{dr.month:02d}/2026'); dr = dt.date(2026, dr.month, dr.day)
            if dr < d: dr = d
            HIST_R.append([dr, vend(r[1]), 'Remboursement crédit', num_v, 'Caisse Oriba', None, rb, None])
noms = {c[1] for c in CLIENTS}
for c in sorted({x[3] for x in HIST_V if x[3]} - noms): CLIENTS.append([None, c, None, None, None, None])
for c in CLIENTS:
    if not c[4] and TEL.get(c[1]): c[4] = TEL[c[1]]
TB_NOM = ', '.join(TB_NOMS)
for c in CORR: print('CORRECTION', c)
for g in GROSSISTES:
    if not g[3]: g[3] = 'Oriba Food'
PRODUITS = [('Arôme DADI Épicé', 'Arôme', 13250), ('Arôme DADI Poulet', 'Arôme', 12250), ('Mayonnaise Délice', 'Mayonnaise', 9500), ('Mayonnaise Oriba 1000 ml', 'Mayonnaise', 9500),
            ('Mayonnaise Oriba 500 ml', 'Mayonnaise', 9500), ('Mayonnaise Oriba 250 ml', 'Mayonnaise', 7500), ('Mayonnaise Aïda', 'Mayonnaise', 11000)]

# Objectifs des agents (DONNEES_FORCE_DE_VENTE) pour novembre et décembre
fdv = load_workbook(FDV, data_only=True).active
OBJ_AG = []
for r in fdv.iter_rows(min_row=4, values_only=True):
    if not (r[2] and isinstance(r[4], (int, float))): continue
    n = CHEF_DEP.get(str(r[2]).strip(), str(r[2]).strip())   # objectif du chef = objectif de son dépôt
    ex = next((o for o in OBJ_AG if o[0] == n), None)
    if ex: ex[1] += r[4]
    else: OBJ_AG.append([n, r[4]])
OBJ_AG = [tuple(o) for o in OBJ_AG]
OBJ_EQ = [('Dosso', 1500), ('Équipe Mayonnaise', 2000)]  # équipes sans objectif par agent dans le fichier
# Budgets mensuels (fichier Budget Équipes Commerciales, tels qu'enregistrés dans l'ERP)
BUD = {'Niamey 1': (390000, 89000, 125000, 1245000), 'Niamey 2': (60000, 25000, 80000, 620000), 'Maradi': (300000, 48000, 160000, 910000),
       'Tahoua': (150000, 45000, 100000, 550000), 'Konni': (130000, 24000, 100000, 275000), 'Dosso': (None, 46000, None, 170000),
       'Balleyara': (200000, 46000, 60000, 210000), 'Zinder': (120000, 24000, 60000, 150000), 'Équipe Mayonnaise': (130000, 46000, 60000, 160000),
       'Équipe Contrôleur': (60000, 21000, 15000, 360000)}

NATURES_B = ['Carburant', 'Vidange', 'Réparations et entretien', 'Salaires et rémunérations agents']
NATURES = ['Salaires et rémunérations agents', 'Carburant', 'Réparations et entretien', 'Vidange', 'Assurance', 'Filtres moteur', 'Vignette', 'Visite technique',
           'Patente', 'Autorisations', 'Frais d’insalubrité territoriale', 'Gadgets et supports promotionnels', 'Caisse / cachet annuel', 'Autres frais autorisés']
EQUIPES = ['Niamey 1', 'Niamey 2', 'Maradi', 'Tahoua', 'Konni', 'Dosso', 'Balleyara', 'Zinder', 'Équipe Mayonnaise', 'Équipe Contrôleur']
VEHICULES = ['CE 3280', 'BZ-5609']

wb = Workbook()
fin = Side(style='thin', color='CFE3C4')
BORD = Border(left=fin, right=fin, top=fin, bottom=fin)

def feuille(nom, titre, sous_titre, entetes, largeurs, rows=(), vides=0, couleur=VERT, dates=(), nombres=(), calc=()):
    ws = wb.create_sheet(nom)
    ws['A1'] = titre; ws['A1'].font = Font(bold=True, size=14, color=couleur)
    ws['A2'] = sous_titre; ws['A2'].font = Font(italic=True, color='5A5670')
    for j, (h, w) in enumerate(zip(entetes, largeurs), 1):
        c = ws.cell(row=4, column=j, value=h); c.font = Font(bold=True, color=BLANC); c.fill = PatternFill('solid', fgColor=couleur)
        c.alignment = Alignment(wrap_text=True, vertical='center'); c.border = BORD
        ws.column_dimensions[L(j)].width = w
    ws.row_dimensions[4].height = 34
    for i in range(len(rows) + vides):
        r = 5 + i
        val = rows[i] if i < len(rows) else [None] * len(entetes)
        for j in range(1, len(entetes) + 1):
            c = ws.cell(row=r, column=j, value=val[j - 1] if j - 1 < len(val) else None)
            c.border = BORD
            if i % 2: c.fill = PatternFill('solid', fgColor=GRIS)
            if j in dates: c.number_format = 'DD/MM/YYYY'
            if j in nombres: c.number_format = '#,##0'
            if j in calc: c.fill = PatternFill('solid', fgColor=BLEU); c.font = Font(color='37474F')
    ws.freeze_panes = 'A5'
    return ws

def liste(ws, col, plage, n, message):
    dv = DataValidation(type='list', formula1=plage, allow_blank=True, showErrorMessage=False, showInputMessage=True, promptTitle='Choisir ou écrire', prompt=message)
    ws.add_data_validation(dv); dv.add(f'{col}5:{col}{4 + n}')

def montant(ws, col_res, a, b, n):  # Montant = cartons × prix (case calculée, rien à saisir)
    for r in range(5, 5 + n): ws[f'{col_res}{r}'] = f'=IF(OR({a}{r}="",{b}{r}=""),"",{a}{r}*{b}{r})'

# ---------- Lisez-moi
ws = wb.active; ws.title = 'Lisez-moi'
txt = [
    ('ORIBA ERP — classeur de saisie journalière', Font(bold=True, size=16, color=VERT_F)),
    ('Toutes les opérations de la force de vente, à importer dans l’ERP : Saisie rapide > « Classeur du jour (dépôts) » > Importer.', Font(italic=True, color='5A5670')),
    ('', None),
    ('LE CIRCUIT', Font(bold=True, color=VIOLET)),
    ('Oriba Food / Oriba Rice  →  Grossistes  →  Dépôts (chaque chef d’équipe est un dépôt)  →  Agents du dépôt  →  Marchés.', Font(bold=True)),
    ('Les grossistes s’approvisionnent chez Oriba Food ou Oriba Rice ; les chefs d’équipe chez les grossistes ; les agents reçoivent leurs cartons de leur chef d’équipe et vendent sur leur marché.', None),
    ('', None),
    ('CHAQUE JOUR', Font(bold=True, color=VIOLET)),
    ('1. Ajoutez les opérations de la journée à la suite, dans les onglets 1 à 7 (une ligne par opération). Ne supprimez pas les lignes des jours précédents.', None),
    ('2. Dans les cases à liste, cliquez la petite flèche pour choisir, ou écrivez directement le nom (majuscules et accents ne comptent pas).', None),
    ('3. Les cases bleues se calculent seules (montants) : ne les remplissez pas.', None),
    ('4. Enregistrez puis importez le fichier dans l’ERP. Un contrôle s’affiche avant l’enregistrement : lignes nouvelles, déjà présentes, refusées (avec la raison).', None),
    ('   Réimporter le même fichier ne crée aucun doublon : seules les lignes nouvelles sont ajoutées.', None),
    ('5. Onglet « Tableau de bord » : CA, ventes comptant et crédit, encaissements, créances, plafond, ventes par vendeur, par marché, par produit et par mois (choisissez la période en haut).', None),
    ('   Onglet « Créances par client » : ce que chaque client doit encore. Onglet « Tableau du jour » : les totaux d’une journée.', None),
    ('6. Crédit : dans 4-Ventes, la date promesse va dans « Échéance » ; chaque remboursement va dans 5-Versements avec le N° de la vente. Le solde, les jours de retard et le statut se calculent seuls.', None),
    ('', None),
    ('LES ONGLETS DE SAISIE', Font(bold=True, color=VIOLET)),
    ('4-Ventes : ventes au comptant ou à crédit, par un dépôt ou un agent, avec le marché, le client, l’unité (carton ou pack). Crédit : client, date promesse et N° de vente (ex. V001) obligatoires. Déjà rempli avec l’historique des TB des équipes (Tahoua, Balleyara, Konni, Niamey 1, Niamey 2), de mai à octobre 2026.', None),
    ('5-Versements : argent versé (Ventes comptant), remboursement d’un crédit (avec le N° de la vente), ou règlement d’un grossiste. Indiquez pour Oriba Food ou Oriba Rice.', None),
    ('2-Appro dépôts : cartons reçus par un dépôt, d’Oriba Food, d’Oriba Rice ou d’un grossiste.', None),
    ('3-Remises agents : cartons donnés par un dépôt à un de ses agents.', None),
    ('1-Appro grossistes : cartons reçus par un grossiste, d’Oriba Food ou d’Oriba Rice.', None),
    ('7-Dépenses : une ligne par dépense (salaires, carburant, réparations, vidanges, assurances…). Vidange et assurance : indiquez le véhicule. Les dépenses importées arrivent « à valider » dans Logistique et charges > Validation.', None),
    ('8-Objectifs : objectif du mois en cartons par agent (ou par équipe). Déjà rempli pour novembre et décembre 2026 ; modifiez un chiffre puis réimportez.', None),
    ('9-Budgets : budget mensuel par équipe et nature de dépense. Déjà rempli pour novembre et décembre 2026.', None),
    ('', None),
    ('LES LISTES', Font(bold=True, color=VIOLET)),
    ('Dépôts, Agents, Clients, Grossistes : reprises de votre base de données. Un nouveau client, agent ou grossiste ? Ajoutez-le d’abord dans sa liste : il sera créé à l’import.', None),
    ('Dépôts : stock et reste à encaisser (Oriba Food / Oriba Rice) au départ du 04/11/2026. Ne les modifiez que pour corriger la situation de départ.', None),
    ('Paramètres : produits, prix de référence et date de départ.', None),
    ('', None),
    ('RÈGLES', Font(bold=True, color=VIOLET)),
    ('• Dates au format JJ/MM/AAAA (ex. 04/11/2026). Mois au format MM/AAAA (ex. 11/2026).', None),
    ('• Mode : Comptant ou Crédit.   • Lieu du versement : Caisse Oriba ou Chez le grossiste.   • Argent pour : Oriba Food ou Oriba Rice.', None),
    ('• Les ventes, approvisionnements et dépenses déjà enregistrés avant le 04/11/2026 (reprise des fichiers) sont déjà dans l’ERP : pas besoin de les ressaisir.', None),
]
for i, (t, f) in enumerate(txt, 1):
    c = ws.cell(row=i, column=1, value=t)
    if f: c.font = f
ws.column_dimensions['A'].width = 150

# ---------- Listes
feuille('Paramètres', 'Paramètres', 'Produits et prix de référence (FCFA le carton), date de départ du suivi.', ['Produit', 'Catégorie', 'Prix de référence (FCFA)'], [30, 14, 22],
        [list(p) for p in PRODUITS] + [[None, None, None], ['Date des stocks initiaux', None, DEPART]], nombres=(3,))
wb['Paramètres'].cell(row=5 + len(PRODUITS) + 1, column=2, value=DEPART).number_format = 'DD/MM/YYYY'
wb['Paramètres'].cell(row=5 + len(PRODUITS) + 1, column=3).value = None
feuille('Dépôts', 'Dépôts (chefs d’équipe)', 'Chaque chef d’équipe est un dépôt : il s’approvisionne chez les grossistes et confie des cartons à ses agents. Situation au départ (04/11/2026).',
        ['Code', 'Nom', 'Zone', 'Grossiste habituel', 'Téléphone', 'Stock initial (cartons)', 'Prix du carton (FCFA)', 'Reste à encaisser au départ — Oriba Food (FCFA)', 'Reste à encaisser au départ — Oriba Rice (FCFA)', 'Responsable (chef d’équipe)', 'Marché du chef d’équipe'],
        [10, 22, 18, 18, 14, 14, 14, 22, 22, 32, 18], DEPOTS, vides=10, nombres=(6, 7, 8, 9))
feuille('Agents', 'Agents des dépôts', 'Agents envoyés par chaque chef d’équipe (dépôt) sur les marchés. Colonne E : le marché de l’agent.', ['Code', 'Nom', 'Dépôt', 'Fonction', 'Localité / marché', 'Téléphone', 'Stock initial (cartons)'],
        [10, 32, 18, 30, 18, 14, 14], AGENTS, vides=40, nombres=(7,))
liste(wb['Agents'], 'C', '=Choix!$A$2:$A$40', len(AGENTS) + 40, 'Dépôt (chef d’équipe) de l’agent'); liste(wb['Agents'], 'E', '=Choix!$Q$2:$Q$80', len(AGENTS) + 40, 'Marché de l’agent')
liste(wb['Dépôts'], 'K', '=Choix!$Q$2:$Q$80', len(DEPOTS) + 10, 'Marché du chef d’équipe')
feuille('Clients', 'Clients', 'Clients des dépôts et des agents. Ajoutez ici tout nouveau client.', ['Code', 'Nom', 'Vendeur rattaché', 'Localité', 'Téléphone', 'Plafond (cartons)'],
        [10, 32, 22, 18, 14, 12], CLIENTS, vides=150)
feuille('Grossistes', 'Grossistes', 'Les grossistes ne s’approvisionnent que chez Oriba Food ou Oriba Rice. Ajoutez-les ici.',
        ['Code', 'Nom', 'Localité', 'Fournisseur habituel', 'Téléphone', 'Stock initial (cartons)', 'Solde dû au départ (FCFA)'], [10, 30, 18, 20, 14, 14, 18], GROSSISTES, vides=60, nombres=(6, 7))
liste(wb['Grossistes'], 'D', '=Choix!$J$2:$J$3', len(GROSSISTES) + 60, 'Oriba Food ou Oriba Rice')

# ---------- Journaux
j1 = feuille('1-Appro grossistes', '1 · Approvisionnement des grossistes', 'Cartons reçus par les grossistes, d’Oriba Food ou d’Oriba Rice.',
             ['Date', 'Grossiste', 'Fournisseur (Oriba Food / Oriba Rice)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Observation', 'Montant (calculé)'], [13, 28, 22, 22, 10, 15, 28, 16],
             vides=LIGNES, couleur=VIOLET, dates=(1,), nombres=(6, 8), calc=(8,))
montant(j1, 'H', 'E', 'F', LIGNES)
liste(j1, 'B', '=Choix!$F$2:$F$101', LIGNES, 'Grossiste'); liste(j1, 'C', '=Choix!$J$2:$J$3', LIGNES, 'Oriba Food ou Oriba Rice'); liste(j1, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')
j2 = feuille('2-Appro dépôts', '2 · Approvisionnement des dépôts', 'Cartons reçus par les dépôts : d’Oriba Food, d’Oriba Rice ou d’un grossiste.',
             ['Date', 'Dépôt', 'Source (Oriba Food, Oriba Rice ou grossiste)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Mode de paiement (Comptant / Crédit)', 'Observation', 'Montant (calculé)'],
             [13, 20, 28, 22, 10, 15, 18, 26, 16], vides=LIGNES, couleur=VIOLET, dates=(1,), nombres=(6, 9), calc=(9,))
montant(j2, 'I', 'E', 'F', LIGNES)
liste(j2, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt'); liste(j2, 'C', '=Choix!$G$2:$G$103', LIGNES, 'Oriba Food, Oriba Rice ou un grossiste')
liste(j2, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit'); liste(j2, 'G', '=Choix!$H$2:$H$3', LIGNES, 'Comptant ou Crédit')
j3 = feuille('3-Remises agents', '3 · Remises de cartons aux agents', 'Cartons donnés par un dépôt à un de ses agents.',
             ['Date', 'Dépôt', 'Agent', 'Produit', 'Cartons', 'Observation'], [13, 20, 32, 22, 10, 30], vides=LIGNES, couleur=VIOLET, dates=(1,))
liste(j3, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt'); liste(j3, 'C', '=Choix!$B$2:$B$151', LIGNES, 'Agent'); liste(j3, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')
NV = len(HIST_V) + 800
j4 = feuille('4-Ventes', '4 · Ventes aux clients (comptant et crédit)', 'Une ligne par vente. Crédit : client, date promesse (échéance) et N° de vente obligatoires. Les cases bleues se calculent seules.' + (f' Lignes de mai à octobre 2026 : reprise des fichiers {TB_NOM}.' if TB_NOM else ''),
             ['Date', 'Vendeur (dépôt ou agent)', 'Marché / village', 'Client / acheteur', 'Produit', 'Unité (Carton / Pack)', 'Quantité', 'Prix unitaire (FCFA)', 'Mode (Comptant / Crédit)', 'Échéance / date promesse (si crédit)', 'N° vente', 'Observation',
              'Montant (calculé)', 'Remboursé (calculé)', 'Solde restant (calculé)', 'Jours de retard (calculé)', 'Statut (calculé)', 'Mois (calculé)', 'Cartons (calculé)', 'Quantité restant à verser (calculé)', 'Dépôt / équipe (calculé)'],
             [12, 28, 18, 28, 20, 10, 9, 12, 12, 14, 11, 20, 14, 14, 14, 10, 20, 10, 10, 12, 20], HIST_V, vides=NV - len(HIST_V), dates=(1, 10), nombres=(8, 13, 14, 15), calc=(13, 14, 15, 16, 17, 18, 19, 20, 21))
for r in range(5, 5 + NV):
    j4[f'M{r}'] = f'=IF(OR(G{r}="",H{r}=""),"",G{r}*H{r})'
    j4[f'N{r}'] = f'=IF(OR(K{r}="",I{r}<>"Crédit"),"",SUMIFS(\'5-Versements\'!$G:$G,\'5-Versements\'!$D:$D,K{r},\'5-Versements\'!$C:$C,"Remboursement crédit"))'
    j4[f'O{r}'] = f'=IF(OR(M{r}="",I{r}<>"Crédit"),"",MAX(0,M{r}-N(N{r})))'
    j4[f'P{r}'] = f'=IF(OR(O{r}="",O{r}=0,J{r}=""),"",MAX(0,TODAY()-J{r}))'
    j4[f'Q{r}'] = f'=IF(O{r}="","",IF(O{r}=0,"Soldé",IF(N(P{r})>0,"En retard",IF(N(N{r})>0,"Partiellement remboursé","En attente"))))'
    j4[f'R{r}'] = f'=IF(A{r}="","",YEAR(A{r})&"-"&TEXT(MONTH(A{r}),"00"))'
    j4[f'S{r}'] = f'=IF(G{r}="","",IF(F{r}="Pack",G{r}/12,G{r}))'
    j4[f'T{r}'] = f'=IF(N(O{r})>0,O{r}/H{r},"")'
    j4[f'U{r}'] = f'=IF(B{r}="","",IF(COUNTIF(Dépôts!$B$5:$B$40,B{r})>0,B{r},IFERROR(VLOOKUP(B{r},Agents!$B$5:$C$300,2,FALSE),"")))'
j4.auto_filter.ref = f'A4:U{4 + NV}'
liste(j4, 'B', '=Choix!$C$2:$C$191', NV, 'Dépôt ou agent qui a vendu'); liste(j4, 'C', '=Choix!$Q$2:$Q$80', NV, 'Marché / village de la vente'); liste(j4, 'D', '=Choix!$D$2:$D$401', NV, 'Client')
liste(j4, 'E', '=Choix!$E$2:$E$20', NV, 'Produit'); liste(j4, 'F', '=Choix!$R$2:$R$3', NV, 'Carton ou Pack'); liste(j4, 'I', '=Choix!$H$2:$H$3', NV, 'Comptant ou Crédit')
from openpyxl.formatting.rule import FormulaRule
j4.conditional_formatting.add(f'Q5:Q{4 + NV}', FormulaRule(formula=['$Q5="En retard"'], font=Font(bold=True, color='B71C1C'), fill=PatternFill('solid', fgColor='FDE7E7')))
j4.conditional_formatting.add(f'Q5:Q{4 + NV}', FormulaRule(formula=['$Q5="Soldé"'], font=Font(color='2E7D32')))
NR = len(HIST_R) + LIGNES
j5 = feuille('5-Versements', '5 · Versements et remboursements', 'Argent versé à la caisse Oriba ou chez le grossiste ; remboursements de crédits (avec le N° de la vente) ; règlements des grossistes.',
             ['Date', 'Versé par', 'Objet', 'N° vente (si remboursement)', 'Lieu du versement', 'Grossiste (si versé chez lui)', 'Montant (FCFA)', 'Argent pour (Oriba Food / Oriba Rice)'],
             [13, 32, 22, 14, 18, 26, 15, 18], HIST_R, vides=LIGNES, dates=(1,), nombres=(7,))
liste(j5, 'B', '=Choix!$K$2:$K$291', NR, 'Dépôt, agent ou grossiste qui verse'); liste(j5, 'C', '=Choix!$I$2:$I$4', NR, 'Objet du versement')
liste(j5, 'E', '=Choix!$L$2:$L$3', NR, 'Caisse Oriba ou Chez le grossiste'); liste(j5, 'F', '=Choix!$F$2:$F$101', NR, 'Grossiste'); liste(j5, 'H', '=Choix!$J$2:$J$3', NR, 'Oriba Food ou Oriba Rice')
# Dépenses : celles du 03/11/2026 (reprise du fichier Budget) déjà enregistrées dans l'ERP — reconnues à l'import, jamais en double
J03 = dt.date(2026, 11, 3)
dep_rows = [[J03, e, n, v, None, None, None, f'Reprise du fichier Budget Équipes Commerciales — {e} — {n}'] for e, vals in BUD.items() for n, v in zip(NATURES_B, vals) if v]
j7 = feuille('7-Dépenses', '7 · Dépenses', 'Une ligne par dépense. Les lignes du 03/11/2026 sont la reprise déjà enregistrée dans l’ERP ; ajoutez les nouvelles à la suite.',
             ['Date', 'Équipe ou dépôt', 'Nature de la dépense', 'Montant (FCFA)', 'Bénéficiaire', 'Véhicule (immatriculation)', 'N° pièce', 'Description / motif'],
             [13, 22, 30, 15, 24, 16, 12, 46], dep_rows, vides=LIGNES, couleur=VIOLET, dates=(1,), nombres=(4,))
n7 = len(dep_rows) + LIGNES
liste(j7, 'B', '=Choix!$M$2:$M$60', n7, 'Équipe (ou dépôt)'); liste(j7, 'C', '=Choix!$N$2:$N$20', n7, 'Nature de la dépense'); liste(j7, 'F', '=Choix!$O$2:$O$20', n7, 'Véhicule')
obj_rows = [[m, a, q] for m in ('11/2026', '12/2026') for a, q in OBJ_AG + OBJ_EQ]
j8 = feuille('8-Objectifs', '8 · Objectifs de vente', 'Objectif du mois en cartons par agent (ou par équipe), repris de votre fichier « Données force de vente ».',
             ['Mois', 'Agent ou équipe', 'Objectif (cartons)'], [12, 34, 16], obj_rows, vides=150, nombres=(3,))
for r in range(5, 5 + len(obj_rows) + 150): j8[f'A{r}'].number_format = '@'
liste(j8, 'B', '=Choix!$P$2:$P$220', len(obj_rows) + 150, 'Agent ou équipe')
bud_rows = [[m, e, n, v] for m in ('11/2026', '12/2026') for e, vals in BUD.items() for n, v in zip(NATURES_B, vals) if v]
j9 = feuille('9-Budgets', '9 · Budgets du mois', 'Budget mensuel par équipe et nature, repris du fichier Budget Équipes Commerciales.',
             ['Mois', 'Équipe', 'Nature de la dépense', 'Budget (FCFA)'], [12, 22, 30, 16], bud_rows, vides=120, couleur=VIOLET, nombres=(4,))
for r in range(5, 5 + len(bud_rows) + 120): j9[f'A{r}'].number_format = '@'
liste(j9, 'B', '=Choix!$M$2:$M$11', len(bud_rows) + 120, 'Équipe'); liste(j9, 'C', '=Choix!$N$2:$N$20', len(bud_rows) + 120, 'Nature de la dépense')

# ---------- Tableau du jour (rien à saisir sauf la date)
tb = wb.create_sheet('Tableau du jour')
tb['A1'] = 'Tableau du jour'; tb['A1'].font = Font(bold=True, size=15, color=VERT_F)
tb['A2'] = 'Choisissez la date en B4 : les totaux se calculent à partir des onglets de saisie.'; tb['A2'].font = Font(italic=True, color='5A5670')
tb['A4'] = 'Date'; tb['A4'].font = Font(bold=True)
tb['B4'] = dt.date(2026, 11, 4); tb['B4'].number_format = 'DD/MM/YYYY'; tb['B4'].fill = PatternFill('solid', fgColor='FFF8E1'); tb['B4'].font = Font(bold=True, size=12)
for j, h in enumerate(['Indicateur', 'Ce jour', 'Depuis le 1er du mois', 'Unité'], 1):
    c = tb.cell(row=6, column=j, value=h); c.font = Font(bold=True, color=BLANC); c.fill = PatternFill('solid', fgColor=VERT); c.border = BORD
D1 = 'DATE(YEAR($B$4),MONTH($B$4),1)'
def jour(f, col, crit=''):
    return f"=SUMIFS('{f}'!{col}:{col},'{f}'!A:A,$B$4{crit})"
def mois(f, col, crit=''):
    return f"=SUMIFS('{f}'!{col}:{col},'{f}'!A:A,\">=\"&{D1},'{f}'!A:A,\"<=\"&$B$4{crit})"
IND = [
    ('Ventes au comptant', '4-Ventes', 'M', ",'4-Ventes'!I:I,\"Comptant\"", 'FCFA'),
    ('Ventes à crédit', '4-Ventes', 'M', ",'4-Ventes'!I:I,\"Crédit\"", 'FCFA'),
    ('Cartons vendus', '4-Ventes', 'S', '', 'cartons'),
    ('Versements (ventes comptant)', '5-Versements', 'G', ",'5-Versements'!C:C,\"Ventes comptant\"", 'FCFA'),
    ('  dont pour Oriba Food', '5-Versements', 'G', ",'5-Versements'!C:C,\"Ventes comptant\",'5-Versements'!H:H,\"Oriba Food\"", 'FCFA'),
    ('  dont pour Oriba Rice', '5-Versements', 'G', ",'5-Versements'!C:C,\"Ventes comptant\",'5-Versements'!H:H,\"Oriba Rice\"", 'FCFA'),
    ('Remboursements de crédits', '5-Versements', 'G', ",'5-Versements'!C:C,\"Remboursement crédit\"", 'FCFA'),
    ('Règlements des grossistes', '5-Versements', 'G', ",'5-Versements'!C:C,\"Règlement grossiste\"", 'FCFA'),
    ('Cartons reçus par les dépôts', '2-Appro dépôts', 'E', '', 'cartons'),
    ('Cartons remis aux agents', '3-Remises agents', 'E', '', 'cartons'),
    ('Cartons reçus par les grossistes', '1-Appro grossistes', 'E', '', 'cartons'),
    ('Dépenses', '7-Dépenses', 'D', '', 'FCFA'),
]
for i, (lib, f, col, crit, u) in enumerate(IND, 7):
    tb.cell(row=i, column=1, value=lib).border = BORD
    for j, fx in ((2, jour(f, col, crit)), (3, mois(f, col, crit))):
        c = tb.cell(row=i, column=j, value=fx); c.number_format = '#,##0'; c.border = BORD; c.fill = PatternFill('solid', fgColor=BLEU)
    tb.cell(row=i, column=4, value=u).border = BORD
    if lib.startswith('  '): tb.cell(row=i, column=1).font = Font(italic=True, color='5A5670')
tb.column_dimensions['A'].width = 36; tb.column_dimensions['B'].width = 18; tb.column_dimensions['C'].width = 22; tb.column_dimensions['D'].width = 10

# ---------- Tableau de bord (présentation du TB des équipes : bandeau, cartes de couleur, tableaux, graphiques)
from openpyxl.formatting.rule import FormulaRule, DataBarRule, CellIsRule
from openpyxl.chart import BarChart, PieChart, LineChart, Reference
from openpyxl.chart.label import DataLabelList
NAVY, VERT2, ROUGE, AMBRE, VIOL2, BLEU2, GRIS2, CLAIR = '1F4E79', '548235', 'C00000', 'FFC000', '9B59B6', '2E75B6', '404040', 'F2F2F2'
JAUNE = PatternFill('solid', fgColor='FFF2CC')
def P(c): return PatternFill('solid', fgColor=c)
def bandeau(ws, r, c1, c2, texte, couleur, taille=12, h=None, align='left'):
    ws.merge_cells(start_row=r, start_column=c1, end_row=r, end_column=c2)
    c = ws.cell(row=r, column=c1, value=texte); c.font = Font(bold=True, size=taille, color=BLANC); c.alignment = Alignment(horizontal=align, vertical='center', indent=1 if align == 'left' else 0)
    for j in range(c1, c2 + 1): ws.cell(row=r, column=j).fill = P(couleur)
    if h: ws.row_dimensions[r].height = h
def carte(ws, r, c1, lib, f, couleur, fmt='#,##0', texte=BLANC, taille=18):
    for rr, v, sz in ((r, lib, 10), (r + 1, f, taille)):
        ws.merge_cells(start_row=rr, start_column=c1, end_row=rr, end_column=c1 + 1)
        c = ws.cell(row=rr, column=c1, value=v); c.font = Font(bold=True, size=sz, color=texte); c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        if rr == r + 1: c.number_format = fmt
        for j in (c1, c1 + 1): ws.cell(row=rr, column=j).fill = P(couleur); ws.cell(row=rr, column=j).border = Border(left=Side(style='thin', color=BLANC), right=Side(style='thin', color=BLANC))
def entete(ws, r, c1, hs, couleur=NAVY):
    for j, h in enumerate(hs, c1):
        c = ws.cell(row=r, column=j, value=h); c.font = Font(bold=True, color=BLANC, size=10); c.fill = P(couleur); c.border = BORD; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[r].height = 30
def cell(ws, r, j, v, fmt='#,##0', band=False, bold=False, couleur=None):
    c = ws.cell(row=r, column=j, value=v); c.number_format = fmt; c.border = BORD; c.font = Font(size=10, bold=bold, color=couleur or '000000')
    if band: c.fill = P('DDEBF7')
    return c
fin2 = Side(style='thin', color='BFBFBF'); BORD = Border(left=fin2, right=fin2, top=fin2, bottom=fin2)

TBD = wb.create_sheet('Tableau de bord')
TBD.sheet_view.showGridLines = False; TBD.sheet_properties.tabColor = NAVY
for j in range(1, 15): TBD.column_dimensions[L(j)].width = 14.5
TBD.column_dimensions['A'].width = 30; TBD.column_dimensions['B'].width = 26
bandeau(TBD, 1, 1, 14, 'TABLEAU DE BORD — ORIBA FOODS · FORCE DE VENTE (TOUTES LES ÉQUIPES)', NAVY, 18, 40, 'center')
TBD['A2'] = 'Mis à jour le'; TBD['A2'].font = Font(color='666666', italic=True); TBD['B2'] = '=TODAY()'; TBD['B2'].number_format = 'DD/MM/YYYY'; TBD['B2'].font = Font(color='666666', italic=True)
TBD['D2'] = 'Tout se calcule à partir des onglets 4-Ventes et 5-Versements. Seules les cases jaunes se modifient.'; TBD['D2'].font = Font(color='666666', italic=True)
TBD['A3'] = 'Période du'; TBD['B3'] = dt.date(2026, 5, 1); TBD['C3'] = 'au'; TBD['D3'] = '=TODAY()'
TBD['F3'] = 'Plafond des créances (cartons)'; TBD['H3'] = sum(p for _, p in PLAF) or 1000; TBD['J3'] = 'Seuil d’alerte (jours)'; TBD['L3'] = 7
for k in ('A3', 'C3', 'F3', 'J3'): TBD[k].font = Font(bold=True, color=NAVY); TBD[k].alignment = Alignment(horizontal='right')
for k, fmt in (('B3', 'DD/MM/YYYY'), ('D3', 'DD/MM/YYYY'), ('H3', '#,##0'), ('L3', '0')):
    TBD[k].fill = JAUNE; TBD[k].font = Font(bold=True, color='0000FF'); TBD[k].number_format = fmt; TBD[k].border = BORD; TBD[k].alignment = Alignment(horizontal='center')
TBD['M3'] = ' + '.join(f'{z} {p:,.0f}'.replace(',', ' ') for z, p in PLAF); TBD['M3'].font = Font(italic=True, size=8, color='666666')
TBD.row_dimensions[3].height = 22
V = "'4-Ventes'"; VS = "'5-Versements'"
PER = f',{V}!$A:$A,">="&$B$3,{V}!$A:$A,"<="&$D$3'
PERV = f',{VS}!$A:$A,">="&$B$3,{VS}!$A:$A,"<="&$D$3'
# Cartes principales
TBD.row_dimensions[5].height = 26; TBD.row_dimensions[6].height = 44
carte(TBD, 5, 1, 'CA TOTAL (FCFA)', f'=SUMIFS({V}!$M:$M{PER})', NAVY)
carte(TBD, 5, 3, 'VENTES COMPTANT (FCFA)', f'=SUMIFS({V}!$M:$M,{V}!$I:$I,"Comptant"{PER})', VERT2)
carte(TBD, 5, 5, 'VENTES CRÉDIT (FCFA)', f'=SUMIFS({V}!$M:$M,{V}!$I:$I,"Crédit"{PER})', ROUGE)
carte(TBD, 5, 7, 'MONTANT ENCAISSÉ (FCFA)', f'=SUMIFS({VS}!$G:$G,{VS}!$C:$C,"Ventes comptant"{PERV})+SUMIFS({VS}!$G:$G,{VS}!$C:$C,"Remboursement crédit"{PERV})', BLEU2)
carte(TBD, 5, 9, 'SOLDE DES CRÉANCES (FCFA)', f'=SUM({V}!$O:$O)', AMBRE, texte='000000')
carte(TBD, 5, 11, 'QTÉ EN CRÉANCE (CARTONS)', f'=SUM({V}!$T:$T)', VIOL2)
carte(TBD, 5, 13, 'CARTONS VENDUS', f'=SUMIFS({V}!$S:$S{PER})', GRIS2)
# Cartes de contrôle (fond gris clair)
TBD.row_dimensions[8].height = 26; TBD.row_dimensions[9].height = 40
carte(TBD, 8, 1, 'PLAFOND DES CRÉANCES', '=H3', CLAIR, texte='000000', taille=16)
carte(TBD, 8, 3, '% UTILISATION DU PLAFOND', '=IF($H$3>0,K6/$H$3,0)', CLAIR, '0.0 %', texte='000000', taille=16)
carte(TBD, 8, 5, 'STATUT DU PLAFOND', '=IF(C9>=1,"🚨 Dépassé",IF(C9>=0.8,"⚠️ Proche","✅ Normal"))', CLAIR, '@', texte='000000', taille=14)
carte(TBD, 8, 7, 'CRÉANCES EN RETARD', f'=COUNTIF({V}!$Q:$Q,"En retard")', CLAIR, texte=ROUGE, taille=16)
carte(TBD, 8, 9, 'RETARD > SEUIL', f'=COUNTIFS({V}!$Q:$Q,"En retard",{V}!$P:$P,">"&$L$3)', CLAIR, texte=ROUGE, taille=16)
carte(TBD, 8, 11, 'CLIENTS DÉBITEURS ACTIFS', "=COUNTIF('Créances par client'!D5:D254,\">0\")", CLAIR, texte='000000', taille=16)
carte(TBD, 8, 13, 'NOMBRE DE VENTES', f'=COUNTIFS({V}!$M:$M,">0"{PER})', CLAIR, texte='000000', taille=16)
TBD.conditional_formatting.add('C9', CellIsRule(operator='greaterThanOrEqual', formula=['0.8'], font=Font(bold=True, color=ROUGE, size=16)))
# Ventes par équipe (dépôt = chef d'équipe)
r0 = 11
bandeau(TBD, r0, 1, 11, 'VENTES PAR ÉQUIPE  ·  DÉPÔT = CHEF D’ÉQUIPE', BLEU2, 12, 22)
entete(TBD, r0 + 1, 1, ['Dépôt', 'Chef d’équipe', 'Qté comptant (ctn)', 'Qté crédit (ctn)', 'Qté totale (ctn)', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)', 'Part du CA', 'Créances en cours (FCFA)', 'Crédits en retard'])
NEQ = len(DEPOTS) + 2
for i in range(NEQ):
    r = r0 + 2 + i; b = i % 2 == 1
    cell(TBD, r, 1, f'=Dépôts!B{5 + i}&""', '@', b, True); cell(TBD, r, 2, f'=Dépôts!J{5 + i}&""', '@', b)
    k = f'{V}!$U:$U,$A{r}'
    cell(TBD, r, 3, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Comptant"{PER}))', '#,##0', b); cell(TBD, r, 4, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Crédit"{PER}))', '#,##0', b)
    cell(TBD, r, 5, f'=IF($A{r}="","",N(C{r})+N(D{r}))', '#,##0', b, True)
    cell(TBD, r, 6, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Comptant"{PER}))', '#,##0', b); cell(TBD, r, 7, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"{PER}))', '#,##0', b)
    cell(TBD, r, 8, f'=IF($A{r}="","",N(F{r})+N(G{r}))', '#,##0', b, True); cell(TBD, r, 9, f'=IF(OR($A{r}="",$A$6=0),"",H{r}/$A$6)', '0.0 %', b)
    cell(TBD, r, 10, f'=IF($A{r}="","",SUMIFS({V}!$O:$O,{k}))', '#,##0', b, couleur=ROUGE); cell(TBD, r, 11, f'=IF($A{r}="","",COUNTIFS({k},{V}!$Q:$Q,"En retard"))', '0', b)
rt = r0 + 2 + NEQ
cell(TBD, rt, 1, 'TOTAL', '@', bold=True)
for j in (3, 4, 5, 6, 7, 8, 10, 11):
    cell(TBD, rt, j, f'=SUM({L(j)}{r0 + 2}:{L(j)}{rt - 1})', '#,##0', bold=True)
for j in range(1, 12): TBD.cell(row=rt, column=j).fill = P('BDD7EE')
TBD.conditional_formatting.add(f'H{r0 + 2}:H{rt - 1}', DataBarRule(start_type='num', start_value=0, end_type='max', color='5B9BD5'))
# Graphiques : CA par équipe (comptant / crédit) et répartition par marché
g1 = rt + 2
ch = BarChart(); ch.type = 'col'; ch.grouping = 'stacked'; ch.overlap = 100; ch.title = 'Chiffre d’affaires par équipe (FCFA)'; ch.y_axis.title = 'FCFA'; ch.height = 8; ch.width = 17
ch.add_data(Reference(TBD, min_col=6, max_col=7, min_row=r0 + 1, max_row=r0 + 1 + len(DEPOTS)), titles_from_data=True); ch.set_categories(Reference(TBD, min_col=1, min_row=r0 + 2, max_row=r0 + 1 + len(DEPOTS)))
ch.series[0].graphicalProperties.solidFill = VERT2; ch.series[1].graphicalProperties.solidFill = ROUGE; ch.legend.position = 'b'
TBD.add_chart(ch, f'A{g1}')
# Ventes par marché (tableau + top 8 pour le camembert)
r1 = g1 + 18
bandeau(TBD, r1, 1, 8, 'VENTES PAR MARCHÉ / VILLAGE', VERT2, 12, 22)
entete(TBD, r1 + 1, 1, ['Marché / village', 'Qté comptant (ctn)', 'Qté crédit (ctn)', 'Qté totale (ctn)', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)', 'Part du CA'], VERT2)
MKS = LISTE_MARCHES + ['(sans marché)']
for i, m in enumerate(MKS):
    r = r1 + 2 + i; b = i % 2 == 1
    cell(TBD, r, 1, m, '@', b, True)
    k = f'{V}!$C:$C,{"$A" + str(r) if i < len(LISTE_MARCHES) else chr(34) + chr(34)}'
    cell(TBD, r, 2, f'=SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Comptant"{PER})', '#,##0', b); cell(TBD, r, 3, f'=SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Crédit"{PER})', '#,##0', b)
    cell(TBD, r, 4, f'=B{r}+C{r}', '#,##0', b, True); cell(TBD, r, 5, f'=SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Comptant"{PER})', '#,##0', b); cell(TBD, r, 6, f'=SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"{PER})', '#,##0', b)
    cell(TBD, r, 7, f'=E{r}+F{r}', '#,##0', b, True); cell(TBD, r, 8, f'=IF($A$6=0,"",G{r}/$A$6)', '0.0 %', b)
    TBD.cell(row=r, column=16, value=f'=G{r}+ROW()/1000000')          # clé de tri (colonne masquée)
rm2 = r1 + 1 + len(MKS)
TBD.conditional_formatting.add(f'G{r1 + 2}:G{rm2}', DataBarRule(start_type='num', start_value=0, end_type='max', color='70AD47'))
TBD.column_dimensions['P'].hidden = True
# Top 8 marchés + autres
bandeau(TBD, r1, 10, 12, 'TOP 8 DES MARCHÉS', VERT2, 11, 22)
entete(TBD, r1 + 1, 10, ['Marché', 'CA total (FCFA)', 'Part'], VERT2)
rng = f'$P${r1 + 2}:$P${rm2}'
for k in range(1, 9):
    r = r1 + 1 + k
    cell(TBD, r, 10, f'=IF(LARGE({rng},{k})<1,"",INDEX($A${r1 + 2}:$A${rm2},MATCH(LARGE({rng},{k}),{rng},0)))', '@', k % 2 == 0, True)
    cell(TBD, r, 11, f'=IF(J{r}="",0,INDEX($G${r1 + 2}:$G${rm2},MATCH(LARGE({rng},{k}),{rng},0)))', '#,##0', k % 2 == 0)
    cell(TBD, r, 12, f'=IF($A$6=0,"",K{r}/$A$6)', '0.0 %', k % 2 == 0)
r = r1 + 10
cell(TBD, r, 10, 'Autres marchés', '@', bold=True); cell(TBD, r, 11, f'=MAX(0,$A$6-SUM(K{r1 + 2}:K{r1 + 9}))', '#,##0'); cell(TBD, r, 12, f'=IF($A$6=0,"",K{r}/$A$6)', '0.0 %')
pie = PieChart(); pie.title = 'Répartition du CA par marché'; pie.height = 8; pie.width = 12
pie.add_data(Reference(TBD, min_col=11, min_row=r1 + 1, max_row=r1 + 10), titles_from_data=True); pie.set_categories(Reference(TBD, min_col=10, min_row=r1 + 2, max_row=r1 + 10))
pie.dataLabels = DataLabelList(); pie.dataLabels.showPercent = True; pie.dataLabels.showVal = False; pie.dataLabels.showCatName = False; pie.dataLabels.showSerName = False; pie.dataLabels.showLegendKey = False; pie.legend.position = 'r'
TBD.add_chart(pie, f'H{g1}')
# Évolution mensuelle + ventes par produit
r3 = rm2 + 3
bandeau(TBD, r3, 1, 6, 'ÉVOLUTION MENSUELLE', NAVY, 12, 22)
entete(TBD, r3 + 1, 1, ['Mois', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)', 'Quantité (ctn)', 'Encaissé (FCFA)'])
MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
NM = 14
for i in range(NM):
    y, m = 2026 + (4 + i) // 12, (4 + i) % 12 + 1; mo = f'{y}-{m:02d}'; r = r3 + 2 + i; b = i % 2 == 1
    cell(TBD, r, 1, f'{MOIS_FR[m - 1]} {y}', '@', b, True); TBD.cell(row=r, column=17, value=mo)
    cell(TBD, r, 2, f'=SUMIFS({V}!$M:$M,{V}!$R:$R,$Q{r},{V}!$I:$I,"Comptant")', '#,##0', b); cell(TBD, r, 3, f'=SUMIFS({V}!$M:$M,{V}!$R:$R,$Q{r},{V}!$I:$I,"Crédit")', '#,##0', b)
    cell(TBD, r, 4, f'=B{r}+C{r}', '#,##0', b, True); cell(TBD, r, 5, f'=SUMIFS({V}!$S:$S,{V}!$R:$R,$Q{r})', '#,##0', b)
    d0, d1 = f'DATE({y},{m},1)', f'DATE({y + (m == 12)},{m % 12 + 1},1)'
    cell(TBD, r, 6, f'=SUMIFS({VS}!$G:$G,{VS}!$A:$A,">="&{d0},{VS}!$A:$A,"<"&{d1},{VS}!$C:$C,"<>Règlement grossiste")', '#,##0', b)
TBD.column_dimensions['Q'].hidden = True
lc = LineChart(); lc.title = 'Évolution mensuelle du chiffre d’affaires (FCFA)'; lc.height = 8; lc.width = 17; lc.legend.position = 'b'
lc.add_data(Reference(TBD, min_col=2, max_col=4, min_row=r3 + 1, max_row=r3 + 1 + NM), titles_from_data=True); lc.set_categories(Reference(TBD, min_col=1, min_row=r3 + 2, max_row=r3 + 1 + NM))
for s_, c_ in zip(lc.series, (VERT2, ROUGE, NAVY)): s_.graphicalProperties.line.solidFill = c_; s_.graphicalProperties.line.width = 28000; s_.smooth = False
TBD.add_chart(lc, f'H{r3}')
r4 = r3 + 3 + NM
bandeau(TBD, r4, 1, 4, 'VENTES PAR PRODUIT', VIOL2, 12, 22)
entete(TBD, r4 + 1, 1, ['Produit', 'Quantité (ctn)', 'CA (FCFA)', 'Part du CA'], VIOL2)
for i, p_ in enumerate(PRODUITS):
    r = r4 + 2 + i; b = i % 2 == 1
    cell(TBD, r, 1, p_[0], '@', b, True); cell(TBD, r, 2, f'=SUMIFS({V}!$S:$S,{V}!$E:$E,$A{r}{PER})', '#,##0', b)
    cell(TBD, r, 3, f'=SUMIFS({V}!$M:$M,{V}!$E:$E,$A{r}{PER})', '#,##0', b, True); cell(TBD, r, 4, f'=IF($A$6=0,"",C{r}/$A$6)', '0.0 %', b)
# Ventes par vendeur
r5 = r4 + 4 + len(PRODUITS)
bandeau(TBD, r5, 1, 8, 'VENTES PAR VENDEUR  ·  CHEFS D’ÉQUIPE (DÉPÔTS) ET AGENTS', BLEU2, 12, 22)
entete(TBD, r5 + 1, 1, ['Vendeur', 'Dépôt / équipe', 'Qté comptant (ctn)', 'Qté crédit (ctn)', 'Qté totale (ctn)', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)'])
nd = len(DEPOTS) + 3; NVd = nd + len(AGENTS) + 15
for i in range(NVd):
    r = r5 + 2 + i; b = i % 2 == 1
    src = f'Choix!C{2 + i}' if i < nd else f'Choix!C{42 + i - nd}'
    cell(TBD, r, 1, f'={src}&""', '@', b, True)
    cell(TBD, r, 2, f'=IF($A{r}="","",IF(COUNTIF(Dépôts!$B$5:$B$40,$A{r})>0,$A{r},IFERROR(VLOOKUP($A{r},Agents!$B$5:$C$300,2,FALSE),"")))', '@', b)
    k = f'{V}!$B:$B,$A{r}'
    cell(TBD, r, 3, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Comptant"{PER}))', '#,##0', b); cell(TBD, r, 4, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Crédit"{PER}))', '#,##0', b)
    cell(TBD, r, 5, f'=IF($A{r}="","",N(C{r})+N(D{r}))', '#,##0', b, True); cell(TBD, r, 6, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Comptant"{PER}))', '#,##0', b)
    cell(TBD, r, 7, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"{PER}))', '#,##0', b); cell(TBD, r, 8, f'=IF($A{r}="","",N(F{r})+N(G{r}))', '#,##0', b, True)
TBD.conditional_formatting.add(f'H{r5 + 2}:H{r5 + 1 + NVd}', DataBarRule(start_type='num', start_value=0, end_type='max', color='5B9BD5'))
TBD.freeze_panes = 'A4'
for ws_ in (TBD,):
    ws_.page_setup.orientation = 'landscape'; ws_.page_setup.fitToWidth = 1; ws_.page_setup.fitToHeight = 0; ws_.sheet_properties.pageSetUpPr.fitToPage = True

# ---------- Créances par client (présentation du « Suivi des créances » du TB)
CRC = wb.create_sheet('Créances par client')
CRC.sheet_view.showGridLines = False; CRC.sheet_properties.tabColor = ROUGE
bandeau(CRC, 1, 1, 8, 'SUIVI DES CRÉANCES PAR CLIENT', ROUGE, 16, 34, 'center')
CRC['A2'] = 'Ventes à crédit et remboursements de chaque client, toutes dates. Rien à saisir : tout vient de 4-Ventes et 5-Versements.'; CRC['A2'].font = Font(italic=True, color='666666')
entete(CRC, 4, 1, ['Client', 'Crédits accordés (FCFA)', 'Remboursé (FCFA)', 'Montant dû (FCFA)', 'Qté en créance (ctn)', 'Taux de remboursement', 'Crédits en retard', ''], ROUGE)
CRC.cell(row=4, column=8).fill = P(BLANC); CRC.cell(row=4, column=8).border = Border()
for i in range(250):
    r = 5 + i; b = i % 2 == 1
    cell(CRC, r, 1, f'=Choix!D{2 + i}&""', '@', b, True)
    k = f'{V}!$D:$D,$A{r}'
    cell(CRC, r, 2, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"))', '#,##0', b); cell(CRC, r, 3, f'=IF($A{r}="","",SUMIFS({V}!$N:$N,{k}))', '#,##0', b)
    cell(CRC, r, 4, f'=IF($A{r}="","",SUMIFS({V}!$O:$O,{k}))', '#,##0', b, True); cell(CRC, r, 5, f'=IF($A{r}="","",SUMIFS({V}!$T:$T,{k}))', '#,##0', b)
    cell(CRC, r, 6, f'=IF(OR($A{r}="",N(B{r})=0),"",C{r}/B{r})', '0 %', b); cell(CRC, r, 7, f'=IF($A{r}="","",COUNTIFS({k},{V}!$Q:$Q,"En retard"))', '0', b)
    CRC.cell(row=r, column=16, value=f'=N(D{r})+ROW()/1000000')
CRC.column_dimensions['P'].hidden = True
CRC.conditional_formatting.add('D5:D254', FormulaRule(formula=['N($G5)>0'], font=Font(bold=True, color=ROUGE), fill=P('FDE7E7')))
CRC.conditional_formatting.add('F5:F254', DataBarRule(start_type='num', start_value=0, end_type='num', end_value=1, color='70AD47'))
for c_, w in zip('ABCDEFG', [34, 18, 16, 16, 14, 14, 12]): CRC.column_dimensions[c_].width = w
CRC.freeze_panes = 'A5'; CRC.auto_filter.ref = 'A4:G254'
# Top 10 des débiteurs + graphique
bandeau(CRC, 3, 10, 12, 'TOP 10 DES CLIENTS DÉBITEURS', ROUGE, 11, 22)
entete(CRC, 4, 10, ['Client', 'Montant dû (FCFA)', 'Crédits en retard'], ROUGE)
for k in range(1, 11):
    r = 4 + k; b = k % 2 == 0
    cell(CRC, r, 10, f'=IF(LARGE($P$5:$P$254,{k})<1,"",INDEX($A$5:$A$254,MATCH(LARGE($P$5:$P$254,{k}),$P$5:$P$254,0)))', '@', b, True)
    cell(CRC, r, 11, f'=IF(J{r}="",0,INDEX($D$5:$D$254,MATCH(LARGE($P$5:$P$254,{k}),$P$5:$P$254,0)))', '#,##0', b, couleur=ROUGE)
    cell(CRC, r, 12, f'=IF(J{r}="","",INDEX($G$5:$G$254,MATCH(LARGE($P$5:$P$254,{k}),$P$5:$P$254,0)))', '0', b)
CRC.column_dimensions['J'].width = 30; CRC.column_dimensions['K'].width = 18; CRC.column_dimensions['L'].width = 14
bc = BarChart(); bc.type = 'bar'; bc.title = 'Top clients — créances en cours (FCFA)'; bc.height = 9; bc.width = 19; bc.legend = None
bc.add_data(Reference(CRC, min_col=11, min_row=4, max_row=14), titles_from_data=True); bc.set_categories(Reference(CRC, min_col=10, min_row=5, max_row=14))
bc.series[0].graphicalProperties.solidFill = ROUGE; bc.y_axis.scaling.orientation = 'minMax'; bc.x_axis.scaling.orientation = 'maxMin'
CRC.add_chart(bc, 'J17')

# ---------- Choix (feuille cachée) : les listes déroulantes suivent les onglets de listes
ch = wb.create_sheet('Choix')
ref = lambda f, r: f'=IF(\'{f}\'!B{r}="","",\'{f}\'!B{r})'
cols = {'A': 'Dépôts', 'B': 'Agents', 'C': 'Vendeurs', 'D': 'Clients', 'E': 'Produits', 'F': 'Grossistes', 'G': 'Sources', 'H': 'Modes', 'I': 'Objets', 'J': 'Fournisseurs',
        'K': 'Versé par', 'L': 'Lieux', 'M': 'Équipes', 'N': 'Natures', 'O': 'Véhicules', 'P': 'Agents et équipes', 'Q': 'Marchés', 'R': 'Unités'}
for c, t in cols.items(): ch[f'{c}1'] = t
for i in range(39): ch[f'A{2 + i}'] = ref('Dépôts', 5 + i)
for i in range(150): ch[f'B{2 + i}'] = ref('Agents', 5 + i)
for i in range(40): ch[f'C{2 + i}'] = ref('Dépôts', 5 + i)
for i in range(150): ch[f'C{42 + i}'] = ref('Agents', 5 + i)
for i in range(400): ch[f'D{2 + i}'] = ref('Clients', 5 + i)
for i, p in enumerate(PRODUITS): ch[f'E{2 + i}'] = p[0]
for i in range(100): ch[f'F{2 + i}'] = ref('Grossistes', 5 + i)
ch['G2'], ch['G3'] = 'Oriba Food', 'Oriba Rice'
for i in range(100): ch[f'G{4 + i}'] = ref('Grossistes', 5 + i)
ch['H2'], ch['H3'] = 'Comptant', 'Crédit'
ch['I2'], ch['I3'], ch['I4'] = 'Ventes comptant', 'Remboursement crédit', 'Règlement grossiste'
ch['J2'], ch['J3'] = 'Oriba Food', 'Oriba Rice'
for i in range(190): ch[f'K{2 + i}'] = f'=Choix!C{2 + i}'
for i in range(100): ch[f'K{192 + i}'] = f'=Choix!F{2 + i}'
ch['L2'], ch['L3'] = 'Caisse Oriba', 'Chez le grossiste'
for i, e in enumerate(EQUIPES): ch[f'M{2 + i}'] = e
for i in range(40): ch[f'M{2 + len(EQUIPES) + i}'] = ref('Dépôts', 5 + i)
for i, n in enumerate(NATURES): ch[f'N{2 + i}'] = n
for i, v in enumerate(VEHICULES): ch[f'O{2 + i}'] = v
for i in range(150): ch[f'P{2 + i}'] = ref('Agents', 5 + i)
for i, e in enumerate(EQUIPES): ch[f'P{152 + i}'] = e
for i in range(40): ch[f'P{165 + i}'] = ref('Dépôts', 5 + i)

for i, m in enumerate(LISTE_MARCHES): ch[f'Q{2 + i}'] = m
ch['R2'], ch['R3'] = 'Carton', 'Pack'
ch.sheet_state = 'hidden'

# ---------- Habillage : couleurs par onglet (comme les TB) — bandeau de titre, en-têtes, lignes alternées, cases calculées
def eclaircir(hexa, t=0.85):
    r, g, b = (int(hexa[i:i + 2], 16) for i in (0, 2, 4))
    return '%02X%02X%02X' % tuple(int(x + (255 - x) * t) for x in (r, g, b))
COUL = {'4-Ventes': NAVY, '5-Versements': VERT2, '2-Appro dépôts': BLEU2, '3-Remises agents': BLEU2, '1-Appro grossistes': '2F5597',
        '7-Dépenses': ROUGE, '8-Objectifs': '7030A0', '9-Budgets': 'BF8F00', 'Dépôts': 'BF8F00', 'Agents': 'BF8F00', 'Clients': 'BF8F00', 'Grossistes': 'BF8F00', 'Paramètres': 'BF8F00'}
fin3 = Side(style='thin', color='D9D9D9'); B3 = Border(left=fin3, right=fin3, top=fin3, bottom=fin3)
for nom, col in COUL.items():
    ws = wb[nom]; ws.sheet_view.showGridLines = False; ws.sheet_properties.tabColor = col; ws.sheet_view.zoomScale = 90
    nc = max(c.column for c in ws[4] if c.value) if any(c.value for c in ws[4]) else 8
    t1, t2 = ws['A1'].value, ws['A2'].value
    bandeau(ws, 1, 1, nc, t1, col, 15, 30)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=nc)
    ws['A2'] = t2; ws['A2'].font = Font(italic=True, size=10, color='595959'); ws['A2'].alignment = Alignment(wrap_text=True, vertical='center', indent=1)
    for j in range(1, nc + 1): ws.cell(row=2, column=j).fill = P(eclaircir(col, 0.9))
    ws.row_dimensions[2].height = 30; ws.row_dimensions[3].height = 6
    calc = [c.column for c in ws[4] if c.value and 'calcul' in str(c.value).lower()]
    for c in ws[4]:
        if not c.value: continue
        c.fill = P('595959' if c.column in calc else col); c.font = Font(bold=True, size=10, color=BLANC)
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True); c.border = B3
    ws.row_dimensions[4].height = 40
    band = P(eclaircir(col, 0.9)); calcf = P('EDEDED'); calc2 = P('E2E2E2')
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row, max_col=nc):
        alt = row[0].row % 2 == 0
        for c in row:
            c.border = B3
            if c.column in calc: c.fill = calc2 if alt else calcf; c.font = Font(size=10, italic=True, color='404040')
            else: c.fill = band if alt else P(BLANC); c.font = Font(size=10, color='000000', bold=c.column == 2 and nom in ('Dépôts', 'Agents', 'Clients', 'Grossistes'))
# Tableau du jour
tj = wb['Tableau du jour']; tj.sheet_view.showGridLines = False; tj.sheet_properties.tabColor = VERT2
bandeau(tj, 1, 1, 4, 'TABLEAU DU JOUR', VERT2, 15, 30, 'center')
tj['A2'].font = Font(italic=True, color='595959')
tj['A4'].font = Font(bold=True, color=VERT2); tj['B4'].fill = JAUNE; tj['B4'].font = Font(bold=True, size=12, color='0000FF'); tj['B4'].border = B3
for c in tj[6]:
    if c.value: c.fill = P(VERT2); c.font = Font(bold=True, color=BLANC); c.alignment = Alignment(horizontal='center')
for r in range(7, 7 + len(IND)):
    for j in range(1, 5):
        c = tj.cell(row=r, column=j); c.border = B3; c.fill = P(eclaircir(VERT2, 0.88) if r % 2 == 0 else BLANC)
        if j in (2, 3): c.font = Font(bold=True, size=11, color=NAVY)
# Lisez-moi : bandeau, sommaire avec liens, rubriques colorées
lm = wb['Lisez-moi']; lm.sheet_view.showGridLines = False; lm.sheet_properties.tabColor = NAVY
textes = [lm.cell(row=i, column=1).value for i in range(1, lm.max_row + 1)]
for i in range(1, lm.max_row + 1): lm.cell(row=i, column=1).value = None
lm.column_dimensions['A'].width = 4
for j, w in zip('BCDEFG', [26, 60, 4, 26, 60, 4]): lm.column_dimensions[j].width = w
bandeau(lm, 1, 1, 6, 'ORIBA FOODS — ERP · CLASSEUR DE SAISIE ET DE SUIVI', NAVY, 18, 40, 'center')
lm.merge_cells('A2:F2'); lm['A2'] = 'Oriba Food / Oriba Rice  →  Grossistes  →  Dépôts (chefs d’équipe)  →  Agents  →  Marchés'; lm['A2'].font = Font(bold=True, size=12, color=NAVY); lm['A2'].alignment = Alignment(horizontal='center')
lm.row_dimensions[2].height = 24
bandeau(lm, 4, 1, 6, 'SOMMAIRE  ·  cliquez sur un onglet pour l’ouvrir', BLEU2, 12, 22)
TUILES = [('Tableau de bord', NAVY, 'CA, encaissements, créances, plafond, équipes, marchés, produits, mois'), ('Créances par client', ROUGE, 'Ce que chaque client doit encore, top 10 des débiteurs'),
          ('Tableau du jour', VERT2, 'Les totaux d’une journée et du mois'), ('4-Ventes', NAVY, 'Ventes au comptant et à crédit (à saisir chaque jour)'),
          ('5-Versements', VERT2, 'Versements, remboursements de crédits, règlements des grossistes'), ('2-Appro dépôts', BLEU2, 'Cartons reçus par les dépôts'),
          ('3-Remises agents', BLEU2, 'Cartons confiés aux agents'),
          ('1-Appro grossistes', '2F5597', 'Cartons reçus par les grossistes'), ('7-Dépenses', ROUGE, 'Salaires, carburant, réparations, vidanges, assurances…'),
          ('8-Objectifs', '7030A0', 'Objectifs du mois par agent ou équipe'), ('9-Budgets', 'BF8F00', 'Budgets du mois par équipe et nature'),
          ('Dépôts', 'BF8F00', 'Les dépôts et leur chef d’équipe'), ('Agents', 'BF8F00', 'Les agents et leur marché'), ('Clients', 'BF8F00', 'Les clients'), ('Grossistes', 'BF8F00', 'Les grossistes')]
for k, (n, c_, d) in enumerate(TUILES):
    r = 5 + k // 2; j = 2 if k % 2 == 0 else 5
    t = lm.cell(row=r, column=j, value=n); t.hyperlink = f"#'{n}'!A1"; t.fill = P(c_); t.font = Font(bold=True, color=BLANC, underline='single'); t.alignment = Alignment(horizontal='center', vertical='center'); t.border = B3
    e = lm.cell(row=r, column=j + 1, value=d); e.fill = P(eclaircir(c_, 0.88)); e.font = Font(size=10, color='262626'); e.alignment = Alignment(vertical='center', indent=1); e.border = B3
    lm.row_dimensions[r].height = 24
r = 5 + (len(TUILES) + 1) // 2 + 1
for t in textes[2:]:
    if t is None or t == '': r += 1; continue
    if t.isupper() or t in ('LE CIRCUIT', 'CHAQUE JOUR', 'LES ONGLETS DE SAISIE', 'LES LISTES', 'RÈGLES'):
        if t == 'LE CIRCUIT': continue
        bandeau(lm, r, 1, 6, t, BLEU2 if t != 'RÈGLES' else ROUGE, 11, 20)
    else:
        lm.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
        c = lm.cell(row=r, column=2, value=t); c.alignment = Alignment(wrap_text=True, vertical='top'); c.font = Font(size=10)
        lm.row_dimensions[r].height = 30 if len(t) > 140 else 16
    r += 1
ordre = ['Lisez-moi', 'Tableau de bord', 'Tableau du jour', 'Créances par client', '4-Ventes', '5-Versements', '2-Appro dépôts', '3-Remises agents', '1-Appro grossistes', '7-Dépenses', '8-Objectifs', '9-Budgets',
         'Dépôts', 'Agents', 'Clients', 'Grossistes', 'Paramètres', 'Choix']
wb._sheets = [wb[n] for n in ordre]
wb.active = 2
for n in ordre: wb[n].sheet_view.tabSelected = (n == '4-Ventes')
wb.save(OUT)
print(OUT, len(DEPOTS), len(AGENTS), len(CLIENTS), len(GROSSISTES), len(obj_rows), len(bud_rows), len(dep_rows))
