# Classeur journalier ORIBA : saisie quotidienne, importable tel quel dans l'ERP (Saisie et import > Classeur du jour).
# Même structure que le lecteur de l'ERP : titre (ligne 1), sous-titre (ligne 2), en-têtes (ligne 4), données à partir de la ligne 5.
import datetime as dt, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as L

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/journalier/ORIBA_Saisie_et_Suivi_Novembre_2026.xlsx'
VIOLET, VERT, GRIS, BLANC = '45307A', '4F8A2B', 'F3F1F8', 'FFFFFF'
LIGNES = 400  # lignes préparées dans chaque journal

DEPOTS = [  # code, nom, zone (équipe), prix du carton
    ('DEP-KON', 'Dépôt Konni', 'Konni', 14000), ('DEP-MAR', 'Dépôt Maradi', 'Maradi', None), ('DEP-NY1', 'Dépôt Niamey 1', 'Niamey 1', 13250),
    ('DEP-NY2', 'Dépôt Niamey 2', 'Niamey 2', 13250), ('DEP-TAH', 'Dépôt Tahoua', 'Tahoua', 13000), ('DEP-TIL', 'Dépôt Tillabéri', 'Balleyara', 13250),
    ('DEP-ZIN', 'Dépôt Zinder', 'Zinder', None), ('DEP-DOS', 'Dépôt Dosso', 'Dosso', None), ('DEP-MAY', 'Dépôt Mayonnaise', 'Équipe Mayonnaise', None)]
# Situation de départ au 03/11/2026, tirée du fichier « Suivi Équipes Commerciaux » : stock restant (cartons) et reste à encaisser net (CFA)
STOCKS = {'DEP-TIL': 419, 'DEP-DOS': 300, 'DEP-TAH': 52, 'DEP-ZIN': 30}
SOLDES = {'DEP-NY1': (11321500, 0), 'DEP-NY2': (16214600, 0), 'DEP-TIL': (2769500, 0), 'DEP-DOS': (11050000, 0), 'DEP-TAH': (0, 6344000), 'DEP-MAY': (0, 1336147)}
AGENTS = [  # code, nom, dépôt, fonction
    ('BAL-01', 'Zouera Harouna', 'Dépôt Tillabéri', "Chef d'équipe"),
    ('KON-01', 'Abdoul Magid Kamal', 'Dépôt Konni', "Chef d'équipe"), ('KON-02', 'Ali Bammo', 'Dépôt Konni', 'Agent de Vente'), ('KON-03', 'Aissa Daouda', 'Dépôt Konni', 'Agent Commercial'),
    ('KON-04', 'Zouera', 'Dépôt Konni', 'Agent Commercial'), ('KON-05', 'Hafsat', 'Dépôt Konni', 'Agent Commercial'), ('KON-06', 'Kamel Alalla Mahfouze', 'Dépôt Konni', 'Agent de Vente'),
    ('KON-07', 'Nafissa', 'Dépôt Konni', 'Agent Commercial'),
    ('MAR-01', 'Assayade Mohamed Aghali', 'Dépôt Maradi', "Chef d'équipe"), ('MAR-02', 'Mohamed Balogi', 'Dépôt Maradi', "Chef d'équipe"), ('MAR-03', 'Zara Amadou', 'Dépôt Maradi', 'Agent Commercial'),
    ('MAR-04', 'Roufaida Hassane', 'Dépôt Maradi', 'Agent Commercial'), ('MAR-05', 'Harouna Ousmane Abdou', 'Dépôt Maradi', 'Agent de Vente'), ('MAR-06', 'Saadatou Issaka', 'Dépôt Maradi', 'Agent Commercial'),
    ('MAR-07', 'Nana Choukouriya Hassan Mahamane', 'Dépôt Maradi', 'Agent Commercial'), ('MAR-08', 'Mardiya Hamadou', 'Dépôt Maradi', 'Agent Commercial'), ('MAR-09', 'Rachida Hassan', 'Dépôt Maradi', 'Agent Commercial'),
    ('NY1-01', 'Sidi Mohamed Baby', 'Dépôt Niamey 1', "Chef d'équipe"), ('NY1-02', 'Maimouna Saydou', 'Dépôt Niamey 1', 'Agent Commercial'), ('NY1-03', 'Roukayatou Zakari', 'Dépôt Niamey 1', 'Agent Commercial'),
    ('NY1-04', 'Zainabou Issoufou', 'Dépôt Niamey 1', 'Agent Commercial (Secteur)'), ('NY1-05', 'Saliya Boubacar Hamadou', 'Dépôt Niamey 1', 'Agent Commercial'), ('NY1-06', 'Djamila Oumarou Maourikoye', 'Dépôt Niamey 1', 'Agent Commercial'),
    ('NY1-07', 'Aissa Amadou Boubacar', 'Dépôt Niamey 1', 'Agent Commercial'), ('NY1-08', 'Balkissa Hamidou', 'Dépôt Niamey 1', 'Agent Commercial'), ('NY1-09', 'Ramatou Mounkaila', 'Dépôt Niamey 1', 'Agent Commercial'),
    ('NY1-10', 'Kadi Moumouni', 'Dépôt Niamey 1', 'Agent Commercial'), ('NY1-11', 'Abdou Rachid', 'Dépôt Niamey 1', 'Chauffeur et Agent de Vente secteur'), ('NY1-12', 'Maria Yayé', 'Dépôt Niamey 1', 'Agent Commercial'),
    ('NY2-01', 'Ramatou Issoufou', 'Dépôt Niamey 2', "Chef d'équipe"), ('NY2-02', 'Salamatou Sina', 'Dépôt Niamey 2', 'Agent Commercial'), ('NY2-03', 'Zalika Moussa', 'Dépôt Niamey 2', 'Agent Commercial'),
    ('NY2-04', 'Rakiyatou Sanda', 'Dépôt Niamey 2', 'Agent Commercial'), ('NY2-05', 'Zoulaihatou Soumana', 'Dépôt Niamey 2', 'Agent Commercial'), ('NY2-06', 'Ramatou Moussa', 'Dépôt Niamey 2', 'Agent Commercial'),
    ('NY2-07', 'Fatouma Boubacar', 'Dépôt Niamey 2', 'Agent Commercial'),
    ('TAH-01', 'Ramatou Mohamed', 'Dépôt Tahoua', 'Agent Commercial'), ('TAH-02', 'Ramatou Abdourahmane', 'Dépôt Tahoua', 'Agent Commercial'), ('TAH-03', 'Ramatou Adamou', 'Dépôt Tahoua', 'Agent Commercial'),
    ('TAH-04', 'Aminata Mohamed', 'Dépôt Tahoua', 'Agent Commercial'), ('TAH-05', 'Moussa Balogie', 'Dépôt Tahoua', 'Agent Commercial'), ('TAH-06', 'Mariama Souleymane', 'Dépôt Tahoua', 'Agent Commercial'),
    ('TAH-07', 'Mohamedine Youssouf', 'Dépôt Tahoua', "Chef d'équipe"), ('TAH-08', 'Mahamane Salissou Laouali', 'Dépôt Tahoua', 'Agent de Vente'),
    ('ZIN-01', 'Malam Abdou Adamou', 'Dépôt Zinder', "Chef d'équipe"), ('ZIN-02', 'Mijitapha Nafiou', 'Dépôt Zinder', 'Agent Commercial'),
    ('DOS-01', 'Mahamane Laouali Moussa', 'Dépôt Dosso', "Chef d'équipe")]
CLIENTS = [  # code, nom, téléphone
    ('BAL-A', 'Elh Sabitou', ''), ('BAL-B', 'Elh Ibrahim', ''), ('BAL-C', 'Elh Hassoumi', ''), ('BAL-D', 'Ancien', ''), ('BAL-E', 'Détaillants divers (Balleyara)', ''),
    ('KON-A', 'Elh Hamadgaicha', ''), ('KON-B', 'Elh Assoumane Dogo', ''), ('KON-C', 'Elh Bassirou', ''), ('KON-D', 'Hachimou', ''), ('KON-E', 'Détaillants divers (Konni)', ''), ('KON-F', 'Andoum', ''),
    ('TAH-A', 'Elh Nasser', '96 14 90 35'), ('TAH-B', 'Elh Awal', '97 01 23 82'), ('TAH-C', 'Elh Souleymane', '96 12 28 79'), ('TAH-D', 'Abdoul Hak', '88 66 66 64'), ('TAH-E', 'Abdoul Kader', '98 84 49 85'),
    ('TAH-E2', 'Elh Mohamed', '96 15 28 45'), ('TAH-F', 'Détaillants divers (Tahoua)', ''), ('TAH-G', 'Elh Issa', '89 33 10 46'), ('TAH-H', 'Elh Alka', '96 01 17 44'), ('TAH-I', 'Elh Ambo', '96 23 98 07'),
    ('TAH-J', 'Elh Sanoussi Abalak', '96 00 78 45'), ('TAH-K', 'Elh Tole Bleu Abalak', '99 19 13 86'), ('TAH-L', 'Malan Tahoua', ''), ('TAH-M', 'Abdoulaye Tahoua', ''), ('TAH-N', 'Abalak', '')]
PRODUITS = [('Arôme DADI Poulet', 12250), ('Arôme DADI Épicé', 13250), ('Mayonnaise Délice', 9500), ('Mayonnaise Oriba 1000 ml', 9500), ('Mayonnaise Oriba 500 ml', 9500), ('Mayonnaise Oriba 250 ml', 7500), ('Mayonnaise Aïda', 11000)]
GROSSISTES = [('G01', 'Boubacar Colege Mariama', 'Grand Marché', 809), ('G02', 'Elh Zangui', 'Grand Marché', 70), ('G03', 'Ets Zarafi', 'Grand Marché', 125), ('G04', 'Elh Moumouni Douka', 'Grand Marché', 150),
    ('G05', 'Alhassane Gabora', 'Grand Marché', 375), ('G06', 'Abdallah Mohamed', 'Grand Marché', 0), ('G07', 'Ahmed Badi', 'Grand Marché', 480), ('G08', 'Ousmane Yantala', 'Yantala', 229), ('G09', 'Boubacar Bako', 'Dolé', 300),
    ('G10', 'Dépôt Abdoullaye Indinga', 'Dolé', 1687), ('G11', 'Dépôt Abdoullahi Dolé', 'Dolé', 0), ('G12', 'Abdallah Oustaz', None, 0)]
DATE_STOCKS = dt.date(2026, 11, 3)
# Onglet « Sous agents » du suivi : marché et reste à encaisser (quantités) de chaque sous-agent
SOUS = [('Maimouna Saydou', 'Niamey 1', 'Aéroport', 10), ('Roukayatou Zakari', 'Niamey 1', 'Dolé 3', 0), ('Zainabou Issoufou', 'Niamey 1', 'Secteur Niamey', 0), ('Saliya Boubacar Hamadou', 'Niamey 1', 'Dolé 2', 10),
    ('Djamila Oumarou Maourikoye', 'Niamey 1', 'Koira-tegui & Dar es salam', 4), ('Aissa Amadou Boubacar', 'Niamey 1', 'Yantala', 18), ('Balkissa Hamidou', 'Niamey 1', 'Harobanda', 41), ('Ramatou Mounkaila', 'Niamey 1', 'Dolé 1', 44),
    ('Kadi Moumouni', 'Niamey 1', 'Axe Filingué', 10), ('Abdou Rachid', 'Niamey 1', 'Secteur Niamey', 0), ('Maria Yayé', 'Niamey 1', 'Axe Filingué', 0), ('Salamatou Sina', 'Niamey 2', 'Petit Marché', 65),
    ('Zalika Moussa', 'Niamey 2', 'Gamkalé & Nouveau Marché', 35), ('Rakiyatou Sanda', 'Niamey 2', 'Wadata 1', 80), ('Zainabou Souley', 'Niamey 2', 'Bonkaney', 21), ('Ramatou Moussa', 'Niamey 2', 'Wadata 2', 28), ('Fatouma Boubacar', 'Niamey 2', 'Katako', 47)]
MARCHES = {n: m for n, _, m, _ in SOUS}

wb = Workbook()
fin = Side(style='thin', color='D9D4E8')
BORD = Border(left=fin, right=fin, top=fin, bottom=fin)
H_FONT, H_FILL = Font(bold=True, color=BLANC), PatternFill('solid', fgColor=VIOLET)

def feuille(nom, titre, sous_titre, entetes, largeurs, lignes=(), vides=0, couleur=VIOLET, dates=(), nombres=()):
    ws = wb.create_sheet(nom)
    ws['A1'] = titre; ws['A1'].font = Font(bold=True, size=14, color=couleur)
    ws['A2'] = sous_titre; ws['A2'].font = Font(italic=True, color='5A5670')
    for j, (h, w) in enumerate(zip(entetes, largeurs), 1):
        c = ws.cell(row=4, column=j, value=h); c.font = H_FONT; c.fill = PatternFill('solid', fgColor=couleur)
        c.alignment = Alignment(wrap_text=True, vertical='center'); c.border = BORD
        ws.column_dimensions[L(j)].width = w
    ws.row_dimensions[4].height = 32
    n = max(len(lignes), 0) + vides
    for i in range(n):
        r = 5 + i
        val = lignes[i] if i < len(lignes) else [None] * len(entetes)
        for j in range(1, len(entetes) + 1):
            c = ws.cell(row=r, column=j, value=val[j - 1] if j - 1 < len(val) else None)
            c.border = BORD
            if i % 2: c.fill = PatternFill('solid', fgColor=GRIS)
            if j in dates: c.number_format = 'DD/MM/YYYY'
            if j in nombres: c.number_format = '# ##0'
    ws.freeze_panes = 'A5'
    return ws

def liste(ws, col, plage, n, message):
    dv = DataValidation(type='list', formula1=plage, allow_blank=True, showErrorMessage=False, showInputMessage=True, promptTitle='Choisir ou écrire', prompt=message)
    ws.add_data_validation(dv); dv.add(f'{col}5:{col}{4 + n}')

# ---------- Lisez-moi
ws = wb.active; ws.title = 'Lisez-moi'
txt = [
    ('Classeur ORIBA — saisie journalière et suivi des équipes commerciales', Font(bold=True, size=15, color=VIOLET)),
    ('À importer dans l’ERP : Saisie et import > « Classeur du jour (dépôts) » > Importer.', Font(italic=True, color='5A5670')),
    ('', None),
    ('COMMENT FAIRE, CHAQUE JOUR', Font(bold=True, color=VERT)),
    ('1. Ajoutez les opérations de la journée à la suite, dans les onglets 1 à 6 (une ligne par opération).', None),
    ('2. Ne supprimez pas les lignes des jours précédents : à l’import, la plateforme n’ajoute que les lignes nouvelles (aucun doublon).', None),
    ('3. Dans chaque case grise de liste, cliquez la petite flèche pour choisir, ou écrivez directement le nom.', None),
    ('4. Enregistrez le fichier, puis importez-le dans l’ERP. Un contrôle s’affiche avant l’enregistrement : lignes nouvelles, déjà présentes, refusées (avec la raison).', None),
    ('', None),
    ('LES ONGLETS', Font(bold=True, color=VERT)),
    ('1-Appro grossistes : cartons reçus par un grossiste, d’Oriba Food ou d’Oriba Rice.', None),
    ('2-Appro dépôts : cartons reçus par un dépôt, d’Oriba Food, d’Oriba Rice ou d’un grossiste.', None),
    ('3-Remises agents : cartons donnés par un dépôt à un de ses agents.', None),
    ('4-Ventes : ventes au comptant ou à crédit, par un dépôt ou par un agent. Pour un crédit : client et échéance obligatoires, et un N° de vente (ex. V001).', None),
    ('5-Versements : argent versé (Ventes comptant), remboursement d’un crédit (indiquez le N° de la vente), ou règlement d’un grossiste.', None),
    ('6-Transferts : cartons envoyés d’un dépôt à un autre dépôt.', None),
    ('Dépôts, Agents, Clients, Grossistes : les listes. Un nouveau client ou grossiste ? Ajoutez-le d’abord dans son onglet ; il sera créé à l’import.', None),
    ('Paramètres : produits et date des stocks initiaux.', None),
    ('', None),
    ('SUIVI DES ÉQUIPES (onglets « Suivi - … », non importés : tableau de bord dans Excel)', Font(bold=True, color=VERT)),
    ('Suivi - Synthèse : indicateurs clés en quantités ET en valeur (F CFA), par dépôt.', None),
    ('Suivi - Arôme Dadi, Suivi - Mayonnaise, Suivi - Sous agents, Suivi - Stock grossistes : quantités saisies (cases bleues) et leur valeur = quantité × prix.', None),
    ('Le prix vient de l’onglet Suivi - Prix, selon le produit choisi sur chaque ligne (colonne « Produit de référence ») : changez le produit ou le prix, la valeur se recalcule.', None),
    ('Suivi - Reste à encaisser : montants en F CFA par dépôt et par grossiste ; le « net à encaisser » de chaque dépôt est repris dans l’onglet Dépôts (situation de départ).', None),
    ('', None),
    ('RÈGLES', Font(bold=True, color=VERT)),
    ('• Dates au format JJ/MM/AAAA (ex. 02/11/2026).', None),
    ('• Mode : Comptant ou Crédit.   • Lieu du versement : Caisse Oriba ou Chez le grossiste.   • Argent pour : Oriba Food ou Oriba Rice.', None),
    ('• Stock de départ : dans l’onglet Dépôts, colonne « Stock initial », les cartons présents au dépôt le jour indiqué dans Paramètres (une seule fois).', None),
    ('• Écrivez les noms comme dans les listes (les majuscules et les accents ne comptent pas).', None),
]
for i, (t, f) in enumerate(txt, 1):
    c = ws.cell(row=i, column=1, value=t)
    if f: c.font = f
ws.column_dimensions['A'].width = 140

# ---------- Listes (lues par l'import)
feuille('Paramètres', 'Paramètres', 'Produits, prix de référence et date des stocks initiaux.', ['Produit', 'Prix de référence (FCFA)'], [30, 24],
        [list(p) for p in PRODUITS] + [[None, None], ['Date des stocks initiaux', DATE_STOCKS]], nombres=(2,))
wb['Paramètres'].cell(row=5 + len(PRODUITS) + 1, column=2).number_format = 'DD/MM/YYYY'
feuille('Dépôts', 'Dépôts', 'Un dépôt par zone. Situation de départ (date dans Paramètres) : stock restant et reste à encaisser net, repris du suivi des équipes.',
        ['Code', 'Nom', 'Zone', 'Grossiste habituel', 'Téléphone', 'Stock initial (cartons)', 'Prix du carton (FCFA)', 'Reste à encaisser au départ — Oriba Food (FCFA)', 'Reste à encaisser au départ — Oriba Rice (FCFA)'], [10, 22, 16, 18, 14, 14, 14, 22, 22],
        [[c, n, z, None, None, STOCKS.get(c, 0), p, SOLDES.get(c, (0, 0))[0], SOLDES.get(c, (0, 0))[1]] for c, n, z, p in DEPOTS], vides=10, nombres=(6, 7, 8, 9))
feuille('Agents', 'Agents des dépôts', 'Chaque agent est rattaché à un dépôt.', ['Code', 'Nom', 'Dépôt', 'Fonction', 'Localité / marché', 'Téléphone', 'Stock initial (cartons)'],
        [10, 32, 18, 30, 24, 14, 14], [[c, n, d, f, MARCHES.get(n), None, 0] for c, n, d, f in AGENTS], vides=30, nombres=(7,))
liste(wb['Agents'], 'C', '=Choix!$A$2:$A$40', len(AGENTS) + 30, 'Dépôt de l’agent')
feuille('Clients', 'Clients', 'Clients des dépôts et des agents. Ajoutez ici tout nouveau client.', ['Code', 'Nom', 'Vendeur rattaché', 'Localité', 'Téléphone', 'Plafond (cartons)'],
        [10, 32, 22, 18, 14, 12], [[c, n, None, None, t or None, None] for c, n, t in CLIENTS], vides=150)
feuille('Grossistes', 'Grossistes', 'Les grossistes ne s’approvisionnent que chez Oriba Food ou Oriba Rice. Ajoutez-les ici.',
        ['Code', 'Nom', 'Localité', 'Fournisseur habituel', 'Téléphone', 'Stock initial (cartons)', 'Solde dû au départ (FCFA)'], [10, 30, 18, 20, 14, 14, 18],
        [[c, n, l, None, None, st, 0] for c, n, l, st in GROSSISTES], vides=60, nombres=(6, 7))
liste(wb['Grossistes'], 'D', '=Choix!$J$2:$J$3', 60, 'Oriba Food ou Oriba Rice')

# ---------- Journaux
V, C2 = VIOLET, VERT
j1 = feuille('1-Appro grossistes', '1 · Approvisionnement des grossistes', 'Cartons reçus par les grossistes, d’Oriba Food ou d’Oriba Rice.',
             ['Date', 'Grossiste', 'Fournisseur (Oriba Food / Oriba Rice)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Observation'], [13, 28, 22, 22, 10, 15, 30], vides=LIGNES, couleur=C2, dates=(1,), nombres=(6,))
liste(j1, 'B', '=Choix!$F$2:$F$101', LIGNES, 'Grossiste'); liste(j1, 'C', '=Choix!$J$2:$J$3', LIGNES, 'Oriba Food ou Oriba Rice'); liste(j1, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')
j2 = feuille('2-Appro dépôts', '2 · Approvisionnement des dépôts', 'Cartons reçus par les dépôts : d’Oriba Food, d’Oriba Rice ou d’un grossiste.',
             ['Date', 'Dépôt', 'Source (Oriba Food, Oriba Rice ou grossiste)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Mode de paiement (Comptant / Crédit)', 'Observation'],
             [13, 20, 28, 22, 10, 15, 18, 28], vides=LIGNES, couleur=C2, dates=(1,), nombres=(6,))
liste(j2, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt'); liste(j2, 'C', '=Choix!$G$2:$G$103', LIGNES, 'Oriba Food, Oriba Rice ou un grossiste')
liste(j2, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit'); liste(j2, 'G', '=Choix!$H$2:$H$3', LIGNES, 'Comptant ou Crédit')
j3 = feuille('3-Remises agents', '3 · Remises de cartons aux agents', 'Cartons donnés par un dépôt à un de ses agents.',
             ['Date', 'Dépôt', 'Agent', 'Produit', 'Cartons', 'Observation'], [13, 20, 32, 22, 10, 30], vides=LIGNES, couleur=C2, dates=(1,))
liste(j3, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt'); liste(j3, 'C', '=Choix!$B$2:$B$151', LIGNES, 'Agent'); liste(j3, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')
j4 = feuille('4-Ventes', '4 · Ventes aux clients', 'Une ligne par vente. Crédit : client, échéance et N° de vente obligatoires.',
             ['Date', 'Vendeur (dépôt ou agent)', 'Client', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Mode (Comptant / Crédit)', 'Échéance (si crédit)', 'N° vente'],
             [13, 32, 30, 22, 9, 14, 14, 14, 11], vides=LIGNES, dates=(1, 8), nombres=(6,))
liste(j4, 'B', '=Choix!$C$2:$C$191', LIGNES, 'Dépôt ou agent qui a vendu'); liste(j4, 'C', '=Choix!$D$2:$D$401', LIGNES, 'Client')
liste(j4, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit'); liste(j4, 'G', '=Choix!$H$2:$H$3', LIGNES, 'Comptant ou Crédit')
j5 = feuille('5-Versements', '5 · Versements et remboursements', 'Argent versé à la caisse Oriba ou chez le grossiste ; remboursements de crédits ; règlements des grossistes.',
             ['Date', 'Versé par', 'Objet', 'N° vente (si remboursement)', 'Lieu du versement', 'Grossiste (si versé chez lui)', 'Montant (FCFA)', 'Argent pour (Oriba Food / Oriba Rice)'],
             [13, 32, 22, 14, 18, 26, 15, 18], vides=LIGNES, dates=(1,), nombres=(7,))
liste(j5, 'B', '=Choix!$K$2:$K$291', LIGNES, 'Dépôt, agent ou grossiste qui verse'); liste(j5, 'C', '=Choix!$I$2:$I$4', LIGNES, 'Objet du versement')
liste(j5, 'E', '=Choix!$L$2:$L$3', LIGNES, 'Caisse Oriba ou Chez le grossiste'); liste(j5, 'F', '=Choix!$F$2:$F$101', LIGNES, 'Grossiste'); liste(j5, 'H', '=Choix!$J$2:$J$3', LIGNES, 'Oriba Food ou Oriba Rice')
j6 = feuille('6-Transferts', '6 · Transferts entre dépôts', 'Cartons envoyés d’un dépôt à un autre (ex. Dépôt Niamey 1 → Dépôt Niamey 2).',
             ['Date', 'Dépôt qui envoie', 'Dépôt qui reçoit', 'Produit', 'Cartons', 'Observation'], [13, 22, 22, 22, 10, 30], vides=LIGNES, couleur=C2, dates=(1,))
liste(j6, 'B', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt qui envoie'); liste(j6, 'C', '=Choix!$A$2:$A$40', LIGNES, 'Dépôt qui reçoit'); liste(j6, 'D', '=Choix!$E$2:$E$20', LIGNES, 'Produit')

# ---------- Choix (feuille cachée) : les listes déroulantes suivent automatiquement les onglets de listes
ch = wb.create_sheet('Choix')
ref = lambda f, r: f'=IF(\'{f}\'!B{r}="","",\'{f}\'!B{r})'
cols = {'A': 'Dépôts', 'B': 'Agents', 'C': 'Vendeurs', 'D': 'Clients', 'E': 'Produits', 'F': 'Grossistes', 'G': 'Sources', 'H': 'Modes', 'I': 'Objets', 'J': 'Fournisseurs', 'K': 'Versé par', 'L': 'Lieux'}
for c, t in cols.items(): ch[f'{c}1'] = t
for i in range(39): ch[f'A{2 + i}'] = ref('Dépôts', 5 + i)
for i in range(150): ch[f'B{2 + i}'] = ref('Agents', 5 + i)
for i in range(40): ch[f'C{2 + i}'] = ref('Dépôts', 5 + i)
for i in range(150): ch[f'C{42 + i}'] = ref('Agents', 5 + i)
for i in range(400): ch[f'D{2 + i}'] = ref('Clients', 5 + i)
for i, (p, _) in enumerate(PRODUITS): ch[f'E{2 + i}'] = p
for i in range(100): ch[f'F{2 + i}'] = ref('Grossistes', 5 + i)
ch['G2'], ch['G3'] = 'Oriba Food', 'Oriba Rice'
for i in range(100): ch[f'G{4 + i}'] = ref('Grossistes', 5 + i)
ch['H2'], ch['H3'] = 'Comptant', 'Crédit'
ch['I2'], ch['I3'], ch['I4'] = 'Ventes comptant', 'Remboursement crédit', 'Règlement grossiste'
ch['J2'], ch['J3'] = 'Oriba Food', 'Oriba Rice'
for i in range(190): ch[f'K{2 + i}'] = f'=Choix!C{2 + i}'
for i in range(100): ch[f'K{192 + i}'] = f'=Choix!F{2 + i}'
ch['L2'], ch['L3'] = 'Caisse Oriba', 'Chez le grossiste'
ch.sheet_state = 'hidden'

exec(open('/home/claude/journalier/suivi_part.py', encoding='utf-8').read())

# Ordre des onglets : mode d'emploi, journaux du jour, puis listes
ordre = ['Lisez-moi', 'Suivi - Synthèse', '4-Ventes', '5-Versements', '2-Appro dépôts', '3-Remises agents', '6-Transferts', '1-Appro grossistes', 'Dépôts', 'Agents', 'Clients', 'Grossistes', 'Paramètres',
         'Suivi - Reste à encaisser', 'Suivi - Arôme Dadi', 'Suivi - Mayonnaise', 'Suivi - Sous agents', 'Suivi - Stock grossistes', 'Suivi - Prix', 'Choix']
wb._sheets = [wb[n] for n in ordre]
wb.active = 1
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print(OUT)
