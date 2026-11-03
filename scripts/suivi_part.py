# Onglets de suivi (repris du fichier « Suivi Équipes Commerciaux Oriba Foods ») : quantités et valeurs (quantité × prix de l'onglet Suivi - Prix)
from openpyxl.styles import Font as _F, PatternFill as _P, Alignment as _A
BLEU = _F(color='1F4E9E')
SAISIE = _P('solid', fgColor='EAF2FD')
TOT_FILL = _P('solid', fgColor='E4F3E1')
MONEY, QTE, PCT = '# ##0 "F"', '# ##0', '0,0%'
SIT = dt.date(2026, 11, 3)

def suivi(nom, titre, sous, entetes, largeurs, couleur=VERT):
    ws = wb.create_sheet(nom)
    ws['A1'] = titre; ws['A1'].font = _F(bold=True, size=14, color=couleur)
    ws['A2'] = sous; ws['A2'].font = _F(italic=True, color='5A5670')
    for j, (h, w) in enumerate(zip(entetes, largeurs), 1):
        c = ws.cell(row=4, column=j, value=h); c.font = H_FONT; c.fill = PatternFill('solid', fgColor=couleur); c.alignment = _A(wrap_text=True, vertical='center'); c.border = BORD
        ws.column_dimensions[L(j)].width = w
    ws.row_dimensions[4].height = 44; ws.freeze_panes = 'A5'
    return ws

def cel(ws, r, c, v, fmt=None, saisie=False, gras=False):
    x = ws.cell(row=r, column=c, value=v); x.border = BORD
    if fmt: x.number_format = fmt
    if saisie: x.font = BLEU; x.fill = SAISIE
    if gras: x.font = _F(bold=True)
    return x

# ---------- Prix
PRIX = [('Mayonnaise Délice', 'Mayonnaise', 9500), ('Mayonnaise Oriba 1000 ml', 'Mayonnaise', 9500), ('Mayonnaise Oriba 500 ml', 'Mayonnaise', 9500), ('Mayonnaise Oriba 250 ml', 'Mayonnaise', 7500),
        ('Mayonnaise Aïda', 'Mayonnaise', 11000), ('Arôme Dadi Épice', 'Arôme', 13250), ('Arôme Dadi Poulet', 'Arôme', 12250)]
wp = suivi('Suivi - Prix', 'Grille des prix', 'Prix unitaires en F CFA (carton). Modifiez ici : toutes les valeurs du suivi se recalculent.', ['Produit', 'Catégorie', 'Prix (F CFA)'], [30, 16, 16], couleur=VIOLET)
for i, (p, c, v) in enumerate(PRIX):
    cel(wp, 5 + i, 1, p); cel(wp, 5 + i, 2, c); cel(wp, 5 + i, 3, v, MONEY, saisie=True)
PLAGE_PRIX = f"'Suivi - Prix'!$A$5:$C${4 + len(PRIX)}"
dvp = DataValidation(type='list', formula1=f"='Suivi - Prix'!$A$5:$A${4 + len(PRIX)}", allow_blank=True, showErrorMessage=False)
prix_de = lambda col, r: f'=IFERROR(VLOOKUP({col}{r},{PLAGE_PRIX},3,FALSE),0)'

# ---------- Tableaux de quantités valorisées (Arôme Dadi, Mayonnaise)
def tableau_qte(nom, titre, lignes, produit):
    ws = suivi(nom, titre, f"Situation au {SIT:%d/%m/%Y}. Cases bleues = quantités saisies (cartons). Valeur = quantité × prix du produit de référence (onglet Suivi - Prix).",
               ['Équipe commerciale', 'Dépôt (ERP)', 'Produit de référence', 'Prix unitaire (F CFA)', 'Reste à encaisser octobre (qté)', 'Pris en novembre (qté)', 'Versé en novembre (qté)', 'Stock restant (qté)', 'Stock non versé (qté)',
                'Valeur reste octobre', 'Valeur pris novembre', 'Valeur versé novembre', 'Valeur stock restant', 'Valeur stock non versé', "Taux d'encaissement"],
               [30, 18, 24, 13, 13, 12, 12, 11, 12, 15, 14, 14, 14, 15, 12])
    ws.add_data_validation(dvp := DataValidation(type='list', formula1=f"='Suivi - Prix'!$A$5:$A${4 + len(PRIX)}", allow_blank=True, showErrorMessage=False))
    for i, (eq, dep, ro, pn, vn, sr) in enumerate(lignes):
        r = 5 + i
        cel(ws, r, 1, eq); cel(ws, r, 2, dep); cel(ws, r, 3, produit, saisie=True); dvp.add(f'C{r}')
        cel(ws, r, 4, prix_de('C', r), MONEY)
        for j, v in zip((5, 6, 7, 8), (ro, pn, vn, sr)): cel(ws, r, j, v, QTE, saisie=True)
        cel(ws, r, 9, f'=E{r}+F{r}-G{r}-H{r}', QTE)
        for j, src in zip((10, 11, 12, 13, 14), 'EFGHI'): cel(ws, r, j, f'={src}{r}*$D{r}', MONEY)
        cel(ws, r, 15, f'=IF(E{r}+F{r}=0,"-",G{r}/(E{r}+F{r}))', PCT)
    t = 5 + len(lignes)
    cel(ws, t, 1, 'TOTAL', gras=True)
    for j in range(5, 15): cel(ws, t, j, f'=SUM({L(j)}5:{L(j)}{t - 1})', QTE if j <= 9 else MONEY, gras=True)
    cel(ws, t, 15, f'=IF(E{t}+F{t}=0,"-",G{t}/(E{t}+F{t}))', PCT, gras=True)
    for j in range(1, 16): ws.cell(row=t, column=j).fill = TOT_FILL
    ws.cell(row=t + 2, column=1, value='Stock non versé = Reste octobre + Pris novembre − Versé novembre − Stock restant.  Taux d’encaissement = Versé ÷ (Reste octobre + Pris novembre).').font = _F(italic=True, color='5A5670')
    return ws, t

AROME = [('Dépôt Niamey 1 - Sidi Mohamed Baby', 'Dépôt Niamey 1', 850, 0, 0, 0), ('Dépôt Niamey 2 - Ramatou Issoufou', 'Dépôt Niamey 2', 691, 100, 100, 0), ('Dépôt Niamey 3 - Arôme en sachets', '—', 0, 0, 0, 0),
         ('Dépôt Maradi', 'Dépôt Maradi', 0, 0, 0, 0), ('Dépôt Zinder', 'Dépôt Zinder', 118, 0, 0, 30), ('Dépôt Tahoua', 'Dépôt Tahoua', 520, 0, 0, 52), ('Dépôt Dosso - Mohamed', 'Dépôt Dosso', 850, 0, 0, 300),
         ('Dépôt Tillaberi - Zouera', 'Dépôt Tillabéri', 585, 0, 0, 419)]
MAYO = [('Niamey 1 - Sidi Mohamed Baby', 'Dépôt Niamey 1', 100, 0, 0, 0), ('Niamey 2 - Ramatou Issoufou', 'Dépôt Niamey 2', 750, 100, 100, 0), ('Secteur Mayo Nuit', 'Dépôt Mayonnaise', 289, 0, 0, 0),
        ('Axe Balleyara - Zouera', 'Dépôt Tillabéri', 60, 0, 0, 0)]
wa, ta = tableau_qte('Suivi - Arôme Dadi', "Situation de prise et versement d'arôme Dadi", AROME, 'Arôme Dadi Épice')
wm, tm = tableau_qte('Suivi - Mayonnaise', 'Situation du reste à encaisser mayonnaise', MAYO, 'Mayonnaise Oriba 1000 ml')

# ---------- Sous agents
wsa = suivi('Suivi - Sous agents', 'Situation des sous-agents (hôtesses)', 'Reste à encaisser par sous-agent : quantité saisie (case bleue) × prix du produit de référence.',
            ['Agent', 'Équipe', 'Marché', 'Produit de référence', 'Prix unitaire (F CFA)', 'Reste à encaisser (qté)', 'Reste à encaisser (valeur)'], [30, 14, 26, 24, 13, 14, 16])
wsa.add_data_validation(dv2 := DataValidation(type='list', formula1=f"='Suivi - Prix'!$A$5:$A${4 + len(PRIX)}", allow_blank=True, showErrorMessage=False))
for i, (n, eq, m, q) in enumerate(SOUS):
    r = 5 + i
    cel(wsa, r, 1, n); cel(wsa, r, 2, eq); cel(wsa, r, 3, m); cel(wsa, r, 4, 'Arôme Dadi Épice', saisie=True); dv2.add(f'D{r}')
    cel(wsa, r, 5, prix_de('D', r), MONEY); cel(wsa, r, 6, q, QTE, saisie=True); cel(wsa, r, 7, f'=F{r}*E{r}', MONEY)
tsa = 5 + len(SOUS)
cel(wsa, tsa, 1, 'TOTAL', gras=True); cel(wsa, tsa, 6, f'=SUM(F5:F{tsa - 1})', QTE, gras=True); cel(wsa, tsa, 7, f'=SUM(G5:G{tsa - 1})', MONEY, gras=True)
for j in range(1, 8): wsa.cell(row=tsa, column=j).fill = TOT_FILL

# ---------- Stock grossistes
SG = [('Boubacar Colege Mariama', 'Grand Marché', 809), ('Elh Zangui', 'Grand Marché', 70), ('Ets Zarafi', 'Grand Marché', 125), ('Elh Moumouni Douka', 'Grand Marché', 150), ('Alhassane Gabora', 'Grand Marché', 375),
      ('Abdallah Mohamed', 'Grand Marché', 0), ('Ahmed Badi', 'Grand Marché', 480), ('Ousmane Yantala', 'Yantala', 229), ('Boubacar Bako', 'Dolé', 300), ('Dépôt Abdoullaye Indinga', 'Dolé', 1687)]
wg = suivi('Suivi - Stock grossistes', 'Stock restant des grossistes', 'Situation au 01/11/2026. Quantité saisie (case bleue) × prix du produit de référence.',
           ['Grossiste', 'Marché', 'Produit de référence', 'Prix unitaire (F CFA)', 'Quantité (cartons)', 'Valeur (F CFA)', '% du stock'], [28, 16, 24, 13, 13, 16, 11])
wg.add_data_validation(dv3 := DataValidation(type='list', formula1=f"='Suivi - Prix'!$A$5:$A${4 + len(PRIX)}", allow_blank=True, showErrorMessage=False))
tg = 5 + len(SG)
for i, (n, m, q) in enumerate(SG):
    r = 5 + i
    cel(wg, r, 1, n); cel(wg, r, 2, m); cel(wg, r, 3, 'Arôme Dadi Épice', saisie=True); dv3.add(f'C{r}')
    cel(wg, r, 4, prix_de('C', r), MONEY); cel(wg, r, 5, q, QTE, saisie=True); cel(wg, r, 6, f'=E{r}*D{r}', MONEY); cel(wg, r, 7, f'=IF($E${tg}=0,0,E{r}/$E${tg})', PCT)
cel(wg, tg, 1, 'TOTAL', gras=True); cel(wg, tg, 5, f'=SUM(E5:E{tg - 1})', QTE, gras=True); cel(wg, tg, 6, f'=SUM(F5:F{tg - 1})', MONEY, gras=True); cel(wg, tg, 7, f'=SUM(G5:G{tg - 1})', PCT, gras=True)
for j in range(1, 8): wg.cell(row=tg, column=j).fill = TOT_FILL

# ---------- Reste à encaisser (F CFA)
RAE = [('Dépôt Niamey 1', 'Sidi Mohamed Baby', 'Oriba Food', 1136500, 950000, 0), ('Dépôt Niamey 1', 'Sidi Mohamed Baby', 'Dépôt Abdoullahi Dolé', 3975000, 0, 0), ('Dépôt Niamey 1', 'Sidi Mohamed Baby', 'Ahmed Badi', 5260000, 0, 0),
       ('Dépôt Niamey 2', 'Ramatou Issoufou', 'Oriba Food', 0, 7125000, 0), ('Dépôt Niamey 2', 'Ramatou Issoufou', 'Abdallah Oustaz', 5777100, 0, 0), ('Dépôt Niamey 2', 'Ramatou Issoufou', 'Boubacar Colege Mariama', 3312500, 0, 0),
       ('Dépôt Tillabéri', 'Zouera', 'Ousmane Yantala', 2650000, 0, 450500), ('Dépôt Tillabéri', 'Zouera', 'Boubacar Colege Mariama', 5101250, 0, 5101250), ('Dépôt Tillabéri', 'Zouera', 'Oriba Food', 0, 570000, 0),
       ('Dépôt Dosso', 'Mohamed', 'Oriba Food', 11050000, 0, 0), ('Dépôt Tahoua', None, 'Oriba Rice Tahoua', 6760000, 0, 416000), ('Dépôt Mayonnaise', None, 'Oriba Rice', 0, 1490147, 154000)]
wr = suivi('Suivi - Reste à encaisser', 'Reste à encaisser par dépôt (F CFA)', f'Situation au {SIT:%d/%m/%Y}. Cases bleues = montants saisis. Net = arôme + mayonnaise − valeur du stock restant (repris dans l’onglet Dépôts).',
           ['Dépôt', 'Responsable', 'Grossiste / fournisseur', 'Valeur arôme', 'Valeur mayonnaise', 'Valeur stock restant', 'Net à encaisser', '% du total'], [18, 20, 26, 15, 15, 15, 16, 10])
tr = 5 + len(RAE)
for i, (d, resp, g, a, m, st) in enumerate(RAE):
    r = 5 + i
    cel(wr, r, 1, d); cel(wr, r, 2, resp); cel(wr, r, 3, g)
    for j, v in zip((4, 5, 6), (a, m, st)): cel(wr, r, j, v, MONEY, saisie=True)
    cel(wr, r, 7, f'=D{r}+E{r}-F{r}', MONEY); cel(wr, r, 8, f'=IF($G${tr}=0,0,G{r}/$G${tr})', PCT)
cel(wr, tr, 1, 'TOTAL', gras=True)
for j in (4, 5, 6, 7): cel(wr, tr, j, f'=SUM({L(j)}5:{L(j)}{tr - 1})', MONEY, gras=True)
cel(wr, tr, 8, f'=SUM(H5:H{tr - 1})', PCT, gras=True)
for j in range(1, 9): wr.cell(row=tr, column=j).fill = TOT_FILL
wr.cell(row=tr + 2, column=1, value='« Secteur Mayonnaises » est rattaché au « Dépôt Mayonnaise » de l’ERP (dans le fichier d’origine, ce lien était cassé et la synthèse affichait 0).').font = _F(italic=True, color='5A5670')

# ---------- Synthèse
wy = suivi('Suivi - Synthèse', 'Suivi des encaissements — tableau de bord', f'Situation au {SIT:%d/%m/%Y}. Toutes les valeurs viennent des autres onglets « Suivi » (rien à saisir ici).',
           ['Indicateur clé', 'Quantité (cartons)', 'Valeur (F CFA)', 'Commentaire'], [42, 16, 18, 60], couleur=VIOLET)
R1 = "'Suivi - Reste à encaisser'"; A1, M1, S1, G1 = "'Suivi - Arôme Dadi'", "'Suivi - Mayonnaise'", "'Suivi - Sous agents'", "'Suivi - Stock grossistes'"
ind = [('Reste à encaisser — arôme (montants du suivi)', None, f'={R1}!D{tr}', 'Montants saisis dans Suivi - Reste à encaisser'),
       ('Reste à encaisser — mayonnaise (montants du suivi)', None, f'={R1}!E{tr}', ''),
       ('Valeur du stock restant des équipes', None, f'={R1}!F{tr}', ''),
       ('NET À ENCAISSER', None, f'={R1}!G{tr}', 'Arôme + mayonnaise − stock restant : repris dans l’onglet Dépôts'),
       ('Arôme Dadi — reste à encaisser octobre', f'={A1}!E{ta}', f'={A1}!J{ta}', 'Valeur = quantité × prix (Suivi - Prix)'),
       ('Arôme Dadi — stock restant', f'={A1}!H{ta}', f'={A1}!M{ta}', ''),
       ('Arôme Dadi — stock non versé', f'={A1}!I{ta}', f'={A1}!N{ta}', ''),
       ("Arôme Dadi — taux d'encaissement", None, f'={A1}!O{ta}', ''),
       ('Mayonnaise — reste à encaisser octobre', f'={M1}!E{tm}', f'={M1}!J{tm}', ''),
       ('Mayonnaise — stock non versé', f'={M1}!I{tm}', f'={M1}!N{tm}', ''),
       ("Mayonnaise — taux d'encaissement", None, f'={M1}!O{tm}', ''),
       ('Sous-agents — reste à encaisser', f'={S1}!F{tsa}', f'={S1}!G{tsa}', ''),
       ('Stock restant des grossistes', f'={G1}!E{tg}', f'={G1}!F{tg}', 'Au 01/11/2026')]
for i, (l, q, v, c) in enumerate(ind):
    r = 5 + i; gras = l.startswith('NET')
    cel(wy, r, 1, l, gras=gras); cel(wy, r, 2, q, QTE, gras=gras); cel(wy, r, 3, v, PCT if 'taux' in l else MONEY, gras=gras); cel(wy, r, 4, c)
    if gras:
        for j in range(1, 5): wy.cell(row=r, column=j).fill = TOT_FILL
r0 = 5 + len(ind) + 2
wy.cell(row=r0, column=1, value='Par dépôt').font = _F(bold=True, size=12, color=VERT)
hd = ['Dépôt', 'Valeur arôme', 'Valeur mayonnaise', 'Valeur stock restant', 'Net à encaisser', '% du total', 'Arôme stock non versé (qté)', 'Arôme stock non versé (valeur)', 'Mayonnaise stock non versé (qté)', 'Mayonnaise stock non versé (valeur)']
for j, h in enumerate(hd, 1):
    c = wy.cell(row=r0 + 1, column=j, value=h); c.font = H_FONT; c.fill = PatternFill('solid', fgColor=VERT); c.alignment = _A(wrap_text=True); c.border = BORD
for j, w in zip(range(5, 11), (16, 10, 14, 16, 14, 16)): wy.column_dimensions[L(j)].width = max(wy.column_dimensions[L(j)].width or 0, w)
DEPS = ['Dépôt Niamey 1', 'Dépôt Niamey 2', 'Dépôt Tillabéri', 'Dépôt Dosso', 'Dépôt Tahoua', 'Dépôt Zinder', 'Dépôt Maradi', 'Dépôt Konni', 'Dépôt Mayonnaise']
for i, d in enumerate(DEPS):
    r = r0 + 2 + i
    cel(wy, r, 1, d)
    for j, col in zip((2, 3, 4, 5), 'DEFG'): cel(wy, r, j, f'=SUMIF({R1}!$A$5:$A${tr - 1},$A{r},{R1}!{col}$5:{col}${tr - 1})', MONEY)
    cel(wy, r, 6, f'=IF({R1}!$G${tr}=0,0,E{r}/{R1}!$G${tr})', PCT)
    cel(wy, r, 7, f'=SUMIF({A1}!$B$5:$B${ta - 1},$A{r},{A1}!I$5:I${ta - 1})', QTE); cel(wy, r, 8, f'=SUMIF({A1}!$B$5:$B${ta - 1},$A{r},{A1}!N$5:N${ta - 1})', MONEY)
    cel(wy, r, 9, f'=SUMIF({M1}!$B$5:$B${tm - 1},$A{r},{M1}!I$5:I${tm - 1})', QTE); cel(wy, r, 10, f'=SUMIF({M1}!$B$5:$B${tm - 1},$A{r},{M1}!N$5:N${tm - 1})', MONEY)
rt = r0 + 2 + len(DEPS)
cel(wy, rt, 1, 'TOTAL', gras=True)
for j in range(2, 11): cel(wy, rt, j, f'=SUM({L(j)}{r0 + 2}:{L(j)}{rt - 1})', PCT if j == 6 else (QTE if j in (7, 9) else MONEY), gras=True)
for j in range(1, 11): wy.cell(row=rt, column=j).fill = TOT_FILL
