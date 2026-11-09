# Healthcare operations

Workbooks here usually track volume, capacity, cost, and quality — not patients. Treat patient-level data as sensitive: do not paste identifiers into a workbook unless the user asks, do not copy rows from files you were shown into new sheets, and prefer aggregates.

- Name the denominator in every rate: per patient day, per discharge, per 1,000 members, per available bed. A percentage without its base is not a metric.
- Volume and capacity are different columns. Utilization is `used ÷ available`, and both sides need the same period and unit (bed-days, not beds).
- Payer mix, service line, and site of care are separate dimensions. One table with a column per dimension beats four tables that must be read together.
- Quality and safety metrics keep their own definitions; do not average a rate across sites without stating whether it is volume-weighted.
- Claims and remittance data arrive with gaps. Show missing as blank or `n.a.`, never as zero, and state the coverage period.
- Do not invent clinical thresholds, targets, or compliance claims. Use the targets the source file provides, and cite the sheet and cell.
- Money and counts follow the finance conventions: units stated once, totals as formulas, checks that detail rows reconcile to the summary.
