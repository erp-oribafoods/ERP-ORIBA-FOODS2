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

# ---------- Historique du fichier TB de l'équipe (ex. TB Mohamedine Tahoua) : ventes comptant, ventes à crédit, remboursements
import re
def nom_client(c, zone):
    n = re.sub(r'^\s*Client\s+\w+\s*-\s*', '', str(c or '')).strip()
    n = re.sub(r'\s+', ' ', n)
    return (f'Détaillants divers ({zone})' if re.match(r'^d[ée]taill', n, re.I) else n) if n else None
def unite(u, prix):  # l'unité suit le prix : prix de carton = Carton, prix de pack (moins de 5 000 F) = Pack
    if not prix: return u or 'Carton'
    return 'Carton' if prix >= 5000 else 'Pack'
def nom_marche(m): return re.sub(r'^\s*March[ée]\s+', '', str(m or '')).strip() or None
def jour(v):
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    m = re.match(r'^(\d{1,2})/(\d{1,2})/0?(\d{3,4})$', str(v or '').strip())
    if m: y = int(m.group(3)); y = 2026 if y in (206, 2026) else y; return dt.date(y, int(m.group(2)), int(m.group(1)))
    return None
HIST_V, HIST_R, TB_NOMS, TEL, CORR = [], [], [], {}, []
ZONE_DEP = {d[1]: d[2] for d in DEPOTS}
for TB in TBS:
    tb_wb = load_workbook(TB, data_only=True)
    TB_NOMS.append(TB.rsplit('/', 1)[-1])
    def vend(a):
        n = re.sub(r'\s+', ' ', str(a)).strip()
        if n in CHEF_DEP: return CHEF_DEP[n]
        if any(x[1] == n for x in AGENTS): return n
        # nom abrégé dans le TB (ex. « Mahfouz » = Kamel Alalla Mahfouze)
        c = [x[1] for x in AGENTS if any(w.lower().startswith(n.lower()) for w in x[1].split())]
        if len(c) == 1: CORR.append(f'agent « {n} » du TB reconnu comme {c[0]}'); return c[0]
        return n
    chef = next((str(r[1]).strip() for r in tb_wb['Journal Comptant'].iter_rows(min_row=3, values_only=True) if r[1] and str(r[1]).strip() in CHEF_DEP), None)
    dep = CHEF_DEP.get(chef, '')
    zone = ZONE_DEP.get(dep, dep.replace('Dépôt ', ''))
    pref = next((d[0] for d in DEPOTS if d[1] == dep), 'DEP').replace('DEP-', '')
    # Téléphones des clients (onglet Paramètres du TB : « Client X - Nom » suivi du numéro)
    if 'Paramètres' in tb_wb.sheetnames:
        for r in tb_wb['Paramètres'].iter_rows(values_only=True):
            for k in range(len(r) - 1):
                if isinstance(r[k], str) and re.match(r'^\s*Client\s+\w+\s*-', r[k]) and isinstance(r[k + 1], str) and re.search(r'\d{2}\s?\d{2}', r[k + 1]) and 'X' not in r[k + 1]:
                    TEL[nom_client(r[k], zone)] = r[k + 1].strip()
    for r in tb_wb['Journal Comptant'].iter_rows(min_row=3, values_only=True):
        d = jour(r[0])
        if not d or not r[1]: continue
        if not r[6]: CORR.append(f'{zone} : vente au comptant du {d:%d/%m/%Y} sans quantité, ignorée'); continue
        HIST_V.append([d, vend(r[1]), nom_marche(r[2]), nom_client(r[3], zone), r[4], unite(r[5], r[7]), r[6], r[7], 'Comptant', None, None, r[9] or None])
    n = 0
    for r in tb_wb['Journal Crédit'].iter_rows(min_row=3, values_only=True):
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
            dr = jour(r[11]) or ech
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
LISTE_MARCHES = ['Aéroport', 'Dolé', 'Koira Tégui', 'Dar es Salam', 'Yantala', 'Grand Marché', 'Petit Marché', 'Nouveau Marché', 'Wadata', 'Bonkaney', 'Katako', 'Gamkallé',
    'Balleyara', 'Loga', 'Gotheye', 'Hamdallahi', 'Ouallam', 'Konni Ville', 'Gidan Ider', 'Tunfafi', 'Galmi', 'Malbaza', 'Karofan', 'Madaoua', 'Tsernaoua', 'Massalata', 'Dossey', 'Dibissou',
    'Tahoua Ville', 'Badaguichiri', 'Abalak', 'Tchinta', 'Bouza', 'Agadez']
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
            if j in nombres: c.number_format = '# ##0'
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
    ('4-Ventes : ventes au comptant ou à crédit, par un dépôt ou un agent, avec le marché, le client, l’unité (carton ou pack). Crédit : client, date promesse et N° de vente (ex. V001) obligatoires. Déjà rempli avec l’historique des TB de Tahoua, Balleyara et Konni (mai à octobre 2026).', None),
    ('5-Versements : argent versé (Ventes comptant), remboursement d’un crédit (avec le N° de la vente), ou règlement d’un grossiste. Indiquez pour Oriba Food ou Oriba Rice.', None),
    ('2-Appro dépôts : cartons reçus par un dépôt, d’Oriba Food, d’Oriba Rice ou d’un grossiste.', None),
    ('3-Remises agents : cartons donnés par un dépôt à un de ses agents.', None),
    ('6-Transferts : cartons envoyés d’un dépôt à un autre dépôt.', None),
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
              'Montant (calculé)', 'Remboursé (calculé)', 'Solde restant (calculé)', 'Jours de retard (calculé)', 'Statut (calculé)', 'Mois (calculé)', 'Cartons (calculé)', 'Quantité restant à verser (calculé)'],
             [12, 28, 18, 28, 20, 10, 9, 12, 12, 14, 11, 20, 14, 14, 14, 10, 20, 10, 10, 12], HIST_V, vides=NV - len(HIST_V), dates=(1, 10), nombres=(8, 13, 14, 15), calc=(13, 14, 15, 16, 17, 18, 19, 20))
for r in range(5, 5 + NV):
    j4[f'M{r}'] = f'=IF(OR(G{r}="",H{r}=""),"",G{r}*H{r})'
    j4[f'N{r}'] = f'=IF(OR(K{r}="",I{r}<>"Crédit"),"",SUMIFS(\'5-Versements\'!$G:$G,\'5-Versements\'!$D:$D,K{r},\'5-Versements\'!$C:$C,"Remboursement crédit"))'
    j4[f'O{r}'] = f'=IF(OR(M{r}="",I{r}<>"Crédit"),"",MAX(0,M{r}-N(N{r})))'
    j4[f'P{r}'] = f'=IF(OR(O{r}="",O{r}=0,J{r}=""),"",MAX(0,TODAY()-J{r}))'
    j4[f'Q{r}'] = f'=IF(O{r}="","",IF(O{r}=0,"Soldé",IF(N(P{r})>0,"En retard",IF(N(N{r})>0,"Partiellement remboursé","En attente"))))'
    j4[f'R{r}'] = f'=IF(A{r}="","",YEAR(A{r})&"-"&TEXT(MONTH(A{r}),"00"))'
    j4[f'S{r}'] = f'=IF(G{r}="","",IF(F{r}="Pack",G{r}/12,G{r}))'
    j4[f'T{r}'] = f'=IF(N(O{r})>0,O{r}/H{r},"")'
j4.auto_filter.ref = f'A4:T{4 + NV}'
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
j6 = feuille('6-Transferts', '6 · Transferts entre dépôts', 'Cartons envoyés d’un dépôt à un autre (ex. Dépôt Niamey 1 → Dépôt Niamey 2).',
             ['Date', 'Dépôt qui envoie', 'Dépôt qui reçoit', 'Produit', 'Cartons', 'Observation'], [13, 22, 22, 22, 10, 30], vides=LIGNES, couleur=VIOLET, dates=(1,))
liste(j6, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt qui envoie'); liste(j6, 'C', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt qui reçoit'); liste(j6, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')
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
    ('Cartons transférés entre dépôts', '6-Transferts', 'E', '', 'cartons'),
    ('Cartons reçus par les grossistes', '1-Appro grossistes', 'E', '', 'cartons'),
    ('Dépenses', '7-Dépenses', 'D', '', 'FCFA'),
]
for i, (lib, f, col, crit, u) in enumerate(IND, 7):
    tb.cell(row=i, column=1, value=lib).border = BORD
    for j, fx in ((2, jour(f, col, crit)), (3, mois(f, col, crit))):
        c = tb.cell(row=i, column=j, value=fx); c.number_format = '# ##0'; c.border = BORD; c.fill = PatternFill('solid', fgColor=BLEU)
    tb.cell(row=i, column=4, value=u).border = BORD
    if lib.startswith('  '): tb.cell(row=i, column=1).font = Font(italic=True, color='5A5670')
tb.column_dimensions['A'].width = 36; tb.column_dimensions['B'].width = 18; tb.column_dimensions['C'].width = 22; tb.column_dimensions['D'].width = 10

# ---------- Tableau de bord (comme le TB de l'équipe : rien à saisir, sauf la période et le plafond)
TBD = wb.create_sheet('Tableau de bord')
def titre(ws, r, t):
    c = ws.cell(row=r, column=1, value=t); c.font = Font(bold=True, size=12, color=VIOLET)
def entete(ws, r, hs):
    for j, h in enumerate(hs, 1):
        c = ws.cell(row=r, column=j, value=h); c.font = Font(bold=True, color=BLANC); c.fill = PatternFill('solid', fgColor=VERT); c.border = BORD; c.alignment = Alignment(wrap_text=True, vertical='center')
def calc(ws, r, j, f, fmt='# ##0'):
    c = ws.cell(row=r, column=j, value=f); c.number_format = fmt; c.border = BORD; c.fill = PatternFill('solid', fgColor=BLEU); return c
TBD['A1'] = 'TABLEAU DE BORD — VENTES, CRÉANCES ET ENCAISSEMENTS'; TBD['A1'].font = Font(bold=True, size=15, color=VERT_F)
TBD['A2'] = 'Tout se calcule à partir des onglets 4-Ventes et 5-Versements. Choisissez la période (cases jaunes) ; les créances en cours ne dépendent pas de la période.'; TBD['A2'].font = Font(italic=True, color='5A5670')
JAUNE = PatternFill('solid', fgColor='FFF8E1')
for r, (lib, v) in enumerate([('Du', dt.date(2026, 5, 1)), ('Au', '=TODAY()'), ('Plafond cumul créances (cartons)', 1550), ('Seuil d’alerte créance (jours)', 7)], 4):
    TBD.cell(row=r, column=1, value=lib).font = Font(bold=True)
    c = TBD.cell(row=r, column=2, value=v); c.fill = JAUNE; c.font = Font(bold=True); c.border = BORD
    if r <= 5: c.number_format = 'DD/MM/YYYY'
TBD['C6'] = 'Tahoua 1 000 + Balleyara 500 + Konni 50 (plafonds des TB)'; TBD['C6'].font = Font(italic=True, color='5A5670')
V = "'4-Ventes'"; VS = "'5-Versements'"
PER = f',{V}!$A:$A,">="&$B$4,{V}!$A:$A,"<="&$B$5'
PERV = f',{VS}!$A:$A,">="&$B$4,{VS}!$A:$A,"<="&$B$5'
titre(TBD, 9, 'Indicateurs clés'); entete(TBD, 10, ['Indicateur', 'Valeur', 'Commentaire'])
KPI = [('CA total (FCFA)', f'=SUMIFS({V}!$M:$M{PER})', 'ventes comptant + crédit de la période'),
       ('Ventes au comptant (FCFA)', f'=SUMIFS({V}!$M:$M,{V}!$I:$I,"Comptant"{PER})', ''),
       ('Ventes à crédit (FCFA)', f'=SUMIFS({V}!$M:$M,{V}!$I:$I,"Crédit"{PER})', ''),
       ('Cartons vendus', f'=SUMIFS({V}!$S:$S{PER})', 'les packs comptent pour 1/12 de carton'),
       ('Montant encaissé (FCFA)', f'=SUMIFS({VS}!$G:$G,{VS}!$C:$C,"Ventes comptant"{PERV})+SUMIFS({VS}!$G:$G,{VS}!$C:$C,"Remboursement crédit"{PERV})', 'versements des ventes comptant + remboursements de crédits'),
       ('Solde des créances en cours (FCFA)', f'=SUM({V}!$O:$O)', 'toutes dates'),
       ('Quantité en créance (cartons)', f'=SUM({V}!$T:$T)', ''),
       ('% d’utilisation du plafond', '=IF($B$6>0,B17/$B$6,0)', ''),
       ('Statut du plafond', '=IF(B18>=1,"🚨 Plafond dépassé",IF(B18>=0.8,"⚠️ Proche du plafond","✅ Normal"))', ''),
       ('Créances en retard (nombre)', f'=COUNTIF({V}!$Q:$Q,"En retard")', ''),
       ('Créances en retard de plus que le seuil (nombre)', f'=COUNTIFS({V}!$Q:$Q,"En retard",{V}!$P:$P,">"&$B$7)', ''),
       ('Clients débiteurs actifs', '=COUNTIF(C:C,">0")-COUNTIF(C1:C40,">0")', 'clients avec un solde à rembourser')]
for i, (lib, f, com) in enumerate(KPI, 11):
    TBD.cell(row=i, column=1, value=lib).border = BORD
    calc(TBD, i, 2, f, '0 %' if '%' in lib else '# ##0'); TBD.cell(row=i, column=3, value=com).font = Font(italic=True, color='5A5670')
r0 = 25
titre(TBD, r0, 'Ventes par vendeur (dépôt / chef d’équipe et agents)'); entete(TBD, r0 + 1, ['Vendeur', 'Qté comptant', 'Qté crédit', 'Qté totale', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)'])
NVd = len(DEPOTS) + len(AGENTS) + 20
for i in range(NVd):
    nd = len(DEPOTS) + 5; r = r0 + 2 + i; src = f'Choix!C{2 + i}' if i < nd else f'Choix!C{42 + i - nd}'
    TBD.cell(row=r, column=1, value=f'={src}&""').border = BORD
    k = f'{V}!$B:$B,$A{r}'
    calc(TBD, r, 2, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Comptant"{PER}))'); calc(TBD, r, 3, f'=IF($A{r}="","",SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Crédit"{PER}))')
    calc(TBD, r, 4, f'=IF($A{r}="","",N(B{r})+N(C{r}))'); calc(TBD, r, 5, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Comptant"{PER}))')
    calc(TBD, r, 6, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"{PER}))'); calc(TBD, r, 7, f'=IF($A{r}="","",N(E{r})+N(F{r}))')
r1 = r0 + 3 + NVd
titre(TBD, r1, 'Ventes par marché'); entete(TBD, r1 + 1, ['Marché / village', 'Qté comptant', 'Qté crédit', 'Qté totale', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)'])
for i, m in enumerate(LISTE_MARCHES + ['(marché non renseigné)']):
    r = r1 + 2 + i
    TBD.cell(row=r, column=1, value=m).border = BORD
    k = f'{V}!$C:$C,{"$A" + str(r) if i < len(LISTE_MARCHES) else chr(34) + chr(34)}'
    calc(TBD, r, 2, f'=SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Comptant"{PER})'); calc(TBD, r, 3, f'=SUMIFS({V}!$S:$S,{k},{V}!$I:$I,"Crédit"{PER})')
    calc(TBD, r, 4, f'=B{r}+C{r}'); calc(TBD, r, 5, f'=SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Comptant"{PER})'); calc(TBD, r, 6, f'=SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"{PER})'); calc(TBD, r, 7, f'=E{r}+F{r}')
r2 = r1 + 4 + len(LISTE_MARCHES)
titre(TBD, r2, 'Ventes par produit'); entete(TBD, r2 + 1, ['Produit', 'Quantité (cartons)', 'CA (FCFA)'])
for i, p in enumerate(PRODUITS):
    r = r2 + 2 + i; TBD.cell(row=r, column=1, value=p[0]).border = BORD
    calc(TBD, r, 2, f'=SUMIFS({V}!$S:$S,{V}!$E:$E,$A{r}{PER})'); calc(TBD, r, 3, f'=SUMIFS({V}!$M:$M,{V}!$E:$E,$A{r}{PER})')
r3 = r2 + 3 + len(PRODUITS)
titre(TBD, r3, 'Évolution mensuelle'); entete(TBD, r3 + 1, ['Mois', 'CA comptant (FCFA)', 'CA crédit (FCFA)', 'CA total (FCFA)', 'Quantité (cartons)'])
for i in range(14):
    y, m = 2026 + (4 + i) // 12, (4 + i) % 12 + 1; mo = f'{y}-{m:02d}'; r = r3 + 2 + i
    TBD.cell(row=r, column=1, value=mo).border = BORD
    calc(TBD, r, 2, f'=SUMIFS({V}!$M:$M,{V}!$R:$R,$A{r},{V}!$I:$I,"Comptant")'); calc(TBD, r, 3, f'=SUMIFS({V}!$M:$M,{V}!$R:$R,$A{r},{V}!$I:$I,"Crédit")')
    calc(TBD, r, 4, f'=B{r}+C{r}'); calc(TBD, r, 5, f'=SUMIFS({V}!$S:$S,{V}!$R:$R,$A{r})')
for c, w in zip('ABCDEFG', [44, 16, 16, 14, 18, 18, 18]): TBD.column_dimensions[c].width = w
TBD.freeze_panes = 'A9'
# Créances par client (onglet à part)
CRC = wb.create_sheet('Créances par client')
CRC['A1'] = 'CRÉANCES PAR CLIENT'; CRC['A1'].font = Font(bold=True, size=15, color=VERT_F)
CRC['A2'] = 'Ventes à crédit et remboursements de chaque client (toutes dates). Rien à saisir.'; CRC['A2'].font = Font(italic=True, color='5A5670')
entete(CRC, 4, ['Client', 'Crédits accordés (FCFA)', 'Remboursé (FCFA)', 'Montant dû (FCFA)', 'Qté en créance (cartons)', 'Taux de remboursement', 'Créances en retard'])
for i in range(250):
    r = 5 + i
    CRC.cell(row=r, column=1, value=f'=Choix!D{2 + i}&""').border = BORD
    k = f'{V}!$D:$D,$A{r}'
    calc(CRC, r, 2, f'=IF($A{r}="","",SUMIFS({V}!$M:$M,{k},{V}!$I:$I,"Crédit"))'); calc(CRC, r, 3, f'=IF($A{r}="","",SUMIFS({V}!$N:$N,{k}))')
    calc(CRC, r, 4, f'=IF($A{r}="","",SUMIFS({V}!$O:$O,{k}))'); calc(CRC, r, 5, f'=IF($A{r}="","",SUMIFS({V}!$T:$T,{k}))')
    calc(CRC, r, 6, f'=IF(OR($A{r}="",N(B{r})=0),"",C{r}/B{r})', '0 %'); calc(CRC, r, 7, f'=IF($A{r}="","",COUNTIFS({k},{V}!$Q:$Q,"En retard"))')
CRC.conditional_formatting.add('D5:D254', FormulaRule(formula=['N($G5)>0'], font=Font(bold=True, color='B71C1C')))
for c, w in zip('ABCDEFG', [34, 18, 16, 16, 14, 14, 12]): CRC.column_dimensions[c].width = w
CRC.freeze_panes = 'A5'
CRC.auto_filter.ref = 'A4:G254'
TBD['B22'] = "=COUNTIF('Créances par client'!D5:D254,\">0\")"
TBD['B22'].number_format = '# ##0'; TBD['B22'].fill = PatternFill('solid', fgColor=BLEU); TBD['B22'].border = BORD

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

ordre = ['Lisez-moi', 'Tableau de bord', 'Tableau du jour', 'Créances par client', '4-Ventes', '5-Versements', '2-Appro dépôts', '3-Remises agents', '6-Transferts', '1-Appro grossistes', '7-Dépenses', '8-Objectifs', '9-Budgets',
         'Dépôts', 'Agents', 'Clients', 'Grossistes', 'Paramètres', 'Choix']
wb._sheets = [wb[n] for n in ordre]
wb.active = 2
for n in ordre: wb[n].sheet_view.tabSelected = (n == '4-Ventes')
wb.save(OUT)
print(OUT, len(DEPOTS), len(AGENTS), len(CLIENTS), len(GROSSISTES), len(obj_rows), len(bud_rows), len(dep_rows))
